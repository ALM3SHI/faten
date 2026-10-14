"""Degree audit: which requirements of one curriculum are met, pending or blocked."""

from __future__ import annotations

from pydantic import BaseModel

from services.advisor.catalog import Catalog, Curriculum
from services.advisor.profile import StudentProfile


class AuditCourse(BaseModel):
    code: str
    name: str
    level: int
    credits: int
    state: str  # done | in_progress | remaining | failed | incomplete
    prerequisites: list[str]
    missing_prerequisites: list[str]  # not passed and not in progress
    eligible_next_term: bool
    blocked_by_incomplete: list[str]
    verification: str


class DegreeAudit(BaseModel):
    curriculum_id: str
    program_name: str
    stated_total_hours: int | None
    required_hours: int
    done_hours: int
    in_progress_hours: int
    remaining_required_hours: int
    unlisted_hours: int  # electives whose list is not published
    outside_plan_passed: list[dict]  # passed courses not in this plan (possible elective credit — unconfirmed)
    outside_plan_hours: int
    remaining_hours_estimate: dict  # {min, max}: electives may or may not be covered by outside-plan courses
    percent_required_done: float
    courses: list[AuditCourse]
    assumptions: list[str]


def audit(profile: StudentProfile, catalog: Catalog, cur: Curriculum) -> DegreeAudit:
    done = set(profile.passed)
    progress = set(profile.in_progress)
    rows: list[AuditCourse] = []
    for pc in sorted(cur.courses, key=lambda c: (c.level, c.code)):
        if pc.code in done:
            state = "done"
        elif pc.code in progress:
            state = "in_progress"
        elif pc.code in profile.incomplete:
            state = "incomplete"
        elif pc.code in profile.failed_unresolved:
            state = "failed"
        else:
            state = "remaining"
        missing = [p for p in pc.prerequisites if p not in done and p not in progress]
        ic_block = [p for p in pc.prerequisites if p in profile.incomplete]
        eligible = state in ("remaining", "failed") and not missing and not ic_block
        rows.append(AuditCourse(
            code=pc.code, name=catalog.course_name(pc.code), level=pc.level, credits=pc.credits, state=state,
            prerequisites=pc.prerequisites, missing_prerequisites=missing, eligible_next_term=eligible,
            blocked_by_incomplete=ic_block, verification=pc.verification,
        ))

    plan_codes = {c.code for c in cur.courses}
    outside = [
        {"code": a.code, "name": a.name or catalog.course_name(a.code), "credits": a.credits, "grade": a.grade}
        for code, a in sorted(profile.passed.items()) if code not in plan_codes
    ]
    outside_hours = sum(o["credits"] for o in outside)
    required = sum(c.credits for c in cur.courses)
    done_h = sum(r.credits for r in rows if r.state == "done")
    prog_h = sum(r.credits for r in rows if r.state == "in_progress")
    remaining_required = required - done_h
    unlisted = cur.unlisted_hours
    est_min = remaining_required + max(0, unlisted - outside_hours)
    est_max = remaining_required + unlisted
    assumptions = [
        "المقررات المسجلة حالياً تُعامل كأنها ستُجتاز عند حساب الأهلية للفصل القادم.",
    ]
    if unlisted:
        assumptions.append(
            f"الخطة المنشورة لا تذكر {unlisted} ساعة اختيارية؛ "
            + (f"لديك {outside_hours} ساعة مجتازة خارج قائمة الخطة قد تُحتسب منها — يؤكد ذلك قسمك."
               if outside_hours else "لم نجد في سجلك مقررات خارج الخطة قد تغطيها.")
        )
    return DegreeAudit(
        curriculum_id=cur.id, program_name=catalog.programs[cur.program_id].name_ar,
        stated_total_hours=cur.stated_total_hours, required_hours=required, done_hours=done_h,
        in_progress_hours=prog_h, remaining_required_hours=remaining_required, unlisted_hours=unlisted,
        outside_plan_passed=outside, outside_plan_hours=outside_hours,
        remaining_hours_estimate={"min": est_min, "max": est_max},
        percent_required_done=round(100 * done_h / required, 1) if required else 0.0,
        courses=rows, assumptions=assumptions,
    )
