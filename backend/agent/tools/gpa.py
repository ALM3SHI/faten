"""GPA: transcript analysis, GPA pathway prediction, GPA history and grade updates (UQU 4.00 scale)."""


from services.student import (
    academic_record_completed_courses,
    academic_record_current_courses,
    load_academic_record,
)

from common.grade_scale import GRADE_POINTS, POINTS_TO_GRADE
from agent.tools.context import ToolContext


async def _analyze_transcript(ctx: ToolContext, args: dict) -> dict:
    """5. Analyze Transcript"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    # v3 source first: users/{uid}/academic_record/main.completedCourses
    record = load_academic_record(user_ref)
    courses = academic_record_completed_courses(record)

    # Legacy fallback: transcripts subcollection
    if not courses:
        snaps = (user_ref.collection("transcripts")
                 .order_by("createdAt", direction="DESCENDING")
                 .limit(1).get())
        docs = list(snaps)
        if docs:
            courses = docs[0].to_dict().get("courses", [])

    if not courses:
        return {"success": False, "message": "لا يوجد سجل أكاديمي محفوظ بعد"}

    # Official UQU 4.00 grade-point scale (common/grade_scale.py).
    GP = GRADE_POINTS

    scored = []
    for c in courses:
        grade_str = c.get("grade", "")
        gp = GP.get(grade_str)
        if gp is None:
            # v3 enriched courses carry a numeric `gradePoints` too —
            # use it before falling back to numeric parse.
            gp_num = c.get("gradePoints")
            if gp_num is not None:
                try:
                    gp = float(gp_num)
                except (ValueError, TypeError):
                    gp = 0
            else:
                try:
                    gp = float(grade_str)
                except (ValueError, TypeError):
                    gp = 0
        # Normalize display name across schemas (flat vs enriched).
        display_name = c.get("name") or c.get("nameAr") or c.get("nameEn") or ""
        scored.append({**c, "name": display_name, "gp": gp})

    # Thresholds on the UQU 4.00 scale: < 2.00 (below C) = weakness;
    # ≥ 3.75 (A or A+) = strength.
    weaknesses = sorted([c for c in scored if c["gp"] < 2.0], key=lambda x: x["gp"])
    strengths = [c for c in scored if c["gp"] >= 3.75]

    if scored:
        total_weighted = sum(c["gp"] * (c.get("credit_hours") or c.get("creditHours") or 3) for c in scored)
        total_hours = sum((c.get("credit_hours") or c.get("creditHours") or 3) for c in scored)
        avg_gpa = round(total_weighted / total_hours, 2) if total_hours else 0
    else:
        avg_gpa = 0

    # Save analysis to Firestore
    user_ref.update({
        "analysis.weaknesses": [c.get("name", "") for c in weaknesses],
        "analysis.strengths":  [c.get("name", "") for c in strengths],
        "analysis.cgpa":       avg_gpa,
        "analysis.updatedAt":  now_iso,
    })

    return {
        "success": True,
        "focus": args.get("focus", "full"),
        "weaknesses":    [f"{c.get('name', '')} ({c.get('grade', '')})" for c in weaknesses[:5]],
        "strengths":     [f"{c.get('name', '')} ({c.get('grade', '')})" for c in strengths[:5]],
        "total_courses": len(courses),
        "average_gpa":   str(avg_gpa),
    }


async def _predict_gpa_pathway(ctx: ToolContext, args: dict) -> dict:
    """11. Predict GPA Pathway"""
    user_ref = ctx.user_ref
    # Read profile for goals
    snap = user_ref.get()
    user_data = snap.to_dict() if snap.exists else {}
    profile = user_data.get("profile", {})
    prefs = user_data.get("study_preferences", {})

    # v3 schema: transcript & current courses live at
    # users/{uid}/academic_record/main, written by the frontend's
    # syncTranscript(). Read it first; fall back to the legacy
    # transcripts subcollection for accounts that haven't migrated.
    record = load_academic_record(user_ref)

    # Read transcript for completed courses (legacy fallback)
    t_snaps = (user_ref.collection("transcripts")
               .order_by("createdAt", direction="DESCENDING")
               .limit(1).get())
    t_docs = list(t_snaps)

    # Official UQU 4.00 grade-point scale (common/grade_scale.py).
    GP = GRADE_POINTS
    # Inverse map on the UQU 4.00 scale.
    GRADE_LABELS = POINTS_TO_GRADE

    # Calculate current quality points. Prefer the v3 academic_record
    # completedCourses array; fall back to the legacy transcripts doc.
    completed_hours = 0
    total_quality_points = 0.0

    completed_courses_iter = (
        academic_record_completed_courses(record)
        or (t_docs[0].to_dict().get("courses", []) if t_docs else [])
    )
    for c in completed_courses_iter:
        grade_str = c.get("grade", "")
        gp = GP.get(grade_str)
        if gp is None:
            # transcript-parser emits a `gradePoints` numeric field too
            gp_num = c.get("gradePoints")
            if gp_num is None:
                try:
                    gp = float(grade_str)
                except (ValueError, TypeError):
                    continue
            else:
                gp = float(gp_num)
        hrs = c.get("credit_hours") or c.get("creditHours") or 3
        completed_hours += hrs
        total_quality_points += gp * hrs

    # Final fallbacks: top-level stats on the academic_record doc,
    # then legacy profile fields. Same dual-source logic the
    # frontend uses on the GPA page.
    if completed_hours == 0:
        completed_hours = (
            record.get("earnedHours")
            or profile.get("earnedHours")
            or 0
        )
        current_gpa_val = (
            record.get("gpa")
            or profile.get("currentGpa")
            or 0
        )
        total_quality_points = current_gpa_val * completed_hours

    current_gpa = round(total_quality_points / completed_hours, 2) if completed_hours > 0 else 0

    # Target GPA
    target = args.get("target_gpa") or profile.get("targetGpa") or 4.0
    target = float(target)

    # Current semester courses (what the student can still affect).
    # v3 location first, then the legacy profile.courses array.
    current_courses = (
        academic_record_current_courses(record)
        or profile.get("courses", [])
    )
    if not current_courses:
        return {
            "success": False,
            "message": "لا توجد مواد مسجلة في الفصل الحالي لحساب السيناريو"
        }

    current_semester_hours = sum(
        (c.get("credit_hours") or c.get("creditHours") or 3)
        for c in current_courses
    )
    total_planned_hours = completed_hours + current_semester_hours

    # Required total quality points to achieve target
    required_total_qp = target * total_planned_hours
    remaining_qp_needed = required_total_qp - total_quality_points

    if remaining_qp_needed <= 0:
        return {
            "success": True,
            "message": "🎉 أنت بالفعل تتجاوز المعدل المستهدف! استمر هكذا.",
            "current_gpa": str(current_gpa),
            "target_gpa": str(target),
            "status": "already_achieved",
        }

    # Required average GPA this semester
    required_semester_gpa = round(remaining_qp_needed / current_semester_hours, 2)

    if required_semester_gpa > 4.0:
        return {
            "success": True,
            "message": f"⚠️ للأسف، الوصول لمعدل {target} يتطلب معدل فصلي {required_semester_gpa} وهو مستحيل (أعلى من 4.00). جرب هدفاً أقل أو انتظر فصول إضافية.",
            "current_gpa": str(current_gpa),
            "target_gpa": str(target),
            "required_semester_gpa": str(required_semester_gpa),
            "status": "impossible",
        }

    # Generate per-course breakdown based on scenario
    scenario = args.get("scenario", "balanced")
    course_targets = []

    # Find closest grade label
    def closest_grade(gp_val):
        gp_val = max(0, min(4.0, gp_val))
        closest = min(GRADE_LABELS.keys(), key=lambda x: abs(x - gp_val))
        return GRADE_LABELS[closest], closest

    for c in current_courses:
        hrs = c.get("credit_hours") or c.get("creditHours") or 3
        # v3 enriched courses use `nameAr` / `nameEn` (no flat `name`);
        # accept any of the three.
        name = c.get("name") or c.get("nameAr") or c.get("nameEn") or "مادة"
        difficulty = c.get("difficulty", "medium")

        if scenario == "minimum":
            # Give harder courses lower targets, easier ones higher
            if difficulty == "hard":
                needed = min(required_semester_gpa - 0.5, 4.0)
            elif difficulty == "easy":
                needed = min(required_semester_gpa + 0.5, 4.0)
            else:
                needed = min(required_semester_gpa, 4.0)
        elif scenario == "ambitious":
            needed = min(required_semester_gpa + 0.5, 4.0)
        else:  # balanced
            needed = min(required_semester_gpa, 4.0)

        grade_label, grade_gp = closest_grade(needed)
        course_targets.append({
            "course": name,
            "credit_hours": hrs,
            "needed_grade": grade_label,
            "needed_gp": grade_gp,
            "difficulty": difficulty,
        })

    return {
        "success": True,
        "current_gpa": str(current_gpa),
        "target_gpa": str(target),
        "completed_hours": completed_hours,
        "current_semester_hours": current_semester_hours,
        "required_semester_gpa": str(required_semester_gpa),
        "scenario": scenario,
        "course_targets": course_targets,
        "status": "achievable",
        "message": f"📊 للوصول لمعدل {target}، تحتاج معدل فصلي {required_semester_gpa} هذا الفصل.",
    }


async def _get_gpa_history(ctx: ToolContext, args: dict) -> dict:
    """16. Get GPA History"""
    user_ref = ctx.user_ref
    limit = int(args.get("limit", 20))
    sem_snaps = (user_ref.collection("semesters")
                 .order_by("createdAt", direction="ASCENDING")
                 .limit(limit).get())
    semesters = [{"id": d.id, **d.to_dict()} for d in sem_snaps]
    return {"success": True, "semesters": semesters, "count": len(semesters)}


async def _add_semester_gpa(ctx: ToolContext, args: dict) -> dict:
    """17. Add Semester GPA"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    semester = {
        "name":      args["name"],
        "gpa":       float(args["gpa"]),
        "hours":     args.get("hours", 0),
        "createdAt": now_iso,
    }
    _, ref = user_ref.collection("semesters").add(semester)
    # Sync canonical goals.currentGpa (workspace / profile UI read path).
    snap = user_ref.get()
    user_data = snap.to_dict() if snap.exists else {}
    goals = dict(user_data.get("goals") or {})
    goals["currentGpa"] = float(args["gpa"])
    user_ref.set(
        {
            "goals": goals,
            "lastUpdated": now_iso,
            "updatedAt": now_iso,
        },
        merge=True,
    )
    return {
        "success": True,
        "id": ref.id,
        "message": f"تم تسجيل {args['name']} بمعدل {args['gpa']} / 4.00",
    }


async def _update_course_grade(ctx: ToolContext, args: dict) -> dict:
    """18. Update Course Grade"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    import re as _re

    def _norm(s: str) -> str:
        if not s:
            return ""
        s = _re.sub(r"[أإآ]", "ا", s)
        s = _re.sub(r"ة", "ه", s)
        return s.lower().strip()

    def _course_display_name(c: dict) -> str:
        return (
            c.get("name")
            or c.get("nameAr")
            or c.get("nameEn")
            or c.get("code")
            or ""
        )

    record = load_academic_record(user_ref)
    course_name = args["course_name"]
    grade = float(args["grade"])

    completed = list(academic_record_completed_courses(record))
    current = list(academic_record_current_courses(record))
    found = False
    updated_in_completed = False

    for c in completed:
        display = _course_display_name(c)
        if _norm(course_name) in _norm(display) or _norm(display) in _norm(course_name):
            c["grade"] = grade
            c["updatedAt"] = now_iso
            found = True
            updated_in_completed = True
            break

    if not found:
        for c in current:
            display = _course_display_name(c)
            if _norm(course_name) in _norm(display) or _norm(display) in _norm(course_name):
                c["grade"] = grade
                c["updatedAt"] = now_iso
                found = True
                break

    if not found:
        return {"success": False, "message": f"لم أجد مادة باسم: {course_name}"}

    record_ref = user_ref.collection("academic_record").document("main")
    payload = {"lastUpdated": now_iso}
    if updated_in_completed:
        payload["completedCourses"] = completed
    else:
        payload["currentCourses"] = current

    record_ref.set(payload, merge=True)
    return {
        "success": True,
        "message": f"تم تحديث درجة {course_name} إلى {grade} / 4.00",
    }


HANDLERS = {
    "analyze_transcript": _analyze_transcript,
    "predict_gpa_pathway": _predict_gpa_pathway,
    "get_gpa_history": _get_gpa_history,
    "add_semester_gpa": _add_semester_gpa,
    "update_course_grade": _update_course_grade,
}
