"""Schedule & study plan: exams, study plans/tasks, client actions, attendance and the day timetable."""

import json
import logging
from datetime import datetime, timedelta
from google.cloud.firestore_v1.base_query import FieldFilter

from services.student import (
    academic_record_completed_courses,
    academic_record_current_courses,
    load_academic_record,
)
from services.workspace import (
    agent_legacy_plan_to_canonical,
    apply_complete_task,
    apply_modify_study_session,
    load_plan_for_tool_mutation_sync,
    load_workspace_sync,
    upsert_plan_current_sync,
)

from common.grade_scale import GRADE_POINTS
from agent.tools.context import ToolContext
from agent.tools._common import (
    ALLOWED_CLIENT_ACTION_TYPES,
    check_time_conflict,
    coerce_task_dict,
    to_int,
)

logger = logging.getLogger(__name__)


async def _emit_client_action(ctx: ToolContext, args: dict) -> dict:
    """0. Emit Client Action (no Firestore write — the frontend dispatcher picks this up from actions_log and mutates a Zustand store)"""
    user_id = ctx.user_id
    db = ctx.db
    action_type = str(args.get("type", "")).strip().upper()
    payload = args.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    if action_type not in ALLOWED_CLIENT_ACTION_TYPES:
        return {
            "success": False,
            "client_only": True,
            "message": f"نوع إجراء غير معروف: {action_type}. الأنواع المسموح بها: {sorted(ALLOWED_CLIENT_ACTION_TYPES)}",
        }
    if action_type == "ADD_TASK":
        target_date = payload.get("targetDate")
        suggested_time = payload.get("suggestedTime")
        suggested_day = payload.get("suggestedDay")
        duration = to_int(payload.get("durationMinutes"), 25)
        course_code = str(payload.get("courseCode") or "").strip()

        loop = __import__('asyncio').get_running_loop()
        ws = await loop.run_in_executor(None, load_workspace_sync, user_id, db)

        # Course Validation
        if course_code and course_code != "OTHER":
            transcript = ws.get("transcript", {})
            current_courses = transcript.get("currentCourses", [])
            valid_codes = set()
            for c in current_courses:
                if isinstance(c, dict):
                    code = c.get("code") or c.get("course_code") or c.get("courseCode")
                    if code:
                        valid_codes.add(str(code).upper())
                elif isinstance(c, str):
                    valid_codes.add(c.upper())

            if course_code.upper() not in valid_codes:
                payload["courseCode"] = "OTHER"
                payload["courseName"] = "أخرى"
        elif not course_code:
            payload["courseCode"] = "OTHER"
            payload["courseName"] = "أخرى"

        # Time Conflict Validation
        if suggested_time and (target_date or suggested_day):
            schedule_data = ws.get("schedule", {}).get("schedule", []) if isinstance(ws.get("schedule"), dict) else ws.get("schedule", [])

            plan_section = ws.get("plan", {})
            active_plan_tasks = []
            if isinstance(plan_section, dict) and isinstance(plan_section.get("plan"), dict):
                active_plan_tasks = plan_section["plan"].get("tasks", [])

            conflict = check_time_conflict(target_date, suggested_time, duration, schedule_data, active_plan_tasks, suggested_day)
            if conflict:
                return {
                    "success": False,
                    "client_only": True,
                    "message": f"عذراً، {conflict} يرجى اقتراح وقت آخر.",
                }

    return {
        "success": True,
        "client_only": True,
        "client_action": {"type": action_type, "payload": payload},
        "message": f"تم تجهيز إجراء {action_type} لتنفيذه على واجهة الطالب.",
    }


async def _add_upcoming_exam(ctx: ToolContext, args: dict) -> dict:
    """1. Add Exam"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    exam = {
        "subject":     args["subject"],
        "date":        args["date"],
        "time":        args.get("time"),
        "course_code": args.get("course_code"),
        "exam_type":   args.get("exam_type", "exam"),
        "notes":       args.get("notes", ""),
        "createdAt":   now_iso,
        "done":        False,
    }
    _, ref = user_ref.collection("exams").add(exam)
    return {
        "success": True,
        "id": ref.id,
        "message": f"تم تسجيل اختبار \"{args['subject']}\" بتاريخ {args['date']}"
    }


async def _get_upcoming_exams(ctx: ToolContext, args: dict) -> dict:
    """7. Get Upcoming Exams"""
    user_ref = ctx.user_ref
    today = datetime.now().strftime("%Y-%m-%d")
    limit = args.get("limit", 10)
    snaps = (user_ref.collection("exams")
             .where(filter=FieldFilter("date", ">=", today))
             .where(filter=FieldFilter("done", "==", False))
             .order_by("date")
             .limit(limit)
             .get())
    exams = [{"id": d.id, **d.to_dict()} for d in snaps]
    return {"success": True, "exams": exams, "count": len(exams)}


async def _create_study_plan(ctx: ToolContext, args: dict) -> dict:
    """2. Create Study Plan"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    timestamp = int(datetime.now().timestamp() * 1000)
    tasks: list[dict] = []
    raw_tasks = args.get("tasks") or []
    # Some NIM / Llama runs serialize the whole `tasks` array as a
    # JSON string at the top level — handle that too.
    if isinstance(raw_tasks, str):
        try:
            parsed = json.loads(raw_tasks)
            if isinstance(parsed, list):
                raw_tasks = parsed
            else:
                logger.warning(
                    "[tools] create_study_plan: tasks parsed to non-list (%s)",
                    type(parsed).__name__,
                )
                raw_tasks = []
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            logger.warning(
                "[tools] create_study_plan: top-level tasks string un-parseable: %s",
                exc,
            )
            raw_tasks = []

    for i, raw_t in enumerate(raw_tasks):
        t = coerce_task_dict(raw_t, i)
        if t is None:
            continue
        # Use .get() for *every* field so a missing key never throws —
        # title/subject default to placeholders rather than KeyError.
        tasks.append({
            "id":       f"task_{timestamp}_{i}",
            "title":    t.get("title") or f"مهمة {i + 1}",
            "subject":  t.get("subject") or "عام",
            "duration": t.get("duration", 60),
            "date":     t.get("date", datetime.now().strftime("%Y-%m-%d")),
            "priority": t.get("priority", "medium"),
            "notes":    t.get("notes", ""),
            "done":     False,
        })

    if not tasks:
        return {
            "success": False,
            "message": (
                "لم أتمكن من قراءة قائمة المهام المرسلة. أرسل tasks كمصفوفة "
                "JSON من كائنات (objects) تحوي على الأقل: title, subject, "
                "duration, date."
            ),
        }

    plan = {
        "title":     args.get("title") or "خطة دراسية",
        "deadline":  args.get("deadline"),
        "tasks":     tasks,
        "createdAt": now_iso,
        "active":    True,
    }
    payload = agent_legacy_plan_to_canonical(plan, model="agent")
    upsert_plan_current_sync(user_ref, payload)
    return {
        "success": True,
        "id": "current",
        "tasks_count": len(tasks),
        "message": f"تم إنشاء الخطة \"{plan['title']}\" بـ {len(tasks)} مهام"
    }


async def _complete_task(ctx: ToolContext, args: dict) -> dict:
    """9. Complete Task"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    _, section = load_plan_for_tool_mutation_sync(user_ref)
    if not section:
        return {"success": False, "message": "لا توجد خطة نشطة"}

    search_name = args.get("task_name") or args.get("task_title", "")
    updated = apply_complete_task(
        section,
        args.get("task_id"),
        search_name,
        done_at=now_iso,
    )
    if not updated:
        return {"success": False, "message": "لم يتم العثور على المهمة"}

    upsert_plan_current_sync(user_ref, updated)
    return {"success": True, "message": "تم تحديد المهمة كمنجزة ✅"}


async def _modify_study_session(ctx: ToolContext, args: dict) -> dict:
    """═══════════════════════════════════════════════════════════════ SUPER-AGENT TOOLS (v2.0) ═══════════════════════════════════════════════════════════════ 10. Modify Study Session"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    _, section = load_plan_for_tool_mutation_sync(user_ref)
    if not section:
        return {"success": False, "message": "لا توجد خطة دراسية نشطة لتعديلها"}

    search_name = args.get("task_name") or args.get("task_id", "")
    changes = []

    if args.get("new_date"):
        changes.append(f"التاريخ → {args['new_date']}")
    if args.get("new_time"):
        changes.append(f"الوقت → {args['new_time']}")
    if args.get("new_duration"):
        changes.append(f"المدة → {args['new_duration']} دقيقة")
    if args.get("new_subject"):
        changes.append(f"المادة → {args['new_subject']}")
    if args.get("new_priority"):
        changes.append(f"الأولوية → {args['new_priority']}")

    if not changes:
        return {"success": False, "message": "لم يتم تحديد أي تغييرات"}

    updated = apply_modify_study_session(section, args, now_iso=now_iso)
    if not updated:
        return {
            "success": False,
            "message": f"لم أجد مهمة باسم '{search_name}' في الخطة الحالية",
        }

    upsert_plan_current_sync(user_ref, updated)

    modified_task = None
    for t in updated.get("plan", {}).get("tasks") or []:
        if isinstance(t, dict) and (
            t.get("id") == args.get("task_id")
            or (search_name and search_name in (t.get("title") or ""))
        ):
            modified_task = t
            break

    changes_str = "، ".join(changes)
    title = (modified_task or {}).get("title", "")
    return {
        "success": True,
        "message": f"✏️ تم تعديل \"{title}\": {changes_str}",
        "modified_task": modified_task,
    }


async def _generate_semester_master_plan(ctx: ToolContext, args: dict) -> dict:
    """═══════════════════════════════════════════════════════════════ 13. GENERATE SEMESTER MASTER PLAN (Personalized Planner) ═══════════════════════════════════════════════════════════════"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    # ── 1. Read student profile & preferences ──
    snap = user_ref.get()
    user_data = snap.to_dict() if snap.exists else {}
    profile = user_data.get("profile", {})
    prefs = user_data.get("study_preferences", {})
    analysis_data = user_data.get("analysis", {})

    # v3: current courses live in users/{uid}/academic_record/main.
    # Fall back to the legacy profile.courses array for unmigrated
    # accounts so this tool keeps working in both schemas.
    record = load_academic_record(user_ref)
    courses = (
        academic_record_current_courses(record)
        or profile.get("courses", [])
    )
    if not courses:
        return {
            "success": False,
            "message": "لا توجد مواد مسجلة في الفصل الحالي. أضف موادك أولاً من صفحة البروفايل."
        }

    # ── 2. Extract learning DNA ──
    # Coerce every numeric field defensively — the LLM may pass them
    # as JSON strings, and Firestore returns whatever shape the writer
    # used. Without this, the `daily_mins <= 0` guard below crashes
    # with: '<=' not supported between instances of 'str' and 'int'.
    peak_time = prefs.get("best_time", "evening")        # morning/evening/night
    speed = prefs.get("study_speed", "normal")           # slow/normal/fast
    stress = prefs.get("stress_level", "normal")         # low/normal/high/critical
    focus_mins = to_int(prefs.get("focus_length"), 25)  # pomodoro length, minutes
    daily_study_hours = to_int(
        args.get("daily_hours") or prefs.get("study_hours"),
        4,
    )
    study_method = prefs.get("method", "")
    total_weeks = to_int(args.get("weeks"), 16)
    include_weekends = bool(args.get("include_weekends", False))
    focus_mode = args.get("focus_mode", "balanced")

    # Speed adjustments
    speed_multiplier = {"slow": 1.4, "normal": 1.0, "fast": 0.8}.get(speed, 1.0)
    break_minutes = {"slow": 15, "normal": 10, "fast": 5}.get(speed, 10)

    # Peak time → preferred slot mapping
    time_slots = {
        "morning": {"hard": "08:00", "medium": "10:00", "easy": "12:00"},
        "evening": {"hard": "16:00", "medium": "18:00", "easy": "20:00"},
        "night":   {"hard": "20:00", "medium": "22:00", "easy": "14:00"},
    }
    slots = time_slots.get(peak_time, time_slots["evening"])

    # ── 3. Read transcript for weakness weighting ──
    # Official UQU 4.00 grade-point scale (common/grade_scale.py).
    GP = GRADE_POINTS

    weak_subjects = set(analysis_data.get("weaknesses", []))

    # Subject performance — prefer v3 academic_record.completedCourses,
    # fall back to the legacy transcripts subcollection.
    completed_history = academic_record_completed_courses(record)
    if not completed_history:
        t_snaps = (user_ref.collection("transcripts")
                   .order_by("createdAt", direction="DESCENDING")
                   .limit(1).get())
        t_docs = list(t_snaps)
        if t_docs:
            completed_history = t_docs[0].to_dict().get("courses", [])

    subject_history = {}  # name -> last grade GP
    for c in completed_history:
        name = c.get("name") or c.get("nameAr") or c.get("nameEn") or ""
        grade = c.get("grade", "")
        gp = GP.get(grade)
        if gp is None and c.get("gradePoints") is not None:
            try:
                gp = float(c.get("gradePoints"))
            except (ValueError, TypeError):
                gp = None
        if gp is not None and name:
            subject_history[name] = gp

    # ── 4. Compute per-course weight (intelligent allocation) ──
    course_weights = []
    total_weight = 0

    for c in courses:
        # v3 enriched courses use nameAr/nameEn; accept all three forms.
        name = c.get("name") or c.get("nameAr") or c.get("nameEn") or ""
        difficulty = c.get("difficulty", "medium")
        # Firestore may have stored credit hours as a string — coerce.
        hrs = to_int(c.get("credit_hours") or c.get("creditHours"), 3)

        # Base weight from credit hours
        weight = float(hrs)

        # Difficulty multiplier
        diff_mult = {"hard": 1.8, "medium": 1.0, "easy": 0.6}.get(difficulty, 1.0)
        weight *= diff_mult

        # Weakness multiplier: if student historically weak → 2x
        historical_gp = subject_history.get(name)
        is_weak = name in weak_subjects or (historical_gp is not None and historical_gp < 3.0)
        if is_weak:
            weight *= 2.0

        # Focus mode adjustments
        if focus_mode == "weakness_recovery" and is_weak:
            weight *= 1.5
        elif focus_mode == "gpa_boost" and difficulty == "easy":
            weight *= 1.3  # easy wins boost GPA fast

        course_weights.append({
            "course": c,
            "name": name,
            "difficulty": difficulty,
            "weight": weight,
            "is_weak": is_weak,
            "credit_hours": hrs,
        })
        total_weight += weight

    # Guard against ZeroDivisionError downstream. If every weight came
    # out as 0 (e.g. all hrs=0 because the LLM passed empty credit
    # hours, or all courses got a 0 difficulty multiplier), fall back
    # to even distribution by overriding each weight to 1.
    if total_weight <= 0:
        logger.warning(
            "[tools] generate_semester_master_plan: total_weight=0 "
            "(courses=%d); falling back to even distribution",
            len(course_weights),
        )
        for cw in course_weights:
            cw["weight"] = 1.0
        total_weight = float(len(course_weights)) or 1.0

    # ── 5. Read exam dates for pressure-aware scheduling ──
    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")

    try:
        e_snaps = (user_ref.collection("exams")
                   .where(filter=FieldFilter("done", "==", False))
                   .where(filter=FieldFilter("date", ">=", today_str))
                   .order_by("date")
                   .limit(20).get())
        exams = [{"id": d.id, **d.to_dict()} for d in e_snaps]
    except Exception:
        exams = []

    # Map exam dates by subject
    exam_dates = {}  # subject -> date string
    for ex in exams:
        subj = ex.get("subject", "")
        exam_dates[subj] = ex.get("date", "")

    # ── 6. Generate weekly plan ──
    daily_mins = daily_study_hours * 60
    study_days = 7 if include_weekends else 5  # Sun-Thu (skip Fri/Sat)

    all_tasks = []
    plan_start = today
    timestamp = int(today.timestamp() * 1000)

    # Day name mapping (0=Mon → Arabic calendar starts Sunday)
    DAY_NAMES_AR = [
        "الإثنين", "الثلاثاء", "الأربعاء", "الخميس",
        "الجمعة", "السبت", "الأحد"
    ]

    for week_num in range(total_weeks):
        week_start = plan_start + timedelta(weeks=week_num)

        for day_offset in range(7):
            day_date = week_start + timedelta(days=day_offset)
            weekday = day_date.weekday()  # 0=Mon

            # Skip weekends if not included (Fri=4, Sat=5)
            if not include_weekends and weekday in (4, 5):
                continue

            date_str = day_date.strftime("%Y-%m-%d")
            day_mins_remaining = daily_mins

            # ── Stress Buffer: light day before exams ──
            is_pre_exam = False
            pre_exam_subject = None
            for subj, ex_date in exam_dates.items():
                try:
                    ex_dt = datetime.fromisoformat(ex_date)
                    days_to_exam = (ex_dt - day_date).days
                    if 0 <= days_to_exam <= 2:
                        is_pre_exam = True
                        pre_exam_subject = subj
                except (ValueError, TypeError):
                    pass

            # If high stress + pre-exam → buffer day (lighter load)
            if stress in ("high", "critical") and is_pre_exam:
                # Dedicate 80% of time to exam subject, rest is break
                exam_mins = int(daily_mins * 0.8)
                session_duration = int(focus_mins * speed_multiplier)

                all_tasks.append({
                    "id": f"task_{timestamp}_{len(all_tasks)}",
                    "title": f"🚨 مراجعة مكثفة: {pre_exam_subject}",
                    "subject": pre_exam_subject,
                    "duration": exam_mins,
                    "date": date_str,
                    "time": slots.get("hard", "16:00"),
                    "priority": "high",
                    "notes": f"يوم تحضيري للاختبار — ركّز على {pre_exam_subject}",
                    "done": False,
                    "type": "exam_prep",
                    "is_buffer": True,
                })
                continue  # Skip normal scheduling for this day

            # ── Normal day: distribute by weight ──
            for cw in sorted(course_weights, key=lambda x: -x["weight"]):
                if day_mins_remaining <= 0:
                    break

                # Proportion of daily time for this course.
                # `total_weight` is clamped > 0 above so this can't
                # divide-by-zero — but keep a belt-and-braces guard
                # in case a future refactor breaks that invariant.
                safe_total = total_weight if total_weight > 0 else 1.0
                share = cw["weight"] / safe_total
                course_mins = int(daily_mins * share)

                # Speed adjustment
                course_mins = int(course_mins * speed_multiplier)
                course_mins = max(focus_mins, min(course_mins, day_mins_remaining))

                # Determine time slot based on difficulty
                diff = cw["difficulty"]
                slot_time = slots.get(diff, slots.get("medium", "16:00"))

                # Priority from weakness
                priority = "high" if cw["is_weak"] else (
                    "high" if diff == "hard" else "medium" if diff == "medium" else "low"
                )

                # Notes with personality
                notes_parts = []
                if cw["is_weak"]:
                    notes_parts.append("⚠️ مادة تحتاج تقوية")
                if diff == "hard":
                    notes_parts.append(f"🎯 تركيز عميق {focus_mins} دقيقة + راحة {break_minutes} دق")
                if study_method:
                    notes_parts.append(f"📚 أسلوب: {study_method}")

                exam_dt_str = exam_dates.get(cw["name"])
                if exam_dt_str:
                    try:
                        days_to = (datetime.fromisoformat(exam_dt_str) - day_date).days
                        if 0 < days_to <= 7:
                            notes_parts.append(f"🚨 اختبار بعد {days_to} أيام!")
                    except (ValueError, TypeError):
                        pass

                all_tasks.append({
                    "id": f"task_{timestamp}_{len(all_tasks)}",
                    "title": f"مذاكرة: {cw['name']}",
                    "subject": cw["name"],
                    "duration": course_mins,
                    "date": date_str,
                    "time": slot_time,
                    "priority": priority,
                    "notes": " | ".join(notes_parts) if notes_parts else "",
                    "done": False,
                    "type": "study",
                    "courseCode": cw["course"].get("code", ""),
                })

                day_mins_remaining -= course_mins

    # ── 7. Save master plan to canonical plan/current (Phase 4C.3.2) ──
    plan_title = "🎯 الخطة الفصلية الذكية"
    plan = {
        "title": plan_title,
        "tasks": all_tasks,
        "createdAt": now_iso,
        "active": True,
        "type": "semester_master",
        "weeks": total_weeks,
        "focus_mode": focus_mode,
        "personalization": {
            "peak_time": peak_time,
            "speed": speed,
            "stress": stress,
            "focus_mins": focus_mins,
            "daily_hours": daily_study_hours,
            "method": study_method,
        },
        "subject_weights": [
            {"name": cw["name"], "weight": round(cw["weight"], 1),
             "is_weak": cw["is_weak"], "difficulty": cw["difficulty"]}
            for cw in course_weights
        ],
    }
    payload = agent_legacy_plan_to_canonical(plan, model="agent-semester")
    upsert_plan_current_sync(user_ref, payload)

    # ── 8. Build summary ──
    weak_courses = [cw["name"] for cw in course_weights if cw["is_weak"]]
    hard_courses = [cw["name"] for cw in course_weights if cw["difficulty"] == "hard"]

    summary = f"🎯 تم إنشاء خطة فصلية ذكية بـ {len(all_tasks)} جلسة عبر {total_weeks} أسبوع.\n"
    summary += f"⏰ جلساتك في ال{'صباح' if peak_time == 'morning' else 'مساء' if peak_time == 'evening' else 'ليل'} — {daily_study_hours} ساعات/يوم.\n"

    if weak_courses:
        summary += f"⚠️ مواد ضعيفة (وقت مضاعف): {', '.join(weak_courses)}.\n"
    if hard_courses:
        summary += f"📕 مواد صعبة (في وقت الذروة): {', '.join(hard_courses)}.\n"
    if stress in ("high", "critical"):
        summary += "🛡️ تم إضافة أيام تحضيرية مخففة قبل الاختبارات.\n"
    if speed == "slow":
        summary += "🐢 جلسات أطول + استراحات أكثر لتناسب أسلوبك.\n"
    elif speed == "fast":
        summary += "🏃 جلسات مركزة وسريعة لتناسب أسلوبك.\n"

    return {
        "success": True,
        "plan_id": "current",
        "total_sessions": len(all_tasks),
        "weeks": total_weeks,
        "focus_mode": focus_mode,
        "weak_courses": weak_courses,
        "hard_courses": hard_courses,
        "message": summary,
    }


async def _student_tools(ctx: ToolContext, args: dict) -> dict:
    """Student tools: attendance & daily schedule"""
    tool_name = ctx.tool_name
    user_id = ctx.user_id
    db = ctx.db
    from services.agent_student_tools import run_student_tool
    return run_student_tool(tool_name, args, user_id, db)


HANDLERS = {
    "emit_client_action": _emit_client_action,
    "add_upcoming_exam": _add_upcoming_exam,
    "get_upcoming_exams": _get_upcoming_exams,
    "create_study_plan": _create_study_plan,
    "complete_task": _complete_task,
    "modify_study_session": _modify_study_session,
    "generate_semester_master_plan": _generate_semester_master_plan,
    "get_attendance_status": _student_tools,
    "record_absence": _student_tools,
    "get_day_schedule": _student_tools,
    "get_graduation_progress": _student_tools,
}
