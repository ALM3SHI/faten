"""What kind of record is this: enrolled, between terms, or a graduate?

Every record is accepted; this only decides what the advisor says.

  enrolled          courses in progress / registered
  between_terms     everything graded, nothing registered (uploaded after
                    grades came out, before the next term)
  graduated         the current plan is fully covered, or the final
                    graduation-project part is passed AND earned hours reach
                    the plan total printed on the record
  likely_graduated  no plan total on the record, but final project and
                    training are passed at bachelor-level hours

The number of terms/levels is deliberately not used: a student who changed
majors can have many terms and still be far from graduating. Mirrors
frontend/src/lib/record-status.ts.
"""

from __future__ import annotations

import re

from services.advisor.audit import DegreeAudit
from services.advisor.catalog import Catalog, Curriculum
from services.advisor.profile import StudentProfile

MIN_BACHELOR_HOURS = 118

_PROJECT = re.compile(r"مشروع\s*(ال)?تخرج|graduation\s*project|senior\s*project|capstone", re.I)
_TRAINING = re.compile(r"تدريب\s*(ال)?(تعاوني|ميداني|صيفي)|co-?op\b|cooperative|cooprative|internship|field\s*training|summer\s*training", re.I)
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_PART = re.compile(r"(?:مشروع\s*(?:ال)?تخرج|project)\s*[-(]?\s*(1|2|i{1,2})\b\)?", re.I)


def project_part(label: str) -> int | None:
    m = _PART.search(re.sub(r"\s+", " ", label.translate(_DIGITS)))
    if not m:
        return None
    return 2 if m.group(1).lower() in ("2", "ii") else 1


def assess(profile: StudentProfile, catalog: Catalog, cur: Curriculum, aud: DegreeAudit,
           record_plan_hours: int | None) -> dict:
    labels = {a.code: f"{a.name} {catalog.course_name(a.code)}" for a in profile.attempts}
    projects = {c for c, lab in labels.items() if _PROJECT.search(lab)}
    passed_projects = projects & set(profile.passed)
    parts = {project_part(labels[c]) for c in passed_projects}
    numbered = any(project_part(labels[c]) is not None for c in projects)
    if 2 in parts or (not numbered and passed_projects):
        final_project = "passed"
    elif 1 in parts:
        final_project = "part1_only"
    else:
        final_project = "missing"
    coop_codes = {pc.code for pc in cur.courses if pc.kind == "coop"}
    training = "passed" if any(c in profile.passed and (c in coop_codes or _TRAINING.search(labels[c])) for c in labels) else "missing"

    earned = profile.stated_earned_hours if profile.stated_earned_hours is not None else profile.earned_hours
    plan = record_plan_hours if record_plan_hours and record_plan_hours >= MIN_BACHELOR_HOURS else None
    plan_covered = (aud.remaining_required_hours == 0 and aud.in_progress_hours == 0
                    and cur.stated_total_hours is not None and earned >= cur.stated_total_hours)
    reasons: list[str] = []

    if profile.in_progress:
        status = "enrolled"
    elif plan_covered:
        status = "graduated"
        reasons.append(f"كل مقررات خطة {catalog.programs[cur.program_id].name_ar} الإجبارية مجتازة، "
                       f"وساعاتك {earned} من {cur.stated_total_hours}.")
    elif final_project == "passed" and plan is not None and earned >= plan:
        status = "graduated"
        reasons.append(f"اجتزت مشروع التخرج، وساعاتك المكتسبة {earned} من {plan} ساعة في خطتك حسب السجل.")
    elif final_project == "passed" and training == "passed" and plan is None and earned >= MIN_BACHELOR_HOURS:
        status = "likely_graduated"
        reasons.append(f"اجتزت مشروع التخرج والتدريب وساعاتك {earned}، لكن السجل لا يذكر إجمالي ساعات خطتك للتأكد.")
    else:
        status = "between_terms"
        if final_project == "part1_only":
            reasons.append("اجتزت مشروع التخرج 1 ولم يظهر مشروع التخرج 2 بعد.")
        total = plan or cur.stated_total_hours
        if total and earned < total:
            reasons.append(f"ساعاتك المكتسبة {earned} من {total}؛ باقي {total - earned} ساعة.")
    return {"status": status, "final_project": final_project, "training": training,
            "earned_hours": earned, "plan_hours": plan, "reasons": reasons}


GRADUATE_MESSAGE = ("يبدو أنك أكملت متطلبات التخرج — مبروك 🎓. لذلك لا يقترح المرشد مقررات ولا مسار تخرج. "
                    "إن لم تكن تخرجت فعلاً (مثلاً باقٍ مقرر أو تحويل لم يُحتسب) راجع القسم أو نظام التسجيل.")
