"""Student academic profile: the transcript turned into exact facts.

Input is what Faten already stores at users/{uid}/academic_record/main
(parsed client-side from the official transcript PDF) plus optional
student-entered corrections, which are kept apart and labelled so they
can never be mistaken for the official record.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Literal

from pydantic import BaseModel, Field

from common.grade_scale import GRADE_POINTS
from services.advisor.catalog import normalize_code

PASS_GRADES = frozenset({"A+", "A", "B+", "B", "C+", "C", "D+", "D"})
FAIL_GRADES = frozenset({"F", "DN", "NF"})  # count as attempts; F and DN carry 0 points in the GPA
NOT_IN_GPA = frozenset({"W", "IP", "NP", "IC", "NF"})

AttemptStatus = Literal["passed", "failed", "withdrawn", "incomplete", "in_progress", "unknown"]

_AR_TERM = {"الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3, "الصيفي": 3, "صيفي": 3}
_EN_TERM = {"first": 1, "second": 2, "third": 3, "summer": 3}


class Attempt(BaseModel):
    code: str
    name: str = ""
    credits: int
    grade: str | None
    status: AttemptStatus
    points: float | None  # grade points on the 4.00 scale; None when the grade does not count
    counts_in_gpa: bool
    term_key: tuple[int, int] | None  # (start year, 1|2|3); None when unknown
    term_label: str = ""
    source: Literal["transcript", "student"] = "transcript"


class DataGap(BaseModel):
    field: str
    message: str
    impact: str


class StudentProfile(BaseModel):
    attempts: list[Attempt]
    passed: dict[str, Attempt]  # best passing attempt per course
    failed_unresolved: dict[str, list[Attempt]]  # failed and never passed since
    in_progress: dict[str, Attempt]
    incomplete: dict[str, Attempt]
    withdrawn: dict[str, list[Attempt]]
    repeated: dict[str, int]  # code → number of graded attempts (>1 only)
    computed_gpa: float | None
    gpa_hours: int
    gpa_points: float
    earned_hours: int
    stated_gpa: float | None
    stated_earned_hours: int | None
    gpa_discrepancy: float | None
    term_gpas: list[dict]  # [{term, label, gpa, hours}] chronological
    category_performance: dict[str, dict]  # prefix → {avg_points, hours, courses}
    major_from_record: str | None
    data_gaps: list[DataGap] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    student_entered: int = 0


def parse_term(label: str | None) -> tuple[int, int] | None:
    """'الفصل الأول 1445/1446' / 'First Semester 2023/2024' → (1445, 1)."""
    text = (label or "").strip()
    if not text:
        return None
    years = [int(y) for y in re.findall(r"\d{4}", text)]
    if not years:
        return None
    idx = None
    for word, n in _AR_TERM.items():
        if word in text:
            idx = n
            break
    if idx is None:
        low = text.lower()
        for word, n in _EN_TERM.items():
            if word in low:
                idx = n
                break
    return (min(years), idx or 0)


def _status(grade: str | None, semester_status: str | None) -> AttemptStatus:
    g = (grade or "").strip().upper()
    if (semester_status or "").lower() in {"current", "registered"} and not g:
        return "in_progress"
    if g in PASS_GRADES or g == "NP":
        return "passed"
    if g in FAIL_GRADES:
        return "failed"
    if g == "W":
        return "withdrawn"
    if g == "IC":
        return "incomplete"
    if g == "IP":
        return "in_progress"
    return "unknown"


def _attempt(raw: dict, source: str, default_status: str | None = None) -> Attempt | None:
    code = normalize_code(raw.get("code"))
    if not code:
        return None
    grade = (raw.get("grade") or "").strip().upper() or None
    try:
        credits = int(raw.get("creditHours") if raw.get("creditHours") is not None else raw.get("credits") or 0)
    except (TypeError, ValueError):
        credits = 0
    status = _status(grade, raw.get("semesterStatus") or default_status)
    points = GRADE_POINTS.get(grade) if grade else None
    if grade == "DN":
        points = 0.0  # محروم counts as a fail with zero points
    counts = bool(grade) and grade not in NOT_IN_GPA and points is not None and credits > 0
    label = raw.get("semester") or raw.get("semesterEn") or raw.get("term") or ""
    return Attempt(
        code=code, name=raw.get("nameAr") or raw.get("name") or raw.get("nameEn") or "",
        credits=credits, grade=grade, status=status, points=points if counts else None,
        counts_in_gpa=counts, term_key=parse_term(label), term_label=str(label), source=source,  # type: ignore[arg-type]
    )


def _round2(x: float) -> float:
    return float(f"{x + 1e-9:.2f}")


def build_profile(record: dict | None, corrections: dict | None = None) -> StudentProfile:
    record = record or {}
    corrections = corrections or {}
    attempts: list[Attempt] = []
    notes: list[str] = []
    gaps: list[DataGap] = []
    seen: set[tuple] = set()

    excluded = {(normalize_code(e.get("code")), str(e.get("term") or "")) for e in corrections.get("exclude") or []}

    def add(a: Attempt | None) -> None:
        if a is None:
            return
        if (a.code, a.term_label) in excluded or (a.code, "") in excluded:
            notes.append(f"استُبعد {a.code} ({a.term_label or 'بدون فصل'}) بطلبك.")
            return
        key = (a.code, a.term_key or a.term_label, a.grade)
        if key in seen:
            notes.append(f"تكرر {a.code} في نفس الفصل بنفس التقدير؛ حُسب مرة واحدة.")
            return
        seen.add(key)
        attempts.append(a)

    for raw in record.get("completedCourses") or []:
        if isinstance(raw, dict):
            add(_attempt(raw, "transcript"))
    current = record.get("currentCourses") or record.get("registeredCourses") or []
    for raw in current:
        if isinstance(raw, dict):
            add(_attempt(raw, "transcript", default_status="current"))
    student_rows = 0
    for raw in corrections.get("courses") or []:
        if isinstance(raw, dict):
            a = _attempt(raw, "student", default_status=raw.get("semesterStatus"))
            if a:
                student_rows += 1
            add(a)
    if student_rows:
        notes.append(f"{student_rows} مقرر أُدخل يدوياً منك وغير موثق من السجل الرسمي.")

    attempts.sort(key=lambda a: (a.term_key or (9999, 9), a.code))

    by_code: dict[str, list[Attempt]] = defaultdict(list)
    for a in attempts:
        by_code[a.code].append(a)

    passed, failed_unresolved, in_progress, incomplete, withdrawn, repeated = {}, {}, {}, {}, {}, {}
    for code, lst in by_code.items():
        graded = [a for a in lst if a.status in ("passed", "failed")]
        if len(graded) > 1:
            repeated[code] = len(graded)
        passes = [a for a in lst if a.status == "passed"]
        if passes:
            passed[code] = max(passes, key=lambda a: (a.points or 0, a.term_key or (0, 0)))
        fails = [a for a in lst if a.status == "failed"]
        if fails and not passes:
            failed_unresolved[code] = fails
        prog = [a for a in lst if a.status == "in_progress"]
        if prog and not passes:
            in_progress[code] = prog[-1]
        ic = [a for a in lst if a.status == "incomplete"]
        if ic and not passes:
            incomplete[code] = ic[-1]
        w = [a for a in lst if a.status == "withdrawn"]
        if w:
            withdrawn[code] = w
        unknown = [a for a in lst if a.status == "unknown"]
        if unknown and not passes and not prog:
            gaps.append(DataGap(field=f"grade:{code}", message=f"تقدير {code} غير مقروء ({unknown[-1].grade or 'فارغ'}).",
                                impact="لا نعرف إن كان المقرر مجتازاً؛ لن نعتبره كذلك حتى تؤكده."))

    gpa_rows = [a for a in attempts if a.counts_in_gpa]
    gpa_hours = sum(a.credits for a in gpa_rows)
    gpa_points = sum(a.credits * (a.points or 0) for a in gpa_rows)
    computed = _round2(gpa_points / gpa_hours) if gpa_hours else None
    earned = sum(a.credits for a in passed.values())

    stated_gpa = _as_float(record.get("gpa"))
    stated_hours = _as_int(record.get("earnedHours"))
    disc = None
    if computed is not None and stated_gpa is not None:
        disc = _round2(abs(computed - stated_gpa))
        if disc > 0.02:
            notes.append(
                f"المعدل المحسوب من المقررات ({computed:.2f}) يختلف عن المعدل المذكور في السجل ({stated_gpa:.2f}). "
                "نعتمد معدل السجل الرسمي في التقييم ونعرض الفرق للمراجعة (قد يكون مقرر لم يُقرأ من الملف)."
            )

    # Per-term GPA (from attempts), with the transcript's own SGPA when present.
    terms: dict[tuple, dict] = {}
    for a in gpa_rows:
        if not a.term_key:
            continue
        t = terms.setdefault(a.term_key, {"term": list(a.term_key), "label": a.term_label, "hours": 0, "points": 0.0})
        t["hours"] += a.credits
        t["points"] += a.credits * (a.points or 0)
    term_gpas = []
    for key in sorted(terms):
        t = terms[key]
        term_gpas.append({"term": t["term"], "label": t["label"], "hours": t["hours"],
                          "gpa": _round2(t["points"] / t["hours"]) if t["hours"] else None})

    cats: dict[str, dict] = {}
    for a in gpa_rows:
        prefix = re.match(r"[A-Z]+", a.code).group(0)  # type: ignore[union-attr]
        c = cats.setdefault(prefix, {"hours": 0, "points": 0.0, "courses": 0})
        c["hours"] += a.credits
        c["points"] += a.credits * (a.points or 0)
        c["courses"] += 1
    category_performance = {
        k: {"avg_points": _round2(v["points"] / v["hours"]), "hours": v["hours"], "courses": v["courses"]}
        for k, v in sorted(cats.items()) if v["hours"]
    }

    if not attempts:
        gaps.append(DataGap(field="transcript", message="لا يوجد سجل أكاديمي محفوظ.",
                            impact="لا يمكن معرفة المقررات المجتازة؛ ارفع السجل من صفحة «السجل» أو أدخل المقررات يدوياً."))
    if attempts and not any(a.term_key for a in attempts):
        gaps.append(DataGap(field="terms", message="فصول المقررات غير معروفة.",
                            impact="لا يمكن قياس اتجاه الأداء عبر الفصول."))
    if stated_gpa is None and computed is None and attempts:
        gaps.append(DataGap(field="gpa", message="المعدل التراكمي غير متوفر.", impact="تقييم المخاطر الأكاديمية سيكون محدوداً."))
    if not current and attempts:
        gaps.append(DataGap(field="current_courses", message="لا توجد مقررات مسجلة للفصل الحالي في السجل.",
                            impact="سنفترض أنك لا تدرس شيئاً الآن؛ إن كنت مسجلاً أضف مقرراتك الحالية حتى لا نقترحها مجدداً."))

    return StudentProfile(
        attempts=attempts, passed=passed, failed_unresolved=failed_unresolved, in_progress=in_progress,
        incomplete=incomplete, withdrawn=withdrawn, repeated=repeated,
        computed_gpa=computed, gpa_hours=gpa_hours, gpa_points=_round2(gpa_points), earned_hours=earned,
        stated_gpa=stated_gpa, stated_earned_hours=stated_hours, gpa_discrepancy=disc,
        term_gpas=term_gpas, category_performance=category_performance,
        major_from_record=record.get("major") or record.get("majorEn"),
        data_gaps=gaps, notes=notes, student_entered=student_rows,
    )


def effective_gpa(p: StudentProfile) -> float | None:
    """The official figure wins; our computation is the fallback."""
    return p.stated_gpa if p.stated_gpa is not None else p.computed_gpa


def _as_float(v) -> float | None:
    try:
        f = float(v)
        return f if 0 <= f <= 4 else None
    except (TypeError, ValueError):
        return None


def _as_int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
