"""Personalised recommendations built on the deterministic layers.

Everything here is computed; nothing is generated. The «planning rules»
(how much load suits a given recent record) are Faten's own advising
heuristics, not regulations — each one is labelled as such in the output
so the student can see where a number came from.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field

from common.grade_scale import GRADE_POINTS
from services.advisor import rules
from services.advisor.audit import DegreeAudit, audit
from services.advisor.catalog import Catalog, Curriculum
from services.advisor.planner import PREP_NOTICE, PlanResult, PlanSettings, Strategy, plan, prep_status
from services.advisor.profile import StudentProfile, effective_gpa, gpa_source

ENGINE_VERSION = "advisor-1.0"

Priority = Literal["graduate_fast", "protect_gpa", "balanced"]


class AdvisorPreferences(BaseModel):
    """What the student told us. Never inferred."""

    program_id: str | None = None
    curriculum_id: str | None = None
    priority: Priority = "balanced"
    max_load: int | None = None  # their own ceiling; None → planning default (reported)
    summer: bool = False
    target_term: str | None = None  # "1450-2"
    start_term: str | None = None
    weekly_work_hours: int | None = None  # job / commitments, voluntarily given
    program_grad_gpa: float | None = None  # if the student knows their program's minimum
    unavailable: list[dict] = Field(default_factory=list)  # [{code, term}]
    interests: list[str] = Field(default_factory=list)


class Risk(BaseModel):
    kind: str
    severity: Literal["high", "medium", "low"]
    basis: Literal["fact", "estimate"]
    message: str
    evidence: list[str] = Field(default_factory=list)


class CourseAdvice(BaseModel):
    code: str
    name: str
    credits: int
    reasons: list[str]
    unlocks: list[str]
    delay_cost_terms: int | None  # graduation delay (in terms) if postponed one term; None when not computed
    workload_evidence: dict | None
    tags: list[str]


def _times(n: int) -> str:
    return {1: "مرة واحدة", 2: "مرتين"}.get(n, f"{n} مرات")


def review_heavy(stats: dict | None) -> bool | None:
    """Evidence-based «heavy»: ≥5 verified reviews averaging ≥4/5 on difficulty or workload."""
    if not stats or (stats.get("count") or 0) < 5:
        return None
    avg = stats.get("averages") or {}
    return (avg.get("difficulty") or 0) >= 4 or (avg.get("workload") or 0) >= 4


def recommended_load(profile: StudentProfile, prefs: AdvisorPreferences) -> dict:
    """Faten planning rule (not a regulation): match next load to the recent record."""
    gpa = effective_gpa(profile)
    recent = [t for t in profile.term_gpas if (t.get("hours") or 0) >= 6]
    last = recent[-1] if recent else None
    prev = recent[-2] if len(recent) >= 2 else None
    last_fails = 0
    if last:
        last_fails = sum(1 for a in profile.attempts if a.term_key and list(a.term_key) == last["term"] and a.status == "failed")
    ceiling = prefs.max_load or rules.DEFAULT_MAX_REGULAR_LOAD
    grad_min = prefs.program_grad_gpa
    reasons: list[str] = []
    if gpa is None or last is None:
        load, mode = min(15, ceiling), "unknown"
        reasons.append("لا يوجد سجل فصول كافٍ لقياس الأداء؛ عبء متوسط افتراضي.")
    elif (grad_min is not None and gpa < grad_min) or (last["gpa"] is not None and last["gpa"] < 2.0) or last_fails >= 2:
        load, mode = min(12, ceiling), "recovery"
        if grad_min is not None and gpa < grad_min:
            reasons.append(f"معدلك {gpa:.2f} أقل من معدل التخرج الذي أدخلته ({grad_min:.2f}) — حالة إنذار أكاديمي.")
        if last["gpa"] is not None and last["gpa"] < 2.0:
            reasons.append(f"معدل آخر فصل {last['gpa']:.2f}.")
        if last_fails >= 2:
            reasons.append(f"رسبت في {last_fails} مقررات في آخر فصل.")
    elif (last["gpa"] is not None and last["gpa"] < 2.75) or (prev and prev["gpa"] and last["gpa"] is not None and prev["gpa"] - last["gpa"] >= 0.5):
        load, mode = min(14, ceiling), "careful"
        if prev and prev["gpa"] and last["gpa"] is not None and prev["gpa"] - last["gpa"] >= 0.5:
            reasons.append(f"انخفض معدلك الفصلي من {prev['gpa']:.2f} إلى {last['gpa']:.2f}.")
        else:
            reasons.append(f"معدل آخر فصل {last['gpa']:.2f}.")
    elif last["gpa"] is not None and last["gpa"] >= 3.5 and last_fails == 0 and gpa >= 3.25:
        load, mode = ceiling, "strong"
        reasons.append(f"أداؤك قوي ومستقر (آخر فصل {last['gpa']:.2f} دون رسوب) وحمل {last['hours']} ساعة بنجاح.")
    else:
        load, mode = min(16, ceiling), "steady"
        reasons.append(f"أداء مستقر (آخر فصل {last['gpa']:.2f}).")
    if prefs.weekly_work_hours and prefs.weekly_work_hours >= 15 and mode in ("strong", "steady", "unknown"):
        load = min(load, 14)
        reasons.append(f"ذكرت التزاماً بـ {prefs.weekly_work_hours} ساعة أسبوعياً خارج الدراسة.")
    load = max(load, int(rules.rule("min_regular_load").value or 10))
    return {"load": load, "mode": mode, "reasons": reasons, "basis": "قاعدة تخطيط في فطن وليست من اللائحة"}


def choose_strategy(mode: str, prefs: AdvisorPreferences) -> Strategy:
    if mode == "recovery":
        return "recovery"
    if prefs.priority == "graduate_fast" and mode in ("strong", "steady"):
        return "fastest"
    if prefs.priority == "protect_gpa":
        return "balanced" if mode != "careful" else "recovery"
    return "fastest" if mode == "strong" else "balanced"


def gpa_what_if(profile: StudentProfile, credits: int, target: float | None) -> dict:
    """Exact arithmetic: resulting cumulative GPA for a few uniform term averages."""
    # Weight by GRADED hours (failed attempts included), never by earned/passed hours.
    if profile.computed_gpa is None or not profile.gpa_hours or not credits:
        return {"available": False}
    gpa, hours, points = profile.computed_gpa, profile.gpa_hours, profile.gpa_points
    rows = []
    for letter in ("A+", "A", "B+", "B", "C+", "C", "D"):
        gp = GRADE_POINTS[letter]
        rows.append({"term_average": letter, "term_points": gp,
                     "resulting_gpa": round((points + gp * credits) / (hours + credits), 2)})
    out = {"available": True, "current_gpa": round(gpa, 2), "gpa_hours": hours, "term_credits": credits, "rows": rows,
           "note": "حساب دقيق وليس توقعاً: لو كان متوسطك في الفصل القادم كذا يصبح معدلك كذا."}
    if target:
        need = (target * (hours + credits) - points) / credits
        out["target"] = {"gpa": target, "term_average_needed": round(need, 2),
                         "reachable_this_term": need <= 4.0}
    return out


def detect_risks(profile: StudentProfile, cur: Curriculum, aud: DegreeAudit, prefs: AdvisorPreferences,
                 next_term_credits: int, next_term_heavy: int, load_info: dict) -> list[Risk]:
    risks: list[Risk] = []
    deps: dict[str, set[str]] = {}
    for c in cur.courses:
        for p in c.prerequisites:
            deps.setdefault(p, set()).add(c.code)

    def downstream(code: str) -> set[str]:
        seen, stack = set(), list(deps.get(code, ()))
        while stack:
            d = stack.pop()
            if d not in seen:
                seen.add(d)
                stack.extend(deps.get(d, ()))
        return seen

    for code, fails in sorted(profile.failed_unresolved.items()):
        blocked = downstream(code)
        sev = "high" if len(blocked) >= 3 or len(fails) >= 2 else "medium"
        retaking = code in profile.in_progress
        risks.append(Risk(kind="failed_prerequisite" if blocked else "failed_course", severity=sev, basis="fact",
                          message=(f"رسبت في {code} {_times(len(fails))} ولم تجتزه بعد"
                                   + (f"، وهو متطلب لـ {len(blocked)} مقرر في خطتك" if blocked else "")
                                   + ("؛ وتعيده هذا الفصل — نجاحك فيه شرط لخطة الفصل القادم." if retaking else ".")),
                          evidence=[f"{a.term_label or 'فصل غير معروف'}: {a.grade}" for a in fails] + sorted(blocked)[:6]))
    for code, n in sorted(profile.repeated.items()):
        if n >= 2 and code not in profile.failed_unresolved:
            risks.append(Risk(kind="repeated_course", severity="low", basis="fact",
                              message=f"درست {code} {_times(n)} قبل اجتيازه.", evidence=[]))
    for code in sorted(profile.incomplete):
        blocked = downstream(code)
        risks.append(Risk(kind="incomplete_grade", severity="medium", basis="fact",
                          message=f"{code} مرصود «غير مكتمل» ويمنع تسجيل {len(blocked)} مقرر حتى يُعدَّل.",
                          evidence=[rules.cite("ic_blocks_dependents")["text"]]))

    standing = academic_standing(profile, prefs)
    if standing["warning"]["status"] == "warning":
        risks.append(Risk(kind="academic_warning", severity="high", basis="fact", message=standing["warning"]["message"],
                          evidence=[rules.cite("warning_below_grad_gpa")["text"], rules.cite("dismissal_three_warnings")["text"]]))
    recent = [t for t in profile.term_gpas if t.get("gpa") is not None and (t.get("hours") or 0) >= 6]
    if len(recent) >= 3 and recent[-1]["gpa"] < recent[-2]["gpa"] < recent[-3]["gpa"]:
        risks.append(Risk(kind="declining_trend", severity="medium", basis="fact",
                          message="معدلك الفصلي انخفض ثلاثة فصول متتالية.",
                          evidence=[f"{t['label']}: {t['gpa']:.2f}" for t in recent[-3:]]))
    if recent:
        best_load = max((t["hours"] for t in recent if t["gpa"] >= 2.75), default=None)
        if best_load and next_term_credits > best_load + 3:
            risks.append(Risk(kind="load_jump", severity="medium", basis="estimate",
                              message=(f"العبء المقترح {next_term_credits} ساعة أعلى بوضوح من أعلى عبء نجحت فيه بمعدل جيد ({best_load})."),
                              evidence=["تقدير مبني على سجلك، وليس يقيناً."]))
    if next_term_heavy >= 3:
        risks.append(Risk(kind="heavy_combination", severity="medium", basis="estimate",
                          message=f"{next_term_heavy} مقررات ثقيلة في فصل واحد (حسب تقييمات طلاب موثّقة أو رسوب سابق).",
                          evidence=[]))
    # Courses that gate a large part of what's left.
    remaining = {r.code for r in aud.courses if r.state in ("remaining", "failed")}
    for code in sorted(remaining):
        blocked = downstream(code) & remaining
        if len(blocked) >= max(5, len(remaining) // 4) and code not in profile.failed_unresolved:
            risks.append(Risk(kind="gatekeeper", severity="low", basis="fact",
                              message=f"{code} مفتاح لـ {len(blocked)} من مقرراتك المتبقية؛ تأخيره يؤخر كثيراً.",
                              evidence=sorted(blocked)[:8]))
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(risks, key=lambda r: (order[r.severity], r.kind, r.message))


def academic_standing(profile: StudentProfile, prefs: AdvisorPreferences) -> dict:
    """Graduation requirement and warning status — two different rules sharing one threshold.

    The threshold is each program's graduation GPA, set by the University Council
    and not published for these programs. The only verified number is the floor:
    no program's graduation GPA can be below «مقبول» (1.00/4.00)."""
    gpa = effective_gpa(profile)
    floor = float(rules.rule("grad_gpa_floor").value or 1.0)
    threshold = prefs.program_grad_gpa
    graduation = {
        "rule": rules.cite("graduation_requirement"),
        "program_gpa": threshold,
        "program_gpa_source": "student" if threshold is not None else "unknown",
        "floor": floor,
        "message": (f"معدل التخرج لتخصصك حسب ما أدخلته: {threshold:.2f} (غير موثّق من مصدر رسمي لدينا)."
                    if threshold is not None else
                    "معدل التخرج لتخصصك يحدده مجلس الجامعة ولم نجده منشوراً؛ المؤكد فقط أنه لا يقل عن 1.00 (مقبول)."),
    }
    if gpa is None:
        warning = {"status": "unknown", "basis": "no_gpa", "message": "لا يوجد معدل تراكمي لتقييم حالة الإنذار."}
    elif threshold is not None:
        warning = ({"status": "warning", "basis": "student_threshold",
                    "message": (f"معدلك المحسوب {gpa:.2f} أقل من معدل التخرج الذي أدخلته لتخصصك ({threshold:.2f}). إن صحّ هذا المعدل "
                                "فهذا بحسب اللائحة إنذار أكاديمي بنهاية الفصل العادي.")}
                   if gpa < threshold else
                   {"status": "clear", "basis": "student_threshold",
                    "message": f"معدلك {gpa:.2f} ليس أقل من معدل التخرج الذي أدخلته ({threshold:.2f})."})
    elif gpa < floor:
        warning = {"status": "warning", "basis": "floor",
                   "message": (f"معدلك المحسوب {gpa:.2f} أقل من 1.00، وأي معدل تخرج لأي تخصص لا يقل عن 1.00 بنص اللائحة؛ "
                               "فالمعدل أقل من معدل تخرج تخصصك يقيناً. إذا كان هذا معدلك الرسمي بنهاية فصل عادي "
                               "(لا صيفي) فهذا إنذار أكاديمي.")}
    else:
        warning = {"status": "unknown", "basis": "threshold_unknown",
                   "message": (f"لا يمكن الجزم بحالة الإنذار: معدلك {gpa:.2f}، ومعدل التخرج لتخصصك غير منشور. "
                               "أدخله من الإعدادات إن عرفته من القسم أو من نظام التسجيل.")}
    last = max((a.term_key for a in profile.attempts if a.term_key and a.counts_in_gpa), default=None)
    if warning["status"] == "warning" and last and last[1] == 3:
        warning["message"] += " آخر فصل مرصود في سجلك صيفي، والصيفي لا تُمنح فيه إنذارات؛ يُحسم الإنذار بنهاية الفصل العادي التالي."
    warning["certainty"] = {"floor": "mathematical", "student_threshold": "depends_on_student_input"}.get(warning["basis"], "undetermined")
    warning["rule"] = rules.cite("warning_below_grad_gpa")
    warning["summer_note"] = rules.cite("summer_no_warning")["text"]
    return {"graduation": graduation, "warning": warning}


def curriculum_fit(profile: StudentProfile, cur: Curriculum) -> dict:
    """Does the student's record look like THIS curriculum or a documented older edition?

    Measured, not guessed: share of passed courses found in the plan, and course codes
    that appear only in a documented other edition (e.g. a Plan 44 handbook)."""
    passed = sorted(profile.passed)
    plan_codes = {c.code for c in cur.courses} | {o.code for o in cur.elective_options}
    in_plan = [c for c in passed if c in plan_codes]
    editions = []
    for ed in cur.other_editions:
        exclusive = set(ed.get("codes") or []) - plan_codes
        hits = sorted(set(passed) & exclusive)
        if hits:
            editions.append({"label": ed["label"], "total_hours": ed.get("total_hours"), "document": ed["document"],
                             "url": ed.get("url"), "matched_codes": hits})
    ratio = len(in_plan) / len(passed) if passed else None
    if not passed:
        verdict, message = "insufficient_data", "لا توجد مقررات مجتازة لمقارنتها بالخطة."
    elif any(len(e["matched_codes"]) >= 2 for e in editions):
        e = max(editions, key=lambda e: len(e["matched_codes"]))
        verdict = "other_edition"
        message = (f"{len(e['matched_codes'])} من مقرراتك المجتازة تظهر في {e['label']} ({e['total_hours']} ساعة) ولا تظهر في الخطة المنشورة "
                   f"({cur.stated_total_hours} ساعة): {', '.join(e['matched_codes'][:6])}. غالباً أنت على إصدار مختلف؛ "
                   "المقارنة بالخطة الحالية قد لا تنطبق عليك — أكّد خطتك مع القسم.")
    elif len(passed) >= 6 and ratio is not None and ratio < 0.5:
        verdict = "mismatch"
        message = (f"{len(in_plan)} فقط من {len(passed)} مقرراً مجتازاً موجودة في الخطة المنشورة؛ "
                   "قد تكون على خطة أخرى أو تخصص آخر.")
    else:
        verdict = "consistent"
        message = f"{len(in_plan)} من {len(passed)} مقرراً مجتازاً موجودة في الخطة المنشورة."
    return {"verdict": verdict, "message": message, "passed": len(passed), "in_plan": len(in_plan),
            "ratio": round(ratio, 2) if ratio is not None else None, "editions": editions}


def elective_options_for(profile: StudentProfile, catalog: Catalog, cur: Curriculum) -> dict:
    passed = set(profile.passed) | set(profile.in_progress)
    rows = []
    for o in cur.elective_options:
        missing = [p for p in o.prerequisites if p not in passed]
        co_missing = [q for q in o.corequisites if q not in passed]
        doc = catalog.documents.get(o.source)
        rows.append({"code": o.code, "title": o.title, "credits": o.credits, "level": o.level,
                     "prerequisites": o.prerequisites, "corequisites": o.corequisites,
                     "taken": o.code in profile.passed,
                     "eligible": not missing and o.code not in profile.passed,
                     "missing_prerequisites": missing, "corequisites_to_pair": co_missing,
                     "source_url": o.source_url,
                     "document": {"title": doc.title, "version": doc.doc_version, "date": doc.doc_date_label} if doc else None})
    return {"options": rows, "complete": cur.elective_options_complete, "required_hours": cur.unlisted_hours,
            "note": ("مقررات وُصفت بأنها اختيارية في توصيفاتها الرسمية. القائمة جزئية: لا نعرف كل الخيارات ولا توزيع "
                     f"الـ {cur.unlisted_hours} ساعة بين اختياري جامعة وقسم؛ تبقى الخانات في الخطة بلا أسماء.")
            if rows else None}


def uncertainties(cur: Curriculum, prefs: AdvisorPreferences, standing: dict, fit: dict, plan_uses_default: bool) -> list[dict]:
    """What we do not know, and exactly how it bends the recommendation."""
    out = []
    if cur.unlisted_hours:
        out.append({"topic": "electives", "message": f"{cur.unlisted_hours} ساعة اختيارية بلا قائمة رسمية كاملة.",
                    "effect": "جُدولت كخانات عامة؛ موعد التخرج يفترض أنك ستجد مقررات اختيارية مطروحة بهذا القدر."})
    out.append({"topic": "offerings", "message": "المقررات المطروحة لكل فصل غير منشورة.",
                "effect": "الخطة ممكنة رياضياً وقد يتأخر مقرر غير مطروح؛ علّم «غير مطروح» ليعيد المخطط الحساب."})
    out.append({"topic": "prerequisite_semantics", "message": "لا يُنص على أن المتطلبات المتعددة «و» أو «أو».",
                "effect": "نعتبرها كلها لازمة، فقد يقترح المخطط تأجيل مقرر يمكن أخذه فعلاً بمتطلب واحد."})
    if plan_uses_default:
        out.append({"topic": "max_load", "message": "لا يوجد حد أعلى منشور للعبء في الفصل العادي.",
                    "effect": f"نخطط بحد افتراضي {rules.DEFAULT_MAX_REGULAR_LOAD} ساعة؛ لو كان النظام يسمح بأقل فسيطول المسار الأسرع."})
    if standing["graduation"]["program_gpa_source"] == "unknown":
        out.append({"topic": "graduation_gpa", "message": "معدل التخرج لتخصصك غير منشور.",
                    "effect": "لا نحكم بالإنذار إلا تحت 1.00؛ عبء التعافي يُقترح بناءً على أدائك الفصلي فقط."})
    out.append({"topic": "level_restrictions", "message": "قيود التسجيل حسب المستوى أو الساعات المجتازة غير منشورة.",
                "effect": "مقررات «قبل موعدها» قد يرفضها نظام التسجيل."})
    if any(pc.special_conditions for pc in cur.courses):
        codes = [pc.code for pc in cur.courses if pc.special_conditions]
        out.append({"topic": "approvals", "message": f"مقررات تتطلب موافقة القسم حسب توصيفها: {', '.join(codes)}.",
                    "effect": "جُدولت بافتراض حصولك على الموافقة."})
    if fit["verdict"] in ("other_edition", "mismatch"):
        out.append({"topic": "curriculum_version", "message": fit["message"],
                    "effect": "قد تكون المقررات المتبقية وساعات التخرج مختلفة لديك؛ النتائج تقديرية حتى تؤكد خطتك."})
    else:
        out.append({"topic": "curriculum_version", "message": "إصدار خطتك غير معروف؛ نقارنك بالخطة المنشورة حالياً.",
                    "effect": "إن التحقت بإصدار أقدم فقد تختلف بعض المقررات."})
    return out


def confidence(profile: StudentProfile, cur: Curriculum, prefs: AdvisorPreferences, program_source: str,
               fit: dict | None = None) -> dict:
    """Qualitative confidence from data completeness — no invented percentages."""
    reasons, level = [], "high"

    def lower(to: str, why: str) -> None:
        nonlocal level
        rank = {"high": 2, "medium": 1, "low": 0}
        if rank[to] < rank[level]:
            level = to
        reasons.append(why)

    if not profile.attempts:
        lower("low", "لا يوجد سجل أكاديمي؛ نعرف الخطة لا وضعك.")
    if program_source != "student":
        lower("medium", "التخصص لم تحدده أنت؛ استُنتج من السجل.")
    if cur.verification != "verified":
        lower("medium", f"الخطة الرسمية ناقصة: {cur.unlisted_hours} ساعة اختيارية غير منشورة.")
    if profile.data_gaps:
        lower("medium", f"{len(profile.data_gaps)} نقص في البيانات (انظر القائمة).")
    if profile.gpa_discrepancy and profile.gpa_discrepancy > 0.02:
        lower("medium", "المعدل المحسوب يختلف عن معدل السجل.")
    if profile.student_entered:
        lower("medium", "بعض المقررات أُدخلت يدوياً ولم تُوثَّق.")
    if fit and fit["verdict"] in ("other_edition", "mismatch"):
        lower("low", "سجلك لا يطابق الخطة المنشورة (انظر «مطابقة الخطة»).")
    reasons.append("طرح المقررات في كل فصل غير منشور؛ الخطة ممكنة رياضياً لا مؤكدة للتسجيل.")
    reasons.append("خطتك تُقارن بالخطة المنشورة حالياً؛ إن التحقت بخطة أقدم فقد تختلف بعض المقررات.")
    return {"level": level, "reasons": reasons}


def _delay_cost(code: str, profile, catalog, cur, settings: PlanSettings, strategy: Strategy, cap: int,
                baseline: PlanResult, today) -> int | None:
    if not baseline.complete:
        return None
    first_term = baseline.terms[0].term if baseline.terms else None
    if not first_term:
        return None
    s2 = settings.model_copy(update={"unavailable": settings.unavailable + [{"code": code, "term": first_term}]})
    alt = plan(profile, catalog, cur, s2, strategy, cap, today)
    if not alt.complete:
        return None
    return alt.terms_needed - baseline.terms_needed


def analyze(
    profile: StudentProfile,
    catalog: Catalog,
    cur: Curriculum,
    prefs: AdvisorPreferences,
    program_source: str = "student",
    review_stats: dict[str, dict] | None = None,
    today: dt.date | None = None,
) -> dict:
    """Full advisory run. Pure function of its inputs (reproducible)."""
    review_stats = review_stats or {}
    aud = audit(profile, catalog, cur)
    load_info = recommended_load(profile, prefs)
    heavy = sorted(code for code, s in review_stats.items() if review_heavy(s))
    max_load = prefs.max_load or rules.DEFAULT_MAX_REGULAR_LOAD
    base = PlanSettings(
        max_regular_load=max_load, max_regular_load_is_default=prefs.max_load is None, summer=prefs.summer,
        start_term=prefs.start_term, target_term=prefs.target_term, unavailable=prefs.unavailable,
        heavy_courses=heavy,
    )
    recovery_cap = max(int(rules.rule("min_regular_load").value or 10), min(12, max_load))
    balanced_cap = min(max_load, max(load_info["load"], 13)) if load_info["mode"] != "recovery" else min(max_load, 14)
    scenarios = {
        "fastest": plan(profile, catalog, cur, base, "fastest", max_load, today),
        "balanced": plan(profile, catalog, cur, base.model_copy(update={"heavy_limit": 2}), "balanced", balanced_cap, today),
        "recovery": plan(profile, catalog, cur, base.model_copy(update={"heavy_limit": 1}), "recovery", recovery_cap, today),
    }
    chosen: Strategy = choose_strategy(load_info["mode"], prefs)
    picked = scenarios[chosen]
    first = picked.terms[0] if picked.terms else None

    next_courses: list[CourseAdvice] = []
    if first:
        cap_used = picked.load_cap
        settings_used = base.model_copy(update={"heavy_limit": {"fastest": None, "balanced": 2, "recovery": 1}[chosen]})
        deps: dict[str, list[str]] = {}
        for c in cur.courses:
            for p in c.prerequisites:
                deps.setdefault(p, []).append(c.code)
        for pcourse in first.courses:
            if pcourse.kind == "elective":
                next_courses.append(CourseAdvice(code=pcourse.code, name=pcourse.name, credits=pcourse.credits,
                                                 reasons=["خانة اختيارية: اختر مقرراً من قائمة قسمك الاختيارية."],
                                                 unlocks=[], delay_cost_terms=None, workload_evidence=None, tags=pcourse.tags))
                continue
            reasons = []
            if pcourse.code in profile.failed_unresolved:
                reasons.append("إعادة مقرر لم تجتزه بعد.")
            direct = sorted(deps.get(pcourse.code, []))
            if direct:
                reasons.append(f"متطلب سابق لـ {len(direct)} مقرر: {', '.join(direct[:5])}.")
            if "critical" in pcourse.tags:
                reasons.append("على أطول سلسلة متطلبات متبقية في خطتك.")
            cost = _delay_cost(pcourse.code, profile, catalog, cur, settings_used, chosen, cap_used, picked, today)
            if cost and cost > 0:
                reasons.append(f"تأجيله فصلاً يؤخر موعد تخرجك المحسوب {cost} فصل.")
            elif cost == 0:
                reasons.append("تأجيله فصلاً لا يغيّر موعد التخرج المحسوب (فيه مرونة ضمن افتراضات الخطة).")
            if not reasons:
                reasons.append(f"من مقررات المستوى {cur.course(pcourse.code).level} في خطتك ومتطلباته مستوفاة.")
            pc_full = cur.course(pcourse.code)
            pending = [q for q in pc_full.prerequisites if q in profile.in_progress]
            if pending:
                reasons.insert(0, f"مشروط بنجاحك في {', '.join(pending)} هذا الفصل؛ إن لم تنجح فلن يُتاح لك.")
                pcourse.tags.append("conditional")
            for cond in pc_full.special_conditions:
                reasons.append(f"تنبيه: {cond['text']}.")
            if pc_full.evidence:
                reasons.append("متطلباته ومستواه مؤكدة أيضاً في توصيف المقرر الرسمي.")
            if pc_full.prereq_source == "college_list":
                page = "، ".join(pc_full.plan_page_prerequisites or []) or "لا شيء"
                reasons.append(f"متطلباته حسب قائمة الكلية المعتمدة في فطن؛ صفحة الخطة في موقع الجامعة تذكر: {page}.")
            stats = review_stats.get(pcourse.code)
            next_courses.append(CourseAdvice(
                code=pcourse.code, name=pcourse.name, credits=pcourse.credits, reasons=reasons, unlocks=direct,
                delay_cost_terms=cost, workload_evidence=_workload(stats), tags=pcourse.tags,
            ))

    eligible = [r for r in aud.courses if r.eligible_next_term]
    chosen_codes = {c.code for c in next_courses}
    first_term_key = first.term if first else None
    heavy_set = set(heavy) | set(profile.failed_unresolved)
    heavy_in_first = sum(1 for c in (first.courses if first else []) if c.code in heavy_set)
    limit = {"fastest": None, "balanced": 2, "recovery": 1}[chosen]

    def why_not(r) -> str:
        if any(u.get("code") == r.code and u.get("term") in ("next", "all", first_term_key) for u in prefs.unavailable):
            return "ذكرت أنه غير مطروح في الفصل القادم."
        if r.code in heavy_set and limit is not None and heavy_in_first >= limit:
            return (f"أجّلناه لأن المسار المختار لا يجمع أكثر من {limit} "
                    f"{'مقرراً ثقيلاً أو سبق رسوبك فيه' if limit > 1 else 'مقرر ثقيل أو سبق رسوبك فيه'} في فصل واحد.")
        return "لم يتسع له العبء المقترح، ومقررات أخرى أولى منه (أطول سلسلة متطلبات أو مستوى أبكر)."

    alternatives = [
        {"code": r.code, "name": r.name, "credits": r.credits, "level": r.level, "why_not_now": why_not(r)}
        for r in sorted(eligible, key=lambda r: (r.code not in profile.failed_unresolved, r.level, r.code))
        if r.code not in chosen_codes
    ][:10]
    next_credits = first.credits if first else 0
    heavy_next = sum(1 for c in (first.courses if first else []) if "heavy" in c.tags)
    risks = detect_risks(profile, cur, aud, prefs, next_credits, heavy_next, load_info)
    target_gpa = None
    what_if = gpa_what_if(profile, next_credits, target_gpa)
    fit = curriculum_fit(profile, cur)
    standing = academic_standing(profile, prefs)
    plan_applicable = fit["verdict"] not in ("other_edition", "mismatch")
    withheld_reason = None
    if not plan_applicable:
        # We hold no data for the student's actual curriculum (e.g. Plan 44): any course list
        # or graduation date computed against the current plan would be advice for the wrong plan.
        withheld_reason = (fit["message"] + " لا يملك فطن بيانات تلك الخطة ولا يستطيع التخطيط عليها، لذلك لا نقترح مقررات "
                           "ولا موعد تخرج. راجع القسم أو نظام التسجيل لمعرفة خطتك.")
        next_courses, alternatives = [], []
        what_if = {"available": False, "reason": "withheld_other_curriculum"}
        # Keep only risks that come from the record itself, not from the current plan's structure.
        risks = [r for r in risks if r.kind in ("academic_warning", "declining_trend", "repeated_course")]
    conf = confidence(profile, cur, prefs, program_source, fit)

    inputs_fingerprint = hashlib.sha256(json.dumps({
        "attempts": [a.model_dump() for a in profile.attempts], "prefs": prefs.model_dump(),
        "curriculum": cur.id, "raw": cur.provenance.raw_sha256, "reviews": review_stats,
        "start": scenarios["balanced"].terms[0].term if scenarios["balanced"].terms else None,
        "engine": ENGINE_VERSION,
    }, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()

    return {
        "engine_version": ENGINE_VERSION,
        "inputs_fingerprint": inputs_fingerprint,
        "program": {"id": cur.program_id, "name": catalog.programs[cur.program_id].name_ar, "source": program_source},
        "curriculum": {"id": cur.id, "label": cur.version_label, "verification": cur.verification,
                       "source_url": cur.provenance.source_url, "retrieved_at": cur.provenance.retrieved_at,
                       "issues": [i.model_dump() for i in cur.issues if i.severity != "info" or i.code in ("prereq_relation_assumed", "no_offering_data", "college_list_applied")]},
        "profile": {
            "gpa": effective_gpa(profile), "gpa_source": gpa_source(profile),
            "computed_gpa": profile.computed_gpa, "stated_gpa": profile.stated_gpa, "gpa_hours": profile.gpa_hours,
            "earned_hours": profile.earned_hours, "stated_earned_hours": profile.stated_earned_hours,
            "term_gpas": profile.term_gpas, "category_performance": profile.category_performance,
            "failed_unresolved": sorted(profile.failed_unresolved), "in_progress": sorted(profile.in_progress),
            "incomplete": sorted(profile.incomplete), "repeated": profile.repeated, "notes": profile.notes,
        },
        "data_gaps": [g.model_dump() for g in profile.data_gaps],
        "audit": aud.model_dump(),
        "load": load_info,
        "recommended_strategy": chosen,
        "strategy_reason": _strategy_reason(chosen, load_info, prefs),
        "plan_applicable": plan_applicable,
        "withheld_reason": withheld_reason,
        "next_term": {
            "term": first.term if first else None, "label": first.label if first else None,
            "credits": next_credits if plan_applicable else 0, "courses": [c.model_dump() for c in next_courses],
            "warnings": first.warnings if first else [], "alternatives": alternatives,
        },
        "scenarios": {k: {**v.model_dump(), "applicable": plan_applicable} for k, v in scenarios.items()},
        "risks": [r.model_dump() for r in risks],
        "gpa_what_if": what_if,
        "confidence": conf,
        "standing": standing,
        "prep_year": _prep_info(profile, cur),
        "curriculum_fit": fit,
        "elective_options": elective_options_for(profile, catalog, cur),
        "uncertainties": uncertainties(cur, prefs, standing, fit, prefs.max_load is None),
        "documents": [
            {"id": d.id, "type": d.type, "title": d.title, "url": d.url, "version": d.doc_version,
             "date": d.doc_date_label, "applicability": d.applicability, "reason": d.applicability_reason}
            for d in (catalog.documents.get(i) for i in cur.documents) if d
        ] + ([{"id": "uqu-regulation-1480", "type": "regulation", "title": rules.STUDY_RULES_DOC, "url": rules.STUDY_RULES_URL,
               "version": None, "date": f"تاريخ آخر تعديل: {rules.STUDY_RULES_DOC_DATE}", "applicability": "applicable", "reason": None}]),
        "rules": [rules.cite(r) for r in ("min_regular_load", "max_summer_load", "prerequisites_required", "corequisites",
                                           "coop_exclusive", "prep_year_registration", "graduation_requirement",
                                           "warning_below_grad_gpa", "dismissal_three_warnings", "max_regular_load",
                                           "default_max_regular_load", "program_grad_gpa", "prereq_and_or", "offerings")],
    }


def _prep_info(profile: StudentProfile, cur: Curriculum) -> dict | None:
    if not cur.prep_year:
        return None
    in_prep, _ = prep_status(profile, cur)
    return {"in_prep": in_prep, "levels": cur.prep_year.levels, "hours": cur.prep_year.hours,
            "source_id": cur.prep_year.source_id, "matches_plan": cur.prep_year.matches_plan,
            "notice": PREP_NOTICE if in_prep else None, "rule": rules.cite("prep_year_registration")}


def _workload(stats: dict | None) -> dict | None:
    if not stats or not stats.get("count"):
        return None
    heavy = review_heavy(stats)
    return {"count": stats["count"], "averages": stats.get("averages"), "heavy": heavy,
            "note": "تقييمات طلاب درسوا المقرر (موثّقة من سجلاتهم)" + ("" if stats["count"] >= 5 else " — عددها قليل فلا يُعتمد عليها")}


def _strategy_reason(chosen: Strategy, load_info: dict, prefs: AdvisorPreferences) -> str:
    base = {
        "fastest": "اخترنا مسار التخرج الأسرع لأن أداءك الأخير يحتمل عبئاً أعلى",
        "balanced": "اخترنا المسار المتوازن ليحمي معدلك دون تأخير كبير",
        "recovery": "اخترنا مسار التعافي: عبء أخف وأولوية لإعادة المقررات المفتاحية",
    }[chosen]
    pref = {"graduate_fast": "وأنت تفضّل التخرج أسرع", "protect_gpa": "وأنت تفضّل حماية المعدل", "balanced": ""}[prefs.priority]
    return f"{base}{('، ' + pref) if pref else ''}. {' '.join(load_info['reasons'])}"
