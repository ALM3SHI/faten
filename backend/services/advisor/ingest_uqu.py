"""UQU study-plan ingestion: raw page captures → validated catalog.json.

    python -m services.advisor.ingest_uqu            # from backend/
    python -m services.advisor.ingest_uqu --check    # validate only, exit 1 on errors

Input: knowledge/catalog/uqu/raw/degree-<id>[@<anything>].psv, written from
the output of capture_degree.js (one line per course, text exactly as the
official page shows it). Several snapshots of the same degree become
successive curriculum versions, so a plan change never overwrites the
version older students are still on.

Every check below records an Issue instead of silently fixing data:
the advisor shows those issues next to the plan they affect.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from services.advisor.catalog import (
    CATALOG_ROOT,
    Catalog,
    Course,
    Curriculum,
    Issue,
    PlanCourse,
    Program,
    Provenance,
    University,
    normalize_code,
)

UQU = University(id="uqu", name_ar="جامعة أم القرى", name_en="Umm Al-Qura University", website="https://uqu.edu.sa")
ROOT = CATALOG_ROOT / "uqu"
RAW = ROOT / "raw"

_AR_HOURS = {"ساعة": 1, "ساعة واحدة": 1, "ساعتين": 2, "ساعتان": 2, "لا توجد ساعات": 0}
_EN_HOURS = {"One hour": 1, "Two hours": 2, "No hours": 0}
_BADGE = {"": 0, "متطلب واحد": 1, "متطلبين": 2}
_COOP_RE = re.compile(r"تدريب\s*(ال)?تعاوني|التدريب التعاوني|CO-?OP|Cooperative|Cooprative", re.IGNORECASE)


class RawCourse:
    __slots__ = ("level", "code", "name_ar", "hours_text", "badge", "page_id", "name_en", "header_labels", "has_tab", "prereqs")

    def __init__(self, parts: list[str]):
        if len(parts) != 10:
            raise ValueError(f"expected 10 fields, got {len(parts)}")
        (level, self.code, self.name_ar, self.hours_text, self.badge, self.page_id,
         self.name_en, labels, has_tab, prereqs) = parts
        self.level = int(level)
        self.header_labels = labels.split("/") if labels else []
        self.has_tab = has_tab == "1"
        self.prereqs = []
        for item in filter(None, prereqs.split(";")):
            code, name_en, plabels = (item.split("~") + ["", ""])[:3]
            self.prereqs.append((code, name_en, plabels.split("/") if plabels else []))


def parse_hours_ar(text: str) -> int | None:
    t = (text or "").strip()
    if t in _AR_HOURS:
        return _AR_HOURS[t]
    m = re.fullmatch(r"(\d+)\s*ساعات?", t)
    return int(m.group(1)) if m else None


def parse_hours_en(text: str) -> int | None:
    t = (text or "").strip()
    if t in _EN_HOURS:
        return _EN_HOURS[t]
    m = re.fullmatch(r"(\d+)\s*hours?", t)
    return int(m.group(1)) if m else None


def read_snapshot(path: Path) -> tuple[dict, list[RawCourse], list[str]]:
    header, courses, warnings = None, [], []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        if line.startswith("#degree|"):
            f = line.split("|")
            header = {
                "degree_id": f[1], "title_ar": f[2], "degree_type": f[3], "college": f[4],
                "department": f[5], "stated_total_hours": int(f[6]) if f[6].isdigit() else None,
                "retrieved_at": f[7], "source_url": f[8],
            }
        elif line.startswith("#warnings|"):
            warnings.extend(line.split("|", 1)[1].split(";"))
        elif not line.startswith("#"):
            try:
                courses.append(RawCourse(line.split("|")))
            except ValueError as exc:
                raise ValueError(f"{path.name}:{n}: {exc}") from exc
    if header is None:
        raise ValueError(f"{path.name}: missing #degree header")
    return header, courses, warnings


def _find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    WHITE, GREY, BLACK = 0, 1, 2
    color = defaultdict(int)
    stack: list[str] = []

    def visit(u: str) -> list[str] | None:
        color[u] = GREY
        stack.append(u)
        for v in graph.get(u, []):
            if color[v] == GREY:
                return stack[stack.index(v):] + [v]
            if color[v] == WHITE and v in graph:
                found = visit(v)
                if found:
                    return found
        stack.pop()
        color[u] = BLACK
        return None

    for node in sorted(graph):
        if color[node] == WHITE:
            found = visit(node)
            if found:
                return found
    return None


def build_curriculum(path: Path) -> tuple[Program, Curriculum, list[RawCourse]]:
    header, raw, capture_warnings = read_snapshot(path)
    program_id = f"uqu-{header['degree_id']}"
    day = header["retrieved_at"][:10]
    cid = f"{program_id}@{day}"
    issues: list[Issue] = [Issue(severity="warning", code="capture_warning", message=w) for w in capture_warnings]
    plan: list[PlanCourse] = []
    seen: set[str] = set()

    for rc in raw:
        code = normalize_code(rc.code)
        if not code:
            issues.append(Issue(severity="error", code="bad_code", message=f"رمز غير صالح: {rc.code!r}", subject=rc.code))
            continue
        if code in seen:
            issues.append(Issue(severity="error", code="duplicate_course", message=f"{code} مكرر في الخطة", subject=code))
            continue
        seen.add(code)
        hours = parse_hours_ar(rc.hours_text)
        en_hours = parse_hours_en(rc.header_labels[0]) if rc.header_labels else None
        verification = "verified"
        if hours is None:
            issues.append(Issue(severity="error", code="unparsed_hours", message=f"تعذّر قراءة ساعات {code}: {rc.hours_text!r}", subject=code))
            hours = 0
            verification = "conflicting"
        elif en_hours is not None and en_hours != hours:
            issues.append(Issue(severity="warning", code="hours_ar_en_mismatch",
                                message=f"{code}: الخطة العربية {hours} ساعات والصفحة الإنجليزية {en_hours}", subject=code))
            verification = "conflicting"
        prereqs = [normalize_code(p[0]) for p in rc.prereqs if normalize_code(p[0])]
        expected = _BADGE.get(rc.badge.strip())
        if expected is not None and expected != len(prereqs):
            issues.append(Issue(severity="warning", code="prereq_count_mismatch",
                                message=f"{code}: الخطة تقول «{rc.badge or 'لا متطلبات'}» وصفحة المقرر تذكر {len(prereqs)}", subject=code))
            verification = "conflicting"
        is_coop = bool(_COOP_RE.search(rc.name_ar) or _COOP_RE.search(rc.name_en))
        plan.append(PlanCourse(
            code=code, level=rc.level, credits=hours, prerequisites=prereqs,
            kind="coop" if is_coop else "required",
            source_url=f"https://uqu.edu.sa/en/App/Degrees/{header['degree_id']}/{rc.page_id}" if rc.page_id else header["source_url"],
            verification=verification,
        ))

    by_code = {c.code: c for c in plan}
    card_hours_mismatch = 0
    for rc in raw:
        code = normalize_code(rc.code)
        course = by_code.get(code)
        if not course:
            continue
        for pcode, _name, plabels in rc.prereqs:
            pc = by_code.get(normalize_code(pcode))
            if pc is None:
                issues.append(Issue(severity="warning", code="prereq_outside_plan",
                                    message=f"{code} يتطلب {pcode} وهو غير موجود في هذه الخطة", subject=code))
                continue
            if pc.level >= course.level:
                issues.append(Issue(severity="info", code="prereq_level_order",
                                    message=f"{code} (المستوى {course.level}) يتطلب {pc.code} (المستوى {pc.level})", subject=code))
            card_h = parse_hours_en(plabels[0]) if plabels else None
            if card_h is not None and card_h != pc.credits:
                card_hours_mismatch += 1
    if card_hours_mismatch:
        issues.append(Issue(severity="info", code="prereq_card_hours_ignored",
                            message=(f"{card_hours_mismatch} بطاقة متطلب سابق تعرض ساعات المقرر التابع لا ساعات المتطلب نفسه؛ "
                                     "اعتُمدت ساعات الخطة الرئيسية.")))

    cycle = _find_cycle({c.code: c.prerequisites for c in plan})
    if cycle:
        issues.append(Issue(severity="error", code="prereq_cycle", message=" ← ".join(cycle)))

    listed = sum(c.credits for c in plan)
    stated = header["stated_total_hours"]
    unlisted = max(0, (stated or listed) - listed)
    if stated is not None and listed > stated:
        issues.append(Issue(severity="warning", code="listed_exceeds_stated",
                            message=f"مجموع ساعات المقررات المعروضة {listed} أكبر من ساعات البرنامج المعلنة {stated}"))
    if unlisted:
        issues.append(Issue(severity="warning", code="unlisted_hours",
                            message=(f"البرنامج {stated} ساعة، والمقررات المنشورة في الخطة مجموعها {listed} ساعة. "
                                     f"{unlisted} ساعة (غالباً مقررات اختيارية) لم تُنشر قائمتها في صفحة الخطة.")))
    issues.append(Issue(severity="info", code="prereq_relation_assumed",
                        message="الصفحة لا توضّح إن كانت المتطلبات المتعددة «و» أو «أو»؛ عوملت كلها كمتطلبات لازمة (و)."))
    issues.append(Issue(severity="info", code="no_offering_data",
                        message="لا تنشر الجامعة علناً المقررات المطروحة في كل فصل؛ الخطة متاحة رياضياً لا مؤكدة للتسجيل."))

    has_error = any(i.severity == "error" for i in issues)
    status = "conflicting" if has_error else ("incomplete" if unlisted else "verified")
    raw_bytes = path.read_bytes()
    curriculum = Curriculum(
        id=cid,
        program_id=program_id,
        version_label=f"الخطة المنشورة على موقع الجامعة (استُرجعت {day})",
        provenance=Provenance(
            source_url=header["source_url"], retrieved_at=header["retrieved_at"],
            raw_file=f"raw/{path.name}", raw_sha256=hashlib.sha256(raw_bytes).hexdigest(),
        ),
        stated_total_hours=stated, listed_hours=listed, unlisted_hours=unlisted,
        levels=max((c.level for c in plan), default=0), courses=plan,
        verification=status, issues=issues,
    )
    program = Program(
        id=program_id, university="uqu", source_id=header["degree_id"], name_ar=header["title_ar"],
        degree_type=header["degree_type"], college_ar=header["college"], department_ar=header["department"],
        curricula=[cid],
    )
    return program, curriculum, raw


def build_catalog(raw_dir: Path = RAW) -> Catalog:
    programs: dict[str, Program] = {}
    curricula: dict[str, Curriculum] = {}
    names: dict[str, dict[str, set]] = defaultdict(lambda: {"ar": set(), "en": set(), "credits": set(), "seen": set()})
    global_issues: list[Issue] = []

    for path in sorted(raw_dir.glob("degree-*.psv")):
        program, cur, raw = build_curriculum(path)
        if cur.id in curricula:
            # Same degree captured twice on one day: keep the later file, note it.
            global_issues.append(Issue(severity="info", code="duplicate_snapshot", message=f"{path.name} يكرر {cur.id}"))
        curricula[cur.id] = cur
        if program.id in programs:
            prev = programs[program.id]
            prev.curricula = sorted(set(prev.curricula) | {cur.id})
            prev.name_ar = program.name_ar  # latest wording
        else:
            programs[program.id] = program
        for rc in raw:
            code = normalize_code(rc.code)
            if not code:
                continue
            entry = names[code]
            entry["ar"].add(rc.name_ar.strip())
            entry["en"].add(rc.name_en.strip())
            hours = parse_hours_ar(rc.hours_text)
            if hours is not None:
                entry["credits"].add(hours)
            entry["seen"].add(program.id)

    # Plan changes between successive versions of the same program.
    for prog in programs.values():
        for older, newer in zip(prog.curricula, prog.curricula[1:]):
            a = {c.code for c in curricula[older].courses}
            b = {c.code for c in curricula[newer].courses}
            if a != b:
                curricula[newer].issues.append(Issue(
                    severity="info", code="plan_changed",
                    message=f"مقارنة بـ {older}: أُضيف {sorted(b - a)} وحُذف {sorted(a - b)}"))

    courses: dict[str, Course] = {}
    for code, e in sorted(names.items()):
        if len(e["ar"]) > 1:
            global_issues.append(Issue(severity="info", code="name_variants", subject=code,
                                       message=f"{code} له أكثر من اسم عربي: {sorted(e['ar'])}"))
        credits = next(iter(e["credits"])) if len(e["credits"]) == 1 else None
        if len(e["credits"]) > 1:
            global_issues.append(Issue(severity="warning", code="credit_variants", subject=code,
                                       message=f"{code} بساعات مختلفة بين البرامج: {sorted(e['credits'])}"))
        courses[code] = Course(code=code, name_ar=sorted(e["ar"])[0], name_en=sorted(e["en"])[0],
                               credits=credits, seen_in=sorted(e["seen"]))

    return Catalog(
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        university=UQU, courses=courses, programs=programs, curricula=curricula, issues=global_issues,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="validate only; do not write catalog.json")
    args = ap.parse_args(argv)
    catalog = build_catalog()
    errors = [i for c in catalog.curricula.values() for i in c.issues if i.severity == "error"]
    for cur in catalog.curricula.values():
        print(f"{cur.id}: {len(cur.courses)} courses, {cur.listed_hours}/{cur.stated_total_hours} h, "
              f"status={cur.verification}, issues={len(cur.issues)}")
    for e in errors:
        print("ERROR:", e.message, file=sys.stderr)
    if not args.check:
        out = ROOT / "catalog.json"
        # Stable output: generated_at is the only volatile field.
        out.write_text(json.dumps(catalog.model_dump(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {out.relative_to(CATALOG_ROOT.parent.parent)}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
