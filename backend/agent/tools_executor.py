"""
================================================================
UQU AGENT — Tools Executor (v3.1 — 14 Tools)
================================================================
Executes AI agent tool calls and writes results to Firestore.
All GPA values operate on the official UQU 4.00 scale.
Includes Personalized Semester Planner with learning-style DNA.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from google.cloud.firestore_v1 import ArrayUnion
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger(__name__)


def _coerce_task_dict(t, idx: int) -> dict | None:
    """Some LLMs emit array members as JSON-encoded strings — e.g.
    `tasks: ["{\\"title\\":\\"X\\"}", ...]` instead of an array of
    objects. Without this guard, the next `t["title"]` access blows
    up with: `string indices must be integers, not 'str'`.

    Accepts either a dict (pass-through) or a JSON string (parsed).
    Returns None for anything that can't be turned into a dict so
    the caller can skip the malformed entry. Logs a warning so we
    can see this happening in the LLM output."""
    if isinstance(t, dict):
        return t
    if isinstance(t, str):
        try:
            parsed = json.loads(t)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            logger.warning(
                "[tools] task #%d arrived as un-parseable JSON string: %s",
                idx, exc,
            )
            return None
        if isinstance(parsed, dict):
            return parsed
        logger.warning(
            "[tools] task #%d parsed as non-dict (%s); skipping",
            idx, type(parsed).__name__,
        )
        return None
    logger.warning(
        "[tools] task #%d has unexpected type %s; skipping",
        idx, type(t).__name__,
    )
    return None

from services.student import (
    load_academic_record,
    academic_record_current_courses,
    academic_record_completed_courses,
)
from services.workspace import (
    agent_legacy_plan_to_canonical,
    apply_complete_task,
    apply_modify_study_session,
    load_plan_for_tool_mutation_sync,
    study_plan_payload_for_agent,
    upsert_plan_current_sync,
    load_workspace_sync,
)

def _time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    if not time_str or ":" not in time_str:
        return -1
    try:
        parts = time_str.split(":")
        return int(parts[0]) * 60 + int(parts[1][:2])
    except (ValueError, TypeError):
        return -1

def _check_time_conflict(target_date: str, start_time: str, duration_mins: int, schedule: list, active_plan_tasks: list, suggested_day: str = None) -> str | None:
    """Check if the proposed time range overlaps with any lecture or existing task."""
    start_mins = _time_to_minutes(start_time)
    if start_mins < 0:
        return None
    end_mins = start_mins + duration_mins

    target_day = suggested_day
    if target_date:
        try:
            dt = datetime.fromisoformat(target_date)
            ar_days = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
            target_day = ar_days[dt.weekday()]
        except Exception:
            pass

    # Check lectures
    if target_day:
        for lec in schedule:
            if lec.get("day") == target_day:
                lec_start_raw = lec.get("start_time") or lec.get("startTime") or ""
                lec_end_raw = lec.get("end_time") or lec.get("endTime") or ""
                lec_name = lec.get("course_name") or lec.get("subject") or lec.get("courseName") or "محاضرة مسجلة"
                
                lec_start = _time_to_minutes(lec_start_raw)
                lec_end = _time_to_minutes(lec_end_raw)
                
                if lec_start >= 0 and lec_end >= 0:
                    if max(start_mins, lec_start) < min(end_mins, lec_end):
                        return f"تعارض مع محاضرة {lec_name} من {lec_start_raw} إلى {lec_end_raw}."

    # Check active plan tasks
    for task in active_plan_tasks:
        if task.get("targetDate") == target_date or (target_day and task.get("suggestedDay") == target_day and not task.get("targetDate")):
            t_start = _time_to_minutes(task.get("suggestedTime", task.get("time", "")))
            t_dur = _to_int(task.get("durationMinutes", task.get("duration", 0)), 0)
            if t_start >= 0 and t_dur > 0:
                t_end = t_start + t_dur
                if max(start_mins, t_start) < min(end_mins, t_end):
                    return f"تعارض مع جلسة مذاكرة أخرى ({task.get('title', 'سابقة')}) في نفس الوقت."
    return None



# ──────────────────────────────────────────────────────────────────
# Numeric coercion helpers
# ──────────────────────────────────────────────────────────────────
# The LLM frequently emits tool args as JSON strings ("4" instead of 4),
# and Firestore preserves whatever type the original writer stored —
# preferences typed via the web form may land as strings too. Anywhere
# the planner does math (* 60, <= 0, etc.) we must coerce first or risk
# `TypeError: '<=' not supported between instances of 'str' and 'int'`.

def _to_int(v, default: int) -> int:
    """Best-effort int coercion. Falls back to `default` on any failure."""
    if v is None or v == "":
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return default


def _to_float(v, default: float) -> float:
    """Best-effort float coercion. Falls back to `default` on any failure."""
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# Canonical profile / preferences field mapping (Phase 4C.5).
_PROFILE_BASIC_FIELDS = frozenset({
    "name", "major", "level", "studentId", "totalPlanHours",
})
_PROFILE_GOALS_FIELDS = frozenset({"currentGpa", "targetGpa"})
_VALID_LEARNING_STYLES = frozenset({"visual", "auditory", "kinesthetic", "reading"})
_ENERGY_PEAK_ALIASES = {
    "morning": "morning",
    "afternoon": "afternoon",
    "night": "night",
    "evening": "night",
    "صباحي": "morning",
    "صباح": "morning",
    "ظهر": "afternoon",
    "مسائي": "afternoon",
    "ليلي": "night",
    "ليل": "night",
}


def _coerce_profile_field_value(field: str, value):
    """Coerce update_profile values for canonical basic/goals fields."""
    if field in ("currentGpa", "targetGpa"):
        return _to_float(value, 0.0)
    if field == "totalPlanHours":
        if value is None or value == "":
            return ""
        try:
            return int(value)
        except (TypeError, ValueError):
            return value
    if field == "earnedHours":
        return _to_int(value, 0)
    return value


def _apply_learning_preference(preferences: dict, field: str, value) -> dict:
    """Map agent study_preferences keys → canonical preferences (Phase 4C.5)."""
    prefs = dict(preferences or {})
    raw = str(value).strip() if value is not None else ""

    if field == "best_time":
        key = raw.lower()
        prefs["energyPeak"] = _ENERGY_PEAK_ALIASES.get(key, _ENERGY_PEAK_ALIASES.get(raw, raw))
    elif field == "method":
        style = raw.lower()
        if style in _VALID_LEARNING_STYLES:
            prefs["learningStyle"] = style
        else:
            prefs["learningStyle"] = raw
    elif field == "focus_length":
        prefs["pomodoroFocus"] = _to_int(value, prefs.get("pomodoroFocus", 25))
    else:
        # study_hours, study_speed, stress_level — no canonical rename yet.
        prefs[field] = _to_int(value, value) if field == "study_hours" else value

    return prefs


# ──────────────────────────────────────────────────────────────────
# Client-action contract
# ──────────────────────────────────────────────────────────────────
# Whitelisted `type` values the agent is allowed to emit via the
# `emit_client_action` tool. The frontend dispatcher (lib/chat-
# client-actions.ts) implements a handler for each. Adding a new
# type means adding a handler on both sides.
ALLOWED_CLIENT_ACTION_TYPES: frozenset[str] = frozenset({
    "ADD_TASK",            # payload: { title, courseCode?, durationMinutes, suggestedDay?, suggestedTime?, priority? }
    "TOGGLE_TASK_DONE",    # payload: { taskKey }
    "UPDATE_TARGET_GPA",   # payload: { target }  — UQU 4.00 scale
    "UPDATE_BASIC_PROFILE",# payload: { name?, major?, studentId?, totalPlanHours? }
    "UPDATE_PREFERENCES",  # payload: subset of ProfilePreferences
    "NAVIGATE",            # payload: { path }
    "START_POMODORO",      # payload: { focusMinutes?, breakMinutes?, taskTitle? }
})


async def execute_tool(
    tool_name: str,
    args: dict,
    user_id: str,
    db
) -> dict:
    """Execute a tool call and write result to Firestore.

    Args:
        tool_name: Name of the tool to execute
        args: Parsed arguments from the AI model
        user_id: Firebase user ID
        db: Firestore client

    Returns:
        Result dict sent back to the AI model
    """
    user_ref = db.collection("users").document(user_id)
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── 0. Emit Client Action (no Firestore write — the frontend dispatcher
    #       picks this up from actions_log and mutates a Zustand store) ──
    if tool_name == "emit_client_action":
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
            duration = _to_int(payload.get("durationMinutes"), 25)
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
                
                conflict = _check_time_conflict(target_date, suggested_time, duration, schedule_data, active_plan_tasks, suggested_day)
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

    # ── 1. Add Exam ──
    if tool_name == "add_upcoming_exam":
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

    # ── 2. Create Study Plan ──
    elif tool_name == "create_study_plan":
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
            t = _coerce_task_dict(raw_t, i)
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

    # ── 3. Send Notification ──
    elif tool_name == "send_notification":
        notif_type = args.get("type", "info")
        default_title = "💪 رسالة تحفيز" if notif_type == "motivational" else "🔔 تنبيه"
        notif = {
            "title":     args.get("title", default_title),
            "message":   args["message"],
            "type":      notif_type,
            "read":      False,
            "createdAt": now_iso,
        }
        user_ref.collection("notifications").add(notif)
        return {"success": True, "message": "تم إرسال الإشعار"}

    # ── 4. Get Student Data ──
    elif tool_name == "get_student_data":
        section = args.get("section", "all")
        data = {}

        # Read the v3 academic_record once — used for both profile.courses
        # projection and the transcript section.
        record = load_academic_record(user_ref) if section in ("all", "profile", "transcript") else {}

        if section in ("all", "profile"):
            snap = user_ref.get()
            profile_doc = snap.to_dict() if snap.exists else {}
            # Surface current courses from the new schema under the legacy
            # `profile.courses` key the agent expects.
            if record:
                profile_block = profile_doc.setdefault("profile", {})
                cur = academic_record_current_courses(record)
                if cur and not profile_block.get("courses"):
                    profile_block["courses"] = cur
                for key in ("gpa", "earnedHours", "planHours"):
                    val = record.get(key)
                    if val is not None and not profile_block.get(key):
                        profile_block[key] = val
            data["profile"] = profile_doc

        if section in ("all", "transcript"):
            # v3 first
            if record:
                data["transcript"] = {
                    "completedCourses": academic_record_completed_courses(record),
                    "currentCourses":   academic_record_current_courses(record),
                    "gpa":          record.get("gpa"),
                    "earnedHours":  record.get("earnedHours"),
                    "planHours":    record.get("planHours"),
                    "lastUpdated":  record.get("lastUpdated"),
                    "source":       "academic_record",
                }
            else:
                snaps = (user_ref.collection("transcripts")
                         .order_by("createdAt", direction="DESCENDING")
                         .limit(1).get())
                docs = list(snaps)
                data["transcript"] = docs[0].to_dict() if docs else None

        if section in ("all", "exams"):
            snaps = (user_ref.collection("exams")
                     .where(filter=FieldFilter("done", "==", False))
                     .order_by("date")
                     .get())
            data["exams"] = [{"id": d.id, **d.to_dict()} for d in snaps]

        if section in ("all", "study_plan"):
            data["study_plan"] = study_plan_payload_for_agent(user_ref)

        if section in ("all", "preferences"):
            snap = user_ref.get()
            doc = snap.to_dict() if snap.exists else {}
            data["preferences"] = doc.get("study_preferences", {})

        return {"success": True, "data": data}

    # ── 5. Analyze Transcript ──
    elif tool_name == "analyze_transcript":
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

        # Official UQU 4.00 grade-point scale — synced with
        # frontend/src/lib/transcript-parser.ts and backend/agent/prompts.py.
        # The entire system uses this single scale; never reintroduce 5.0.
        GP = {
            "A+": 4.00, "A": 3.75,
            "B+": 3.50, "B": 3.00,
            "C+": 2.50, "C": 2.00,
            "D+": 1.50, "D": 1.00,
            "F":  0.00,
        }

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

    # ── 6. Update Profile ──
    elif tool_name == "update_profile":
        field = args["field"]
        value = _coerce_profile_field_value(args["field"], args["value"])

        snap = user_ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        basic = dict(user_data.get("basic") or {})
        goals = dict(user_data.get("goals") or {})

        if field in _PROFILE_BASIC_FIELDS:
            basic[field] = value
        elif field in _PROFILE_GOALS_FIELDS:
            goals[field] = value
        elif field == "earnedHours":
            record_ref = user_ref.collection("academic_record").document("main")
            record_ref.set(
                {"earnedHours": value, "lastUpdated": now_iso},
                merge=True,
            )
        else:
            return {"success": False, "message": f"حقل غير معروف: {field}"}

        if field != "earnedHours":
            user_ref.set(
                {
                    "basic": basic,
                    "goals": goals,
                    "lastUpdated": now_iso,
                    "updatedAt": now_iso,
                },
                merge=True,
            )

        return {"success": True, "message": f"تم تحديث {field}"}

    # ── 7. Get Upcoming Exams ──
    elif tool_name == "get_upcoming_exams":
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

    # ── 8. Add Course ──
    elif tool_name == "add_course":
        # Accept both camelCase (frontend) and snake_case (backend schema).
        credit_hrs = args.get("credit_hours") or args.get("creditHours", 3)
        name_val = args["name"]
        course = {
            # Dual key naming so both the legacy reader (`name`,
            # `credit_hours`) and the v3 enriched-course reader
            # (`nameAr`/`nameEn`, `creditHours`) find the new course.
            "name":         name_val,
            "nameAr":       name_val,
            "nameEn":       args.get("nameEn") or name_val,
            "code":         args.get("code", ""),
            "credit_hours": credit_hrs,
            "creditHours":  credit_hrs,
            "difficulty":   args.get("difficulty", "medium"),
            "examDate":     args.get("examDate") or args.get("exam_date", ""),
            "addedAt":      now_iso,
            "semesterStatus": "current",
        }
        # Write to the v3 schema (users/{uid}/academic_record/main.currentCourses)
        # so the frontend transcript store sees it on next hydration.
        record_ref = user_ref.collection("academic_record").document("main")
        record_ref.set(
            {
                "currentCourses": ArrayUnion([course]),
                "lastUpdated": now_iso,
            },
            merge=True,
        )
        return {"success": True, "message": f"تمت إضافة مادة \"{name_val}\""}

    # ── 9. Complete Task ──
    elif tool_name == "complete_task":
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

    # ═══════════════════════════════════════════════════════════════
    #  SUPER-AGENT TOOLS (v2.0)
    # ═══════════════════════════════════════════════════════════════

    # ── 10. Modify Study Session ──
    elif tool_name == "modify_study_session":
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

    # ── 11. Predict GPA Pathway ──
    elif tool_name == "predict_gpa_pathway":
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

        # Official UQU 4.00 grade-point scale — synced with
        # frontend/src/lib/transcript-parser.ts and backend/agent/prompts.py.
        # The entire system uses this single scale; never reintroduce 5.0.
        GP = {
            "A+": 4.00, "A": 3.75,
            "B+": 3.50, "B": 3.00,
            "C+": 2.50, "C": 2.00,
            "D+": 1.50, "D": 1.00,
            "F":  0.00,
        }
        # Inverse map on the UQU 4.00 scale. UQU does not officially use
        # minus grades, so the table is symmetric with GP above.
        GRADE_LABELS = {
            4.00: "A+", 3.75: "A",
            3.50: "B+", 3.00: "B",
            2.50: "C+", 2.00: "C",
            1.50: "D+", 1.00: "D",
            0.00: "F",
        }

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

    # ── 12. Update Learning Preferences ──
    elif tool_name == "update_learning_preferences":
        field = args["field"]
        value = args["value"]
        reason = args.get("reason", "")

        # Validate field names
        valid_fields = {
            "best_time", "study_hours", "method",
            "focus_length", "study_speed", "stress_level",
        }
        if field not in valid_fields:
            return {"success": False, "message": f"حقل غير صالح: {field}"}

        # Convert numeric values
        if field in ("study_hours", "focus_length"):
            try:
                value = int(value)
            except (ValueError, TypeError):
                pass

        snap = user_ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        preferences = _apply_learning_preference(
            user_data.get("preferences") or {},
            field,
            value,
        )
        user_ref.set(
            {
                "preferences": preferences,
                "lastUpdated": now_iso,
                "updatedAt": now_iso,
            },
            merge=True,
        )

        # Friendly field names for response
        field_labels = {
            "best_time": "وقت المذاكرة المفضل",
            "study_hours": "ساعات الدراسة اليومية",
            "method": "أسلوب المذاكرة",
            "focus_length": "مدة التركيز",
            "study_speed": "سرعة الدراسة",
            "stress_level": "مستوى التوتر",
        }
        label = field_labels.get(field, field)
        msg = f"✅ تم تحديث {label} إلى: {value}"
        if reason:
            msg += f" (السبب: {reason})"

        return {"success": True, "message": msg}

    # ═══════════════════════════════════════════════════════════════
    #  13. GENERATE SEMESTER MASTER PLAN (Personalized Planner)
    # ═══════════════════════════════════════════════════════════════

    elif tool_name == "generate_semester_master_plan":
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
        focus_mins = _to_int(prefs.get("focus_length"), 25)  # pomodoro length, minutes
        daily_study_hours = _to_int(
            args.get("daily_hours") or prefs.get("study_hours"),
            4,
        )
        study_method = prefs.get("method", "")
        total_weeks = _to_int(args.get("weeks"), 16)
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
        # Official UQU 4.00 grade-point scale (kept inline for locality —
        # the same map appears in prompts.py and the analytics pipeline).
        GP = {
            "A+": 4.00, "A": 3.75,
            "B+": 3.50, "B": 3.00,
            "C+": 2.50, "C": 2.00,
            "D+": 1.50, "D": 1.00,
            "F":  0.00,
        }

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
            hrs = _to_int(c.get("credit_hours") or c.get("creditHours"), 3)

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

    # ── 14. Navigate to Page (client-only — frontend handles the redirect) ──
    elif tool_name == "navigate_to_page":
        pages = {
            "dashboard": "dashboard.html",
            "gpa":       "gpa.html",
            "plan":      "plan.html",
            "pomodoro":  "pomodoro.html",
            "locations": "locations.html",
            "profile":   "profile.html",
            "chat":      "chat.html",
        }
        page = args.get("page", "dashboard")
        url  = pages.get(page, "dashboard.html")
        labels = {
            "dashboard": "اللوحة", "gpa": "المعدل", "plan": "الخطة",
            "pomodoro": "بومودورو", "locations": "القاعات",
            "profile": "الملف الشخصي", "chat": "الدردشة",
        }
        return {
            "success": True,
            "client_only": True,
            "url": url,
            "page": page,
            "message": f"جارٍ فتح صفحة {labels.get(page, page)}...",
        }

    # ── 15. Change Theme (client-only — frontend applies the theme) ──
    elif tool_name == "change_theme":
        theme = args.get("theme", "auto")
        label = {"dark": "الوضع الليلي 🌙", "light": "الوضع النهاري ☀️", "auto": "التلقائي 🌗"}.get(theme, theme)
        return {
            "success": True,
            "client_only": True,
            "theme": theme,
            "message": f"تم التغيير إلى {label}",
        }

    # ── 16. Get GPA History ──
    elif tool_name == "get_gpa_history":
        limit = int(args.get("limit", 20))
        sem_snaps = (user_ref.collection("semesters")
                     .order_by("createdAt", direction="ASCENDING")
                     .limit(limit).get())
        semesters = [{"id": d.id, **d.to_dict()} for d in sem_snaps]
        return {"success": True, "semesters": semesters, "count": len(semesters)}

    # ── 17. Add Semester GPA ──
    elif tool_name == "add_semester_gpa":
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

    # ── 18. Update Course Grade ──
    elif tool_name == "update_course_grade":
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

   # ── 19. Get Calendar Info (Server-Side Execution) ──
    elif tool_name == "get_calendar_info":
        import re
        
        query_type = args.get("query_type")
        query = str(args.get("query", "")).lower().strip()
        event_type = args.get("event_type")

        # بيانات التقويم الأكاديمي لجامعة أم القرى 1447 / 1448 هـ مدمجة بالكامل
        UQU_CALENDAR = [
            {
                "term": "الفصل الدراسي الأول",
                "events": [
                    {"title": "بداية الفصل الدراسي الأول", "date": "24 Aug 2025", "hijri": "01/03/1447", "type": "academic"},
                    {"title": "تأجيل الدراسة", "date": "24 Aug - 30 Aug 2025", "hijri": "01/03 - 07/03/1447", "type": "system"},
                    {"title": "الاعتذار عن الدراسة", "date": "31 Aug - 01 Nov 2025", "hijri": "08/03 - 10/05/1447", "type": "system"},
                    {"title": "إجازة اليوم الوطني", "date": "23 Sep 2025", "hijri": "01/04/1447", "type": "holiday"},
                    {"title": "الاختبارات النصفية", "date": "19 Oct - 30 Oct 2025", "hijri": "27/04 - 08/05/1447", "type": "exam"},
                    {"title": "الانسحاب من مقرر دراسي", "date": "02 Nov - 15 Nov 2025", "hijri": "11/05 - 24/05/1447", "type": "system"},
                    {"title": "إجازة الخريف", "date": "20 Nov - 29 Nov 2025", "hijri": "29/05 - 08/06/1447", "type": "holiday"},
                    {"title": "اختبارات المتطلبات العامة والعملية", "date": "21 Dec - 25 Dec 2025", "hijri": "01/07 - 05/07/1447", "type": "exam"},
                    {"title": "تقديم طلب إعادة القيد للفصل الثاني", "date": "21 Dec 2025 - 22 Jan 2026", "hijri": "01/07 - 03/08/1447", "type": "system"},
                    {"title": "الاختبارات النهائية", "date": "28 Dec 2025 - 08 Jan 2026", "hijri": "08/07 - 19/07/1447", "type": "exam"},
                    {"title": "إجازة منتصف العام الدراسي", "date": "08 Jan - 17 Jan 2026", "hijri": "19/07 - 28/07/1447", "type": "holiday"},
                ],
            },
            {
                "term": "الفصل الدراسي الثاني",
                "events": [
                    {"title": "تأجيل الدراسة", "date": "18 Jan - 24 Jan 2026", "hijri": "29/07 - 05/08/1447", "type": "system"},
                    {"title": "بداية الفصل الدراسي الثاني", "date": "18 Jan 2026", "hijri": "29/07/1447", "type": "academic"},
                    {"title": "الاعتذار عن الدراسة", "date": "25 Jan - 18 Apr 2026", "hijri": "06/08 - 01/11/1447", "type": "system"},
                    {"title": "إجازة يوم التأسيس", "date": "22 Feb 2026", "hijri": "05/09/1447", "type": "holiday"},
                    {"title": "إجازة عيد الفطر", "date": "05 Mar - 28 Mar 2026", "hijri": "16/09 - 09/10/1447", "type": "holiday"},
                    {"title": "الاختبارات النصفية", "date": "05 Apr - 16 Apr 2026", "hijri": "17/10 - 28/10/1447", "type": "exam"},
                    {"title": "طلب التحويل بين الكليات والأقسام", "date": "05 Apr - 18 Apr 2026", "hijri": "17/10 - 01/11/1447", "type": "system"},
                    {"title": "الانسحاب من مقرر دراسي", "date": "19 Apr - 02 May 2026", "hijri": "02/11 - 15/11/1447", "type": "system"},
                    {"title": "إدخال رغبات التسكين (تحضيري)", "date": "03 May - 09 May 2026", "hijri": "16/11 - 22/11/1447", "type": "academic"},
                    {"title": "إجازة عيد الأضحى", "date": "14 May - 01 Jun 2026", "hijri": "27/11 - 15/12/1447", "type": "holiday"},
                    {"title": "طلب إعادة القيد للفصل الصيفي", "date": "07 Jun - 30 Jun 2026", "hijri": "21/12/1447 - 15/01/1448", "type": "system"},
                    {"title": "اختبارات المتطلبات العامة والعملية", "date": "07 Jun - 11 Jun 2026", "hijri": "21/12 - 25/12/1447", "type": "exam"},
                    {"title": "الاختبارات النهائية", "date": "14 Jun - 25 Jun 2026", "hijri": "28/12/1447 - 10/01/1448", "type": "exam"},
                    {"title": "إجازة نهاية العام الدراسي", "date": "25 Jun 2026", "hijri": "10/01/1448", "type": "holiday"},
                    {"title": "التحويل الخارجي لجامعة أم القرى", "date": "25 Jun - 04 Jul 2026", "hijri": "10/01 - 19/01/1448", "type": "system"},
                ],
            },
            {
                "term": "العام الجامعي القادم",
                "events": [
                    {"title": "بداية الدراسة للعام الجامعي 1448/1449هـ", "date": "23 Aug 2026", "hijri": "10/03/1448", "type": "academic"}
                ]
            }
        ]

        results = []
        message = ""

        try:
            if query_type == "search":
                if not query:
                    return {"success": False, "message": "يجب تحديد كلمة البحث"}
                
                def _norm_cal(s: str) -> str:
                    if not s: return ""
                    s = str(s).lower()
                    s = re.sub(r"[\u064B-\u065F\u0640]", "", s)
                    s = re.sub(r"[أإآ]", "ا", s)
                    s = s.replace("ة", "ه").replace("ى", "ي")
                    return s.strip()

                nq = _norm_cal(query)
                nq_target = nq
                if any(x in nq for x in ["الاختبارات العامه", "اختبارات عامه", "المتطلبات العامه", "اختبارات المتطلبات"]):
                    nq_target = _norm_cal("اختبارات المتطلبات العامة والعملية")
                elif any(x in nq for x in ["الاختبارات النهائيه", "اختبارات نهائيه"]):
                    nq_target = _norm_cal("الاختبارات النهائية")
                elif "نهايه العام" in nq and "اجازه" in nq:
                    nq_target = _norm_cal("إجازة نهاية العام الدراسي")
                elif "اجازه الخريف" in nq:
                    nq_target = _norm_cal("إجازة الخريف")
                elif "بدايه الفصل" in nq:
                    nq_target = _norm_cal("بداية الفصل الدراسي")
                elif "الاعتذار" in nq:
                    nq_target = _norm_cal("الاعتذار عن الدراسة")

                today = datetime.now().date()
                def parse_start_date(date_str):
                    try:
                        year_match = re.search(r'\d{4}', date_str)
                        year = year_match.group(0) if year_match else str(today.year)
                        dm_match = re.search(r'\d{1,2}\s+[A-Za-z]+', date_str)
                        if dm_match:
                            first_date = dm_match.group(0)
                            full_match = re.search(first_date + r'\s+\d{4}', date_str)
                            full_date_str = full_match.group(0) if full_match else f"{first_date} {year}"
                            return datetime.strptime(full_date_str, "%d %b %Y").date()
                    except Exception:
                        pass
                    return None

                matched_events = []
                for term in UQU_CALENDAR:
                    for event in term.get("events", []):
                        e_title = _norm_cal(event.get("title", ""))
                        e_type = _norm_cal(event.get("type", ""))
                        e_date = _norm_cal(event.get("date", ""))
                        e_hijri = _norm_cal(event.get("hijri", ""))
                        
                        if (nq_target in e_title or nq_target in e_type or nq in e_title or nq in e_type or nq in e_date or nq in e_hijri):
                            event_date = parse_start_date(event.get("date", ""))
                            matched_events.append((event, event_date, term.get("term", "")))

                upcoming_results = []
                past_results = []
                for ev, ev_date, term_name in matched_events:
                    ev_copy = dict(ev)
                    ev_copy["term_name"] = term_name
                    if ev_date and ev_date >= today:
                        upcoming_results.append(ev_copy)
                    else:
                        past_results.append(ev_copy)
                
                results = upcoming_results + past_results
                results = results[:4]
                
                message = f"تم العثور على {len(results)} حدث مطابق"

            elif query_type == "by_type":
                if not event_type:
                    return {"success": False, "message": "يجب تحديد نوع الحدث"}
                for term in UQU_CALENDAR:
                    for event in term.get("events", []):
                        if event.get("type") == event_type:
                            results.append(event)
                message = f"تم العثور على {len(results)} حدث من نوع {event_type}"

            elif query_type == "by_term":
                if not query:
                    return {"success": False, "message": "يجب تحديد اسم الفصل الدراسي"}
                for term in UQU_CALENDAR:
                    if query in term.get("term", "").lower():
                        results.extend(term.get("events", []))
                message = f"تم العثور على {len(results)} حدث في الفصل الدراسي"

            elif query_type == "next_event":
                # استخراج وتجهيز دالة مساعدة لفك التواريخ المركبة مثل "24 Aug - 30 Aug 2025"
                today = datetime.now().date()
                next_event = None
                next_event_date = None

                def parse_start_date(date_str):
                    try:
                        # استخراج السنة
                        year_match = re.search(r'\d{4}', date_str)
                        year = year_match.group(0) if year_match else str(today.year)
                        
                        # استخراج اليوم والشهر الأول (مثال: "24 Aug")
                        dm_match = re.search(r'\d{1,2}\s+[A-Za-z]+', date_str)
                        if dm_match:
                            first_date = dm_match.group(0)
                            # دمج السنة مع اليوم والشهر إذا لم تكن مرتبطة به
                            full_match = re.search(first_date + r'\s+\d{4}', date_str)
                            full_date_str = full_match.group(0) if full_match else f"{first_date} {year}"
                            
                            return datetime.strptime(full_date_str, "%d %b %Y").date()
                    except Exception:
                        pass
                    return None

                for term in UQU_CALENDAR:
                    for event in term.get("events", []):
                        event_date = parse_start_date(event.get("date", ""))
                        if event_date and event_date >= today:
                            if next_event is None or event_date < next_event_date:
                                next_event = event
                                next_event_date = event_date

                if next_event:
                    results = [next_event]
                    message = "تم العثور على الحدث القادم"
                else:
                    message = "لا توجد أحداث قادمة"

            elif query_type == "all":
                for term in UQU_CALENDAR:
                    results.extend(term.get("events", []))
                message = f"جميع الأحداث: {len(results)} حدث"

            else:
                return {"success": False, "message": "نوع استعلام غير معروف"}

        except Exception as e:
            logger.error(f"[Calendar Tool] Error: {e}")
            return {"success": False, "message": "حدث خطأ أثناء البحث في التقويم"}

        # إرجاع البيانات بشكل نقي (بدون client_only) للنموذج (LLM)
        return {
            "success": True,
            "data": results,
            "message": message
        }

    # ── 20. Get Course Info (READ-ONLY catalog lookup) ──
    #    Reads the top-level `courses` collection. Document ID == course
    #    code (e.g. "CS4510"); fields include course_id, course_name (EN),
    #    course_name_ar (AR), exam_dates, grading_policy, and any extras.
    #    This branch performs NO Firestore writes.
    elif tool_name == "get_course_info":
        import re as _re
        from difflib import SequenceMatcher

        raw_query = str(args.get("query", "")).strip()
        if not raw_query:
            return {
                "success": True,
                "found": False,
                "query": raw_query,
                "message": "Course not found in Firestore courses collection.",
            }

        # Fold Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) digits → ASCII
        # so "مواضيع مختارة ٢" and "مواضيع مختارة 2" compare equal.
        _DIGIT_FOLD = str.maketrans(
            "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
            "01234567890123456789",
        )
        # Arabic tashkeel/diacritics + tatweel (ـ) — stripped before matching.
        _TASHKEEL_RE = _re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
        # Punctuation/symbols that should not affect name matching.
        _PUNCT_RE = _re.compile(r"[\-\u2013\u2014_()\[\]{}،,.:;/\\|!؟?\"'`~]")

        def _norm(s: str) -> str:
            """Normalize Arabic/English text for tolerant matching:
            fold Arabic-Indic digits, strip tashkeel/tatweel, unify alef/ya/
            ta-marbuta variants, drop punctuation, collapse whitespace, lower."""
            if not s:
                return ""
            s = str(s).translate(_DIGIT_FOLD)
            s = _TASHKEEL_RE.sub("", s)
            s = _re.sub(r"[أإآ]", "ا", s)
            s = (s.replace("ؤ", "و")
                   .replace("ئ", "ي")
                   .replace("ى", "ي")
                   .replace("ة", "ه"))
            s = _PUNCT_RE.sub(" ", s)
            s = _re.sub(r"\s+", " ", s)
            return s.lower().strip()

        def _code_key(s: str) -> str:
            """Course-code comparison key: fold digits, drop spaces/dashes,
            uppercase."""
            s = str(s or "").translate(_DIGIT_FOLD)
            return _re.sub(r"[\s\-_]", "", s).upper()

        # Question/filler words stripped from the query before name scoring
        # so "وش معلومات مادة مواضيع مختارة؟" scores against "مواضيع مختارة".
        # Stored on the normalized form (ة→ه, إ/أ/آ→ا) to match _norm output.
        _FILLER_WORDS = {
            "وش", "ما", "ماهي", "هي", "هو", "معلومات", "معلومه", "ماده", "المعلومات",
            "عن", "حق", "حول", "اخبرني", "اعطني", "ابي", "ابغى", "ايش", "ويش",
            "كم", "متى", "وين", "هل", "تفاصيل", "بيانات", "ماهيه",
        }

        def _strip_fillers(normalized: str) -> str:
            """Drop common question/filler tokens from an already-normalized
            query, keeping the meaningful course-name tokens."""
            toks = [t for t in normalized.split(" ") if t and t not in _FILLER_WORDS]
            return " ".join(toks).strip()

        def _ratio(a: str, b: str) -> float:
            """Similarity in [0,1]; contains-match (either direction) is
            treated as a strong signal so extra words in the sentence
            (e.g. 'متى فاينل الحوسبة السحابية') don't sink a real match."""
            if not a or not b:
                return 0.0
            if a in b or b in a:
                return 0.92
            return SequenceMatcher(None, a, b).ratio()

        # Output-only HTML sanitizer.
        _BR_RE = _re.compile(r"<\s*br\s*/?\s*>|&lt;\s*br\s*/?\s*&gt;", _re.IGNORECASE)

        def _clean_str(s: str) -> str:
            text = str(s)
            if _BR_RE.search(text):
                # Convert <br> variants into markdown bullets
                cleaned = "\n- " + _BR_RE.sub("\n- ", text)
            else:
                cleaned = text
            cleaned = _re.sub(r"(\s*،\s*)+", "، ", cleaned)  # collapse dup seps
            cleaned = _re.sub(r"[ \t]+", " ", cleaned)
            return cleaned.strip()

        def _sanitize(obj):
            """Recursively clean HTML line breaks from strings in a dict/list."""
            if isinstance(obj, str):
                return _clean_str(obj)
            if isinstance(obj, dict):
                return {k: _sanitize(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_sanitize(v) for v in obj]
            return obj

        courses_col = db.collection("courses")

        # ── Tier 1: direct document fetch by code (doc ID == course code) ──
        # Try the raw query and a space/dash-stripped uppercase variant.
        doc_candidates = []
        seen_ids = set()
        for cand in (raw_query, _code_key(raw_query)):
            if cand and cand not in seen_ids:
                seen_ids.add(cand)
                doc_candidates.append(cand)

        for cand in doc_candidates:
            snap = courses_col.document(cand).get()
            if snap.exists:
                course = snap.to_dict() or {}
                course.setdefault("course_id", snap.id)
                return {"success": True, "found": True, "course": _sanitize(course)}

        # ── Load the catalog once for the remaining tiers (~7 docs). ──
        all_docs = list(courses_col.stream())
        catalog = []
        for d in all_docs:
            data = d.to_dict() or {}
            data.setdefault("course_id", d.id)
            catalog.append((d.id, data))

        qn = _norm(raw_query)
        qcode = _code_key(raw_query)
        q_clean = _strip_fillers(qn) or qn  # never let stripping empty it out

        # ── Tier 2: exact code match via course_id field (case-insensitive) ──
        for doc_id, data in catalog:
            cid = data.get("course_id") or doc_id
            if qcode and _code_key(cid) == qcode:
                return {"success": True, "found": True, "course": _sanitize(data)}

        # ── Tier 3: fuzzy name/code scoring ──
        # Score each course against the cleaned query (and the raw normalized
        # query as a fallback), taking the best of AR-name / EN-name / code.
        # Thresholds:
        #   • best >= 0.75  → return that single course.
        #   • 0.55 .. 0.75  → ambiguous: return all candidates, ask to choose.
        #   • < 0.55        → not found (no hallucination).
        HIGH_THRESHOLD = 0.75
        LOW_THRESHOLD = 0.55

        scored = []
        for doc_id, data in catalog:
            name_ar = _norm(data.get("course_name_ar"))
            name_en = _norm(data.get("course_name"))
            cid_norm = _norm(data.get("course_id") or doc_id)
            score = max(
                _ratio(q_clean, name_ar),
                _ratio(q_clean, name_en),
                _ratio(qn, name_ar),
                _ratio(qn, name_en),
                _ratio(q_clean, cid_norm),
            )
            scored.append((round(score, 3), data))

        scored.sort(key=lambda x: x[0], reverse=True)

        def _match_entry(score, data):
            return {
                "course_id": data.get("course_id"),
                "course_name": _clean_str(data.get("course_name") or ""),
                "course_name_ar": _clean_str(data.get("course_name_ar") or ""),
                "score": score,
            }

        if scored:
            # High-confidence band. If several courses tie at >= HIGH, don't
            # guess between them — surface the tied set for the user to pick.
            high = [(s, d) for s, d in scored if s >= HIGH_THRESHOLD]
            if len(high) == 1:
                return {"success": True, "found": True, "course": _sanitize(high[0][1])}
            if len(high) > 1:
                return {
                    "success": True,
                    "found": True,
                    "multiple": True,
                    "matches": [_match_entry(s, d) for s, d in high],
                }

            # Ambiguous band — not confident enough to auto-pick. Return every
            # plausible candidate (even a lone one) so the assistant confirms
            # with the user instead of guessing.
            mid = [(s, d) for s, d in scored if s >= LOW_THRESHOLD]
            if mid:
                return {
                    "success": True,
                    "found": True,
                    "multiple": True,
                    "matches": [_match_entry(s, d) for s, d in mid],
                }

        # ── No reliable match ──
        return {
            "success": True,
            "found": False,
            "query": raw_query,
            "message": (
                "Course not found in Firestore courses collection. "
                "Ask the user to verify the name or provide the course code "
                "(e.g. CS4510)."
            ),
        }

    # ── Unknown tool ──
    else:
        return {"success": False, "message": f"أداة غير معروفة: {tool_name}"}

