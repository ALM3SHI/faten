"""Deterministic multi-term planner and schedule validator.

Hard constraints (a plan that breaks one is never produced):
  • every listed prerequisite is passed in an EARLIER term;
  • a course is never placed in a term the student marked as «not offered»;
  • regular-term load ≤ the chosen cap; summer load ≤ 10 (regulation);
  • co-operative training is alone in its term (regulation);
  • a course whose prerequisite is «IC» is not scheduled.

Soft constraints (reported, never hidden):
  • regular-term load ≥ 10 (regulation allows exceptions: graduating, or no
    eligible courses) — a lighter term is flagged, not silently filled;
  • at most N heavy courses per term (strategy setting).

Priority is list-scheduling on the prerequisite graph: courses on the
longest remaining chain first, then courses that unlock the most others.
Same inputs → same plan (ties break on course code).
"""

from __future__ import annotations

import datetime as dt
from typing import Literal, NamedTuple

from pydantic import BaseModel, Field

from services.advisor import rules
from services.advisor.catalog import Catalog, Curriculum, normalize_code
from services.advisor.profile import StudentProfile

Strategy = Literal["fastest", "balanced", "recovery"]

_TERM_NAMES = {1: "الفصل الأول", 2: "الفصل الثاني", 3: "الفصل الصيفي"}


class Term(NamedTuple):
    year: int  # Hijri academic year it starts in, e.g. 1448
    idx: int  # 1 first, 2 second, 3 summer

    @property
    def label(self) -> str:
        return f"{_TERM_NAMES[self.idx]} {self.year}"

    @property
    def is_summer(self) -> bool:
        return self.idx == 3

    def key(self) -> str:
        return f"{self.year}-{self.idx}"


def parse_term_key(text: str | None) -> Term | None:
    try:
        y, i = str(text).split("-")
        t = Term(int(y), int(i))
        return t if t.idx in (1, 2, 3) else None
    except (ValueError, AttributeError):
        return None


def next_term(t: Term, summer: bool) -> Term:
    if t.idx == 1:
        return Term(t.year, 2)
    if t.idx == 2 and summer:
        return Term(t.year, 3)
    return Term(t.year + 1, 1)


def current_term(today: dt.date | None = None) -> Term:
    """Term in progress (or about to start) from the official 1448 calendar."""
    from data import uqu_calendar as cal

    today = today or dt.date.today()
    year = int(cal.ACADEMIC_YEAR)
    if today <= cal.TERM1_END:
        return Term(year, 1)
    if today <= cal.TERM2_END:
        return Term(year, 2)
    return Term(year, 3)


class PlanSettings(BaseModel):
    max_regular_load: int = rules.DEFAULT_MAX_REGULAR_LOAD
    max_regular_load_is_default: bool = True
    min_regular_load: int = int(rules.rule("min_regular_load").value or 10)
    summer: bool = False
    max_summer_load: int = int(rules.rule("max_summer_load").value or 10)
    start_term: str | None = None  # "1448-2"; default = term after the current one
    target_term: str | None = None  # desired graduation term
    unavailable: list[dict] = Field(default_factory=list)  # [{code, term: "1448-2" | "next" | "summer" | "all"}]
    heavy_limit: int | None = None
    heavy_courses: list[str] = Field(default_factory=list)
    horizon_terms: int = 16
    plan_electives: bool = True


class PlannedCourse(BaseModel):
    code: str
    name: str
    credits: int
    kind: str  # required | coop | elective
    tags: list[str] = Field(default_factory=list)  # repeat | critical | unlocks:N | heavy | summer_unverified
    verification: str
    unlocks: int = 0


class PlannedTerm(BaseModel):
    term: str
    label: str
    summer: bool
    credits: int
    courses: list[PlannedCourse]
    warnings: list[str] = Field(default_factory=list)


class PlanResult(BaseModel):
    strategy: Strategy
    load_cap: int
    terms: list[PlannedTerm]
    graduation_term: str | None
    graduation_label: str | None
    terms_needed: int  # number of non-empty terms
    complete: bool
    unscheduled: list[dict]
    lower_bound: dict  # {terms, by: "chain"|"credits", label}
    target: dict | None  # feasibility of the requested graduation term
    assumptions: list[str]
    status: Literal["feasible_unconfirmed"] = "feasible_unconfirmed"


# ── graph helpers ───────────────────────────────────────────────

def _dependents(cur: Curriculum) -> dict[str, list[str]]:
    deps: dict[str, list[str]] = {c.code: [] for c in cur.courses}
    for c in cur.courses:
        for p in c.prerequisites:
            deps.setdefault(p, []).append(c.code)
    return deps


def chain_metrics(cur: Curriculum, remaining: set[str]) -> tuple[dict[str, int], dict[str, int]]:
    """height: longest chain (in terms) starting at the course among remaining courses;
    unlocks: number of remaining courses that transitively need it."""
    deps = _dependents(cur)
    height: dict[str, int] = {}

    def h(code: str) -> int:
        if code in height:
            return height[code]
        height[code] = 1  # guards against cycles (ingest rejects them anyway)
        height[code] = 1 + max((h(d) for d in deps.get(code, []) if d in remaining), default=0)
        return height[code]

    unlocks: dict[str, int] = {}
    for code in remaining:
        h(code)
        seen, stack = set(), list(deps.get(code, []))
        while stack:
            d = stack.pop()
            if d in seen or d not in remaining:
                continue
            seen.add(d)
            stack.extend(deps.get(d, []))
        unlocks[code] = len(seen)
    return {c: height[c] for c in remaining}, unlocks


def _is_unavailable(code: str, term: Term, first: Term, rules_list: list[dict]) -> bool:
    for r in rules_list:
        if normalize_code(r.get("code")) != code:
            continue
        when = str(r.get("term") or "all")
        if when == "all" or (when == "next" and term == first) or (when == "summer" and term.is_summer) or when == term.key():
            return True
    return False


PREP_NOTICE = ("في السنة التأهيلية تُسجَّل مقررات المستوى كاملة دون النظر إلى المتطلبات السابقة ولا يجوز حذفها (القواعد التنفيذية، "
               "المادة الثالثة عشرة)؛ مقررات هذا الفصل تحددها الجامعة، والخطة هنا للعرض والتقدير.")


def prep_status(profile: StudentProfile, cur: Curriculum) -> tuple[bool, set[str]]:
    """Is the student still inside the official preparatory year of this plan?

    Only when the catalog verified that the plan's first levels ARE the prep-year
    program (same courses and hours). «Inside» = some prep course is still open and
    nothing beyond the prep levels has been passed or registered."""
    py = cur.prep_year
    if not py or not py.matches_plan:
        return False, set()
    prep = {c.code for c in cur.courses if c.level in py.levels}
    taken = set(profile.passed) | set(profile.in_progress)
    beyond = {c.code for c in cur.courses if c.level > max(py.levels)}
    return bool(prep - taken) and not (taken & beyond), prep


def plan(
    profile: StudentProfile,
    catalog: Catalog,
    cur: Curriculum,
    settings: PlanSettings,
    strategy: Strategy = "balanced",
    load_cap: int | None = None,
    today: dt.date | None = None,
) -> PlanResult:
    passed = set(profile.passed)
    in_progress = set(profile.in_progress)
    completed = passed | in_progress  # in-progress courses assumed passed by the start term
    first = parse_term_key(settings.start_term) or next_term(current_term(today), summer=False)
    cap = max(1, min(load_cap or settings.max_regular_load, settings.max_regular_load))

    plan_courses = {c.code: c for c in cur.courses}
    remaining = {c for c in plan_courses if c not in completed}
    heights, unlocks = chain_metrics(cur, remaining)
    heavy = set(settings.heavy_courses) | set(profile.failed_unresolved)

    # Electives the published plan does not name: conservative — assume all are still needed.
    electives: list[PlannedCourse] = []
    if settings.plan_electives and cur.unlisted_hours:
        left, n = cur.unlisted_hours, 0
        while left > 0:
            n += 1
            size = 3 if left >= 3 else left
            electives.append(PlannedCourse(code=f"ELECTIVE-{n}", name="مقرر اختياري (لم تُنشر قائمته)", credits=size,
                                           kind="elective", verification="unavailable"))
            left -= size

    blocked_ic = {c for c in remaining if any(p in profile.incomplete for p in plan_courses[c].prerequisites)}
    unsatisfiable = {
        c for c in remaining
        if any(p not in plan_courses and p not in completed for p in plan_courses[c].prerequisites)
    }

    def coop_ready(code: str, done: set[str]) -> bool:
        level = plan_courses[code].level
        return all(c in done for c, pc in plan_courses.items() if pc.kind != "coop" and pc.level < level)

    def priority(code: str):
        # Fastest: longest remaining chain first. Balanced/recovery: the official
        # level order, chain length breaking ties — closer to how departments register.
        repeat_first = 0
        if strategy != "fastest" and code in profile.failed_unresolved and unlocks.get(code, 0) > 0:
            repeat_first = -1
        if strategy == "fastest":
            return (-heights.get(code, 1), -unlocks.get(code, 0), plan_courses[code].level, code)
        return (repeat_first, plan_courses[code].level, -heights.get(code, 1), -unlocks.get(code, 0), code)

    in_prep, prep_codes = prep_status(profile, cur)
    done = set(completed)
    todo = set(remaining) - blocked_ic - unsatisfiable
    # Plan level the student is at: the lowest level with unfinished courses.
    standing = min((plan_courses[c].level for c in remaining), default=1)
    elective_queue = list(electives)
    terms: list[PlannedTerm] = []
    term = first
    for _ in range(settings.horizon_terms):
        if not todo and not elective_queue:
            break
        if term.is_summer and not settings.summer:
            term = next_term(term, settings.summer)
            continue
        limit = settings.max_summer_load if term.is_summer else cap
        heavy_left = settings.heavy_limit if settings.heavy_limit is not None else 99
        candidates = sorted(
            (c for c in todo
             if all(p in done for p in plan_courses[c].prerequisites)
             and not _is_unavailable(c, term, first, settings.unavailable)),
            key=priority,
        )
        chosen: list[PlannedCourse] = []
        load = 0
        warnings: list[str] = []
        coop = [c for c in candidates if plan_courses[c].kind == "coop" and coop_ready(c, done)]
        if coop and not term.is_summer:
            # Co-op only once nothing of an earlier level is left; then it takes the whole term.
            c = coop[0]
            chosen.append(_planned(c, catalog, cur, heights, unlocks, profile, heavy, term, standing + len(terms)))
            load = plan_courses[c].credits
        else:
            # Two passes so a co-requisite placed later in the order can still unlock its partner this term.
            picked: set[str] = set()
            for _pass in (0, 1):
                for c in candidates:
                    pc = plan_courses[c]
                    if c in picked or pc.kind == "coop":
                        continue
                    if any(q not in done and q not in picked for q in pc.corequisites):
                        continue  # co-requisite must be passed or taken in the same term
                    if load + pc.credits > limit:
                        continue
                    is_heavy = c in heavy
                    if is_heavy and heavy_left <= 0:
                        continue
                    chosen.append(_planned(c, catalog, cur, heights, unlocks, profile, heavy, term, standing + len(terms)))
                    picked.add(c)
                    load += pc.credits
                    heavy_left -= 1 if is_heavy else 0
            while elective_queue and load + elective_queue[0].credits <= limit:
                e = elective_queue.pop(0)
                if term.is_summer:
                    e = e.model_copy(update={"tags": e.tags + ["summer_unverified"]})
                chosen.append(e)
                load += e.credits
        remaining_after = sum(plan_courses[c].credits for c in todo) + sum(e.credits for e in elective_queue) - load
        coop_term = any(c.kind == "coop" for c in chosen)
        if not term.is_summer and chosen and not coop_term and load < settings.min_regular_load and remaining_after > 0:
            warnings.append(
                f"العبء {load} ساعات أقل من الحد الأدنى النظامي ({settings.min_regular_load})؛ "
                "لا توجد مقررات إضافية مستوفية لمتطلباتها في هذا الفصل — يحتاج استثناءً من المرشد."
            )
        if not chosen and not term.is_summer:
            warnings.append("لا يوجد مقرر يمكن تسجيله في هذا الفصل بسبب المتطلبات أو عدم الطرح.")
        if term.is_summer and chosen:
            warnings.append("طرح المقررات في الصيف غير مؤكد — تحقق من جدول القسم.")
        for pcourse in chosen:
            pc = plan_courses.get(pcourse.code)
            for cond in (pc.special_conditions if pc else []):
                warnings.append(f"{pcourse.code}: {cond['text']}.")
        if in_prep and any(c.code in prep_codes for c in chosen):
            warnings.append(PREP_NOTICE)
        for pcourse in chosen:
            if pcourse.kind != "elective":
                todo.discard(pcourse.code)
                done.add(pcourse.code)
        if chosen or not term.is_summer:
            terms.append(PlannedTerm(term=term.key(), label=term.label, summer=term.is_summer, credits=load,
                                     courses=chosen, warnings=warnings))
        term = next_term(term, settings.summer)

    # trim trailing empty terms
    while terms and not terms[-1].courses:
        terms.pop()

    unscheduled = (
        [{"code": c, "reason": "متطلب سابق «غير مكتمل» (IC)"} for c in sorted(blocked_ic)]
        + [{"code": c, "reason": "متطلب سابق خارج الخطة ولم يُجتز"} for c in sorted(unsatisfiable)]
        + [{"code": c, "reason": "لم يتسع الأفق الزمني أو المقرر غير مطروح"} for c in sorted(todo)]
        + [{"code": e.code, "reason": "مقرر اختياري لم يُجدول"} for e in elective_queue]
    )
    complete = not unscheduled
    grad = next((t for t in reversed(terms) if t.courses), None) if complete else None

    lb = lower_bound(profile, cur, settings, cap, first)
    target = None
    tt = parse_term_key(settings.target_term)
    if tt:
        target = target_feasibility(tt, first, settings, lb, grad.term if grad else None)

    assumptions = [
        "الخطة ممكنة رياضياً وفق المتطلبات المنشورة، وليست مؤكدة للتسجيل: طرح المقررات وتعارض الجداول لا يُنشران علناً.",
        "المقررات المسجلة حالياً تُعامل كأنها ستُجتاز.",
        "المتطلبات المتعددة عوملت كلها لازمة (و).",
        "التدريب التعاوني يُجدول بعد إنهاء مقررات المستويات التي تسبقه في الخطة، ووحده في فصله.",
        "قيود التسجيل حسب المستوى أو عدد الساعات المجتازة غير منشورة؛ المقررات الموسومة «قبل موعدها» قد يمنعها النظام.",
        "المتطلب المتزامن (إن وُجد في توصيف المقرر) يُسمح بأخذه في الفصل نفسه وفق تعريف اللائحة.",
    ]
    if any(pc.special_conditions for pc in cur.courses):
        assumptions.append("مقررات «تتطلب موافقة القسم» جُدولت كأن الموافقة ستُمنح؛ لا يمكن لفطن التحقق منها.")
    if in_prep:
        assumptions.append(PREP_NOTICE)
    if settings.max_regular_load_is_default:
        assumptions.append(f"حد العبء {settings.max_regular_load} ساعة افتراض تخطيطي من فطن وليس من اللائحة "
                           "(لا يوجد حد أعلى للفصل العادي في القواعد التنفيذية)؛ عدّله من الإعدادات.")
    if electives:
        assumptions.append(f"جُدولت {cur.unlisted_hours} ساعة اختيارية كخانات عامة لأن قائمتها غير منشورة.")
    return PlanResult(
        strategy=strategy, load_cap=cap, terms=terms,
        graduation_term=grad.term if grad else None, graduation_label=grad.label if grad else None,
        terms_needed=sum(1 for t in terms if t.courses), complete=complete, unscheduled=unscheduled,
        lower_bound=lb, target=target, assumptions=assumptions,
    )


def _planned(code, catalog, cur, heights, unlocks, profile, heavy, term, expected_level) -> PlannedCourse:
    pc = cur.course(code)
    tags = []
    if pc.level - expected_level >= 2:
        tags.append("ahead_of_plan")
    if code in profile.failed_unresolved:
        tags.append("repeat")
    if heights.get(code, 1) >= max(heights.values(), default=1) and heights.get(code, 1) > 1:
        tags.append("critical")
    if unlocks.get(code):
        tags.append(f"unlocks:{unlocks[code]}")
    if code in heavy:
        tags.append("heavy")
    if term.is_summer:
        tags.append("summer_unverified")
    if pc.special_conditions:
        tags.append("needs_approval")
    if pc.evidence:
        tags.append("spec_verified")
    return PlannedCourse(code=code, name=catalog.course_name(code), credits=pc.credits, kind=pc.kind, tags=tags,
                         verification=pc.verification, unlocks=unlocks.get(code, 0))


def _walk(first: Term, summer: bool):
    """Plannable terms from `first` onward (summers only when enabled)."""
    t = first
    while True:
        if not (t.is_summer and not summer):
            yield t
        t = next_term(t, summer)


def lower_bound(profile: StudentProfile, cur: Curriculum, settings: PlanSettings, cap: int, first: Term) -> dict:
    """Terms no schedule can beat: the longest prerequisite chain, and total credits / capacity."""
    completed = set(profile.passed) | set(profile.in_progress)
    remaining = {c.code for c in cur.courses if c.code not in completed}
    heights, _ = chain_metrics(cur, remaining)
    chain = max(heights.values(), default=0)
    credits = sum(c.credits for c in cur.courses if c.code in remaining and c.kind != "coop")
    credits += cur.unlisted_hours if settings.plan_electives else 0
    coop_needed = any(c.kind == "coop" for c in cur.courses if c.code in remaining)

    by_credits, capacity = 0, 0
    if credits > 0 or coop_needed:
        for t in _walk(first, settings.summer):
            by_credits += 1
            if coop_needed and not t.is_summer:
                coop_needed = False  # the co-op term carries nothing else
            else:
                capacity += settings.max_summer_load if t.is_summer else cap
            if capacity >= credits and not coop_needed:
                break
            if by_credits > 60:
                break
    n = max(chain, by_credits)
    earliest = None
    if n:
        for i, t in enumerate(_walk(first, settings.summer), 1):
            if i == n:
                earliest = t
                break
    return {"terms": n, "by": "chain" if chain >= by_credits else "credits", "chain_terms": chain,
            "credit_terms": by_credits, "earliest_term": earliest.key() if earliest else None,
            "earliest_label": earliest.label if earliest else None}


def target_feasibility(target: Term, first: Term, settings: PlanSettings, lb: dict, planned: str | None) -> dict:
    earliest = parse_term_key(lb.get("earliest_term"))
    out = {"target_term": target.key(), "target_label": target.label}
    if target < first:
        return {**out, "verdict": "past", "message": "الفصل المطلوب سابق للفصل القادم."}
    if earliest and target < earliest:
        why = ("سلسلة المتطلبات المتبقية أطول من المدة المطلوبة" if lb["by"] == "chain"
               else "الساعات المتبقية لا تتسع في هذه الفصول بحد العبء المختار")
        return {**out, "verdict": "impossible",
                "message": f"مستحيل رياضياً: أبكر تخرج ممكن {earliest.label} لأن {why}.",
                "earliest_label": earliest.label}
    planned_t = parse_term_key(planned)
    if planned_t and planned_t <= target:
        return {**out, "verdict": "feasible", "message": f"ممكن: الخطة الأسرع تنتهي {planned_t.label}."}
    return {**out, "verdict": "unproven",
            "message": "لا يمنعه حدٌّ رياضي، لكن المخطط لم يجد جدولاً يحققه بالقيود الحالية (جرّب الصيف أو رفع العبء).",
            "planned_label": planned_t.label if planned_t else None}


# ── validating a schedule the student proposes ──────────────────

def validate_schedule(
    codes: list[str],
    profile: StudentProfile,
    catalog: Catalog,
    cur: Curriculum,
    settings: PlanSettings,
    summer_term: bool = False,
) -> dict:
    """Check a proposed next-term registration against the hard rules.

    Prerequisites must be passed before the term (in-progress ones are reported as
    conditional); co-requisites may be passed or in the same proposal; prep-year
    courses are registered by level without prerequisite checks (regulation), so
    for a student still in the prep year a missing prerequisite there is a note,
    not a violation."""
    plan_courses = {c.code: c for c in cur.courses}
    options = {o.code: o for o in cur.elective_options}
    passed, progress = set(profile.passed), set(profile.in_progress)
    in_prep, prep_codes = prep_status(profile, cur)
    normalized = [normalize_code(c) for c in codes]
    items, violations, warnings, notes = [], [], [], []
    chosen = [c for c in normalized if c]
    if len(chosen) != len(set(chosen)):
        violations.append({"rule": "duplicate", "message": "مقرر مكرر في الجدول المقترح."})
    for raw, code in zip(codes, normalized):
        entry = {"input": raw, "code": code, "ok": True, "problems": [], "source": None}
        pc = plan_courses.get(code)
        opt = options.get(code)
        prereqs = pc.prerequisites if pc else (opt.prerequisites if opt else [])
        coreqs = pc.corequisites if pc else (opt.corequisites if opt else [])
        if not code:
            entry.update(ok=False, problems=["رمز مقرر غير صالح"])
            items.append(entry)
            continue
        if pc is None and opt is None:
            entry["problems"].append("المقرر ليس ضمن خطتك المنشورة ولا ضمن الاختياريات الموثّقة — تحقق من القسم.")
            items.append(entry)
            continue
        if opt is not None:
            entry["source"] = opt.source
            entry["problems"].append("مقرر اختياري موثّق في توصيفه الرسمي (القائمة الكاملة للاختياريات غير منشورة).")
        if code in passed:
            entry["ok"] = False
            entry["problems"].append("سبق أن اجتزته.")
        prep_exempt = in_prep and code in prep_codes
        missing = [p for p in prereqs if p not in passed]
        same_term = [p for p in missing if p in chosen]
        pending = [p for p in missing if p in progress]
        hard_missing = [p for p in missing if p not in progress and p not in same_term]
        if prep_exempt and (same_term or hard_missing):
            entry["problems"].append("في السنة التأهيلية تُسجَّل مقررات المستوى دون النظر للمتطلبات السابقة.")
            notes.append({"rule": "prep_year_registration", "course": code, "cite": rules.cite("prep_year_registration")})
        else:
            if same_term:
                entry["ok"] = False
                entry["problems"].append(f"المتطلب السابق {', '.join(same_term)} في نفس الفصل — يجب اجتيازه قبله.")
            if hard_missing:
                entry["ok"] = False
                entry["problems"].append(f"متطلب سابق غير مجتاز: {', '.join(hard_missing)}.")
            if pending:
                entry["problems"].append(f"يعتمد على نجاحك في {', '.join(pending)} هذا الفصل.")
        co_missing = [q for q in coreqs if q not in passed and q not in progress and q not in chosen]
        if co_missing:
            entry["ok"] = False
            entry["problems"].append(f"متطلب متزامن {', '.join(co_missing)}: اجتزه قبله أو سجّله معه في الفصل نفسه.")
        ic = [p for p in prereqs if p in profile.incomplete]
        if ic:
            entry["ok"] = False
            entry["problems"].append(f"متطلبه {', '.join(ic)} مرصود «غير مكتمل» (IC).")
        for cond in (pc.special_conditions if pc else []):
            entry["problems"].append(cond["text"] + ".")
            warnings.append({"rule": "special_condition", "course": code, "message": f"{code}: {cond['text']}.",
                             "source_url": cond.get("source_url")})
        items.append(entry)
    for e in items:
        if not e["ok"] and any("متطلب" in p for p in e["problems"]):
            rule_id = "corequisites" if any("متزامن" in p for p in e["problems"]) and not any("سابق" in p for p in e["problems"]) else "prerequisites_required"
            violations.append({"rule": rule_id, "course": e["code"], "message": " ".join(e["problems"]), "cite": rules.cite(rule_id)})

    def credits_of(c: str) -> int:
        if c in plan_courses:
            return plan_courses[c].credits
        return options[c].credits if c in options else 0

    credits = sum(credits_of(c) for c in chosen)
    coop = [c for c in chosen if c in plan_courses and plan_courses[c].kind == "coop"]
    if coop and len(chosen) > 1:
        violations.append({"rule": "coop_exclusive", "message": "لا يجوز الجمع بين التدريب التعاوني ومقررات أخرى.",
                           "cite": rules.cite("coop_exclusive")})
    if summer_term and credits > settings.max_summer_load:
        violations.append({"rule": "max_summer_load", "message": f"{credits} ساعة تتجاوز حد الصيف ({settings.max_summer_load}).",
                           "cite": rules.cite("max_summer_load")})
    if not summer_term:
        remaining_total = sum(c.credits for c in cur.courses if c.code not in passed and c.code not in progress) + cur.unlisted_hours
        if credits < settings.min_regular_load and remaining_total > credits:
            warnings.append({"rule": "min_regular_load", "message": f"{credits} ساعة أقل من الحد الأدنى ({settings.min_regular_load}).",
                             "cite": rules.cite("min_regular_load")})
        if credits > settings.max_regular_load:
            warnings.append({"rule": "default_max_regular_load",
                             "message": (f"{credits} ساعة أكثر من الحد الذي تخطط به ({settings.max_regular_load}). "
                                         "هذا ليس حداً نظامياً منشوراً؛ نظام التسجيل قد يسمح أو لا."),
                             "cite": rules.cite("default_max_regular_load")})
    return {"valid": not violations, "credits": credits, "courses": items, "violations": violations,
            "warnings": warnings, "notes": notes}
