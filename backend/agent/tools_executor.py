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
    "OPEN_TOOL",           # payload: { tool: "pomodoro"|"gpa"|"map"|"dashboard"|"plan", zone?: "left"|"right" }
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
        _, ref = user_ref.collection("study_plans").add(plan)
        return {
            "success": True,
            "id": ref.id,
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
            snaps = (user_ref.collection("study_plans")
                     .where(filter=FieldFilter("active", "==", True))
                     .order_by("createdAt", direction="DESCENDING")
                     .limit(1).get())
            docs = list(snaps)
            data["study_plan"] = docs[0].to_dict() if docs else None

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
        value = args["value"]
        user_ref.update({
            f"profile.{field}": value,
            "updatedAt": now_iso,
        })
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
        # Mirror to the legacy flat path too, in case any pre-migration
        # tool still reads it during the current request.
        user_ref.update({"profile.courses": ArrayUnion([course])})
        return {"success": True, "message": f"تمت إضافة مادة \"{name_val}\""}

    # ── 9. Complete Task ──
    elif tool_name == "complete_task":
        snaps = (user_ref.collection("study_plans")
                 .where(filter=FieldFilter("active", "==", True))
                 .order_by("createdAt", direction="DESCENDING")
                 .limit(1).get())
        docs = list(snaps)
        if not docs:
            return {"success": False, "message": "لا توجد خطة نشطة"}

        plan_doc = docs[0]
        plan_data = plan_doc.to_dict()
        tasks = plan_data.get("tasks", [])
        found = False

        # Accept both task_name (backend) and task_title (frontend)
        search_name = args.get("task_name") or args.get("task_title", "")

        updated_tasks = []
        for t in tasks:
            if t.get("id") == args.get("task_id") or (
                search_name and search_name in t.get("title", "")
            ):
                found = True
                updated_tasks.append({**t, "done": True, "doneAt": now_iso})
            else:
                updated_tasks.append(t)

        if not found:
            return {"success": False, "message": "لم يتم العثور على المهمة"}

        plan_doc.reference.update({"tasks": updated_tasks})
        return {"success": True, "message": "تم تحديد المهمة كمنجزة ✅"}

    # ═══════════════════════════════════════════════════════════════
    #  SUPER-AGENT TOOLS (v2.0)
    # ═══════════════════════════════════════════════════════════════

    # ── 10. Modify Study Session ──
    elif tool_name == "modify_study_session":
        snaps = (user_ref.collection("study_plans")
                 .where(filter=FieldFilter("active", "==", True))
                 .order_by("createdAt", direction="DESCENDING")
                 .limit(1).get())
        docs = list(snaps)
        if not docs:
            return {"success": False, "message": "لا توجد خطة دراسية نشطة لتعديلها"}

        plan_doc = docs[0]
        plan_data = plan_doc.to_dict()
        tasks = plan_data.get("tasks", [])

        # Find the task to modify
        search_name = args.get("task_name") or args.get("task_id", "")
        found_idx = -1
        for idx, t in enumerate(tasks):
            if t.get("id") == args.get("task_id") or (
                search_name and search_name in t.get("title", "")
            ):
                found_idx = idx
                break

        if found_idx == -1:
            return {"success": False, "message": f"لم أجد مهمة باسم '{search_name}' في الخطة الحالية"}

        # Apply modifications
        task = tasks[found_idx]
        changes = []

        if args.get("new_date"):
            task["date"] = args["new_date"]
            changes.append(f"التاريخ → {args['new_date']}")
        if args.get("new_time"):
            task["time"] = args["new_time"]
            changes.append(f"الوقت → {args['new_time']}")
        if args.get("new_duration"):
            task["duration"] = args["new_duration"]
            changes.append(f"المدة → {args['new_duration']} دقيقة")
        if args.get("new_subject"):
            task["subject"] = args["new_subject"]
            changes.append(f"المادة → {args['new_subject']}")
        if args.get("new_priority"):
            task["priority"] = args["new_priority"]
            changes.append(f"الأولوية → {args['new_priority']}")

        if not changes:
            return {"success": False, "message": "لم يتم تحديد أي تغييرات"}

        # Record modification history
        task["modifiedAt"] = now_iso
        task["modificationReason"] = args.get("reason", "")

        tasks[found_idx] = task
        plan_doc.reference.update({"tasks": tasks})

        changes_str = "، ".join(changes)
        return {
            "success": True,
            "message": f"✏️ تم تعديل \"{task.get('title', '')}\": {changes_str}",
            "modified_task": task,
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

        user_ref.update({
            f"study_preferences.{field}": value,
            "updatedAt": now_iso,
        })

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

        # ── 7. Deactivate old plans & save new master plan ──
        old_plans = (user_ref.collection("study_plans")
                     .where(filter=FieldFilter("active", "==", True)).get())
        for old in old_plans:
            old.reference.update({"active": False})

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
        _, ref = user_ref.collection("study_plans").add(plan)

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
            "plan_id": ref.id,
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
        # Keep profile.currentGpa in sync
        user_ref.update({
            "profile.currentGpa": float(args["gpa"]),
            "updatedAt": now_iso,
        })
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

        snap = user_ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        courses = user_data.get("profile", {}).get("courses", [])

        course_name = args["course_name"]
        grade       = float(args["grade"])

        found = False
        for c in courses:
            if _norm(course_name) in _norm(c.get("name", "")) or \
               _norm(c.get("name", "")) in _norm(course_name):
                c["grade"]     = grade
                c["updatedAt"] = now_iso
                found = True
                break

        if not found:
            return {"success": False, "message": f"لم أجد مادة باسم: {course_name}"}

        user_ref.update({"profile.courses": courses, "updatedAt": now_iso})
        return {
            "success": True,
            "message": f"تم تحديث درجة {course_name} إلى {grade} / 4.00",
        }

    # ── Unknown tool ──
    else:
        return {"success": False, "message": f"أداة غير معروفة: {tool_name}"}

