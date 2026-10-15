"""
================================================================
UQU Academic Assistant — Workspace Loader Service
================================================================
Single source for reading a user's workspace from Firestore.

Canonical paths (read-first):
  users/{uid}
  users/{uid}/academic_record/main
  users/{uid}/academic_record/schedule
  users/{uid}/plan/current
  users/{uid}/chats/{threadId}
  users/{uid}/achievements/state
  users/{uid}/notifications/{notificationId}

Legacy fallbacks (read-only):
  users/{uid}/study_plans, chat_history, transcripts
  users/{uid}.profile, study_preferences, timetable

Consumers:
  - routers/workspace.py   (GET /api/workspace, PATCH profile/transcript/schedule/plan/chats)
  - services/student.py    (agent / student-context; partial reuse)
"""

from __future__ import annotations

import asyncio
import copy
import logging
from datetime import datetime, timezone
from typing import Any

from firebase_admin import firestore as fb_firestore
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger(__name__)

# ── Defaults (mirror frontend profileStore) ───────────────────────────────

DEFAULT_BASIC = {"name": "", "major": "", "studentId": "", "totalPlanHours": ""}
DEFAULT_GOALS = {"currentGpa": 0, "targetGpa": 0}
DEFAULT_PREFS = {
    "learningStyle": "visual",
    "energyPeak": "morning",
    "taskStrategy": "eat_frog",
    "pomodoroFocus": 25,
    "pomodoroShortBreak": 5,
    "pomodoroLongBreak": 15,
    "dayOff": "friday",
}

VALID_LEARNING = frozenset({"visual", "auditory", "kinesthetic", "reading"})
CHAT_HISTORY_CONV_LIMIT = 50
CHAT_HISTORY_MSG_LIMIT = 200
NOTIFICATION_LIMIT = 20


def to_iso(value: Any) -> str | None:
    """Coerce Firestore Timestamp / datetime / str → ISO string."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    if hasattr(value, "to_datetime"):
        try:
            return value.to_datetime().isoformat()
        except Exception:
            pass
    if hasattr(value, "timestamp"):
        try:
            return datetime.fromtimestamp(value.timestamp()).isoformat()
        except Exception:
            pass
    return str(value)


def transcript_has_data(transcript: dict | None) -> bool:
    """True when the normalized transcript carries real academic content."""
    if not transcript:
        return False
    if transcript.get("lastUpdated"):
        return True
    if transcript.get("completedCourses"):
        return True
    if transcript.get("currentCourses"):
        return True
    if transcript.get("gpa") is not None:
        return True
    return False


def plan_has_data(plan_section: dict | None) -> bool:
    if not plan_section:
        return False
    if plan_section.get("plan"):
        return True
    if plan_section.get("generatedAt"):
        return True
    if plan_section.get("completed"):
        return True
    return False


def _plan_task_completion_key(task: dict) -> str:
    """Match frontend planStore.taskKey when canonical fields are present."""
    day = task.get("suggestedDay") or task.get("date") or ""
    time_slot = task.get("suggestedTime") or task.get("time") or ""
    code = task.get("courseCode") or task.get("code") or ""
    if day and time_slot and code:
        return f"{day}|{time_slot}|{code}"
    task_id = task.get("id")
    return str(task_id) if task_id else ""


def _tasks_with_completion_flags(
    tasks: list,
    completed_keys: list | None,
) -> list[dict]:
    """Merge canonical completed[] keys and legacy per-task done flags."""
    completed_set = set(completed_keys or [])
    out: list[dict] = []
    for raw in tasks or []:
        if not isinstance(raw, dict):
            continue
        task = dict(raw)
        if task.get("done"):
            task["done"] = True
        else:
            key = _plan_task_completion_key(task)
            task["done"] = bool(key and key in completed_set)
        out.append(task)
    return out


def load_active_plan_docs_sync(user_ref) -> tuple[dict | None, dict | None]:
    """Canonical-first plan docs: plan/current, then active study_plans (Phase 4C.3.1)."""
    plan_snap = user_ref.collection("plan").document("current").get()
    plan_current_doc = plan_snap.to_dict() if plan_snap.exists else None

    study_plan_doc = None
    if not (plan_current_doc and plan_current_doc.get("plan")):
        study_plan_doc = _fetch_active_study_plan(user_ref)

    return plan_current_doc, study_plan_doc


def plan_section_metrics(plan_section: dict | None) -> tuple[bool, int]:
    """Return (has_plan, completed_task_count) from a normalized workspace plan slice."""
    if not plan_section or not plan_section.get("plan"):
        return False, 0
    plan_obj = plan_section["plan"]
    if not isinstance(plan_obj, dict):
        return False, 0
    raw_tasks = plan_obj.get("tasks")
    tasks = raw_tasks if isinstance(raw_tasks, list) else []
    if not tasks:
        return False, 0
    hydrated = _tasks_with_completion_flags(
        tasks,
        plan_section.get("completed") or [],
    )
    done_count = sum(1 for t in hydrated if t.get("done"))
    return True, done_count


def workspace_plan_to_active_plan(plan_section: dict | None) -> dict | None:
    """Map workspace `plan` slice → legacy active_plan shape for agent context."""
    if not plan_section or not plan_section.get("plan"):
        return None
    plan_obj = plan_section["plan"]
    if not isinstance(plan_obj, dict):
        return None
    raw_tasks = plan_obj.get("tasks")
    tasks_list = raw_tasks if isinstance(raw_tasks, list) else []
    completed_keys = plan_section.get("completed") or []
    tasks = _tasks_with_completion_flags(tasks_list, completed_keys)

    overview = (plan_obj.get("overview") or "").strip()
    if overview:
        title = overview.split("\n")[0][:80]
    else:
        title = "الخطة الدراسية"

    return {
        "title": title,
        "plan": plan_obj,
        "tasks": tasks,
        "active": True,
        "model": plan_section.get("model"),
        "generatedAt": plan_section.get("generatedAt"),
        "completed": completed_keys,
    }


def load_active_plan_sync(user_ref) -> dict | None:
    """Load active plan for agent/cron/achievements — read-only, canonical-first."""
    plan_current_doc, study_plan_doc = load_active_plan_docs_sync(user_ref)
    section = normalize_plan(plan_current_doc, study_plan_doc)
    active = workspace_plan_to_active_plan(section)
    if not active:
        return None

    if plan_current_doc and plan_current_doc.get("plan"):
        active["source"] = "plan/current"
    else:
        active["source"] = "study_plans"
        if study_plan_doc and study_plan_doc.get("title"):
            active["title"] = study_plan_doc.get("title")

    return active


def study_plan_payload_for_agent(user_ref) -> dict | None:
    """Shape expected by get_student_data(study_plan) — read-only."""
    active = load_active_plan_sync(user_ref)
    if not active:
        return None
    return {
        "title": active.get("title") or "الخطة الدراسية",
        "tasks": active.get("tasks") or [],
        "active": True,
        "createdAt": active.get("generatedAt"),
        "model": active.get("model"),
        "completed": active.get("completed") or [],
        "source": active.get("source"),
        "plan": active.get("plan"),
    }


_AR_WEEKDAYS = [
    "الإثنين", "الثلاثاء", "الأربعاء", "الخميس",
    "الجمعة", "السبت", "الأحد",
]


def _enrich_agent_task(task: dict) -> dict:
    """Add canonical plan task fields while keeping legacy agent keys."""
    t = dict(task)
    duration = t.get("durationMinutes")
    if duration is None:
        duration = t.get("duration", 60)
    try:
        t["durationMinutes"] = int(duration)
    except (TypeError, ValueError):
        t["durationMinutes"] = 60
    if t.get("duration") is None:
        t["duration"] = t["durationMinutes"]

    time_slot = t.get("suggestedTime") or t.get("time") or ""
    if time_slot:
        t["suggestedTime"] = str(time_slot)
        if not t.get("time"):
            t["time"] = t["suggestedTime"]

    subject = t.get("subject") or t.get("courseName") or ""
    if subject and not t.get("courseName"):
        t["courseName"] = subject
    code = t.get("courseCode") or t.get("code") or ""
    if code:
        t["courseCode"] = str(code)

    date_str = t.get("date")
    if date_str and not t.get("suggestedDay"):
        try:
            d = datetime.fromisoformat(str(date_str)[:10])
            t["suggestedDay"] = _AR_WEEKDAYS[d.weekday()]
        except (ValueError, TypeError):
            pass

    return t


def agent_legacy_plan_to_canonical(
    legacy_plan: dict,
    *,
    model: str | None = None,
) -> dict:
    """Map agent legacy plan dict → plan/current Firestore payload (Phase 4C.3.2)."""
    title = (legacy_plan.get("title") or "خطة دراسية").strip()
    raw_tasks = legacy_plan.get("tasks") or []
    tasks = [_enrich_agent_task(t) for t in raw_tasks if isinstance(t, dict)]

    plan_obj = legacy_plan.get("plan")
    if isinstance(plan_obj, dict):
        plan_obj = dict(plan_obj)
        if not (plan_obj.get("overview") or "").strip():
            plan_obj["overview"] = title
        inner_tasks = plan_obj.get("tasks") or tasks
        plan_obj["tasks"] = [
            _enrich_agent_task(t) for t in inner_tasks if isinstance(t, dict)
        ]
        if not plan_obj.get("dailySummary"):
            plan_obj["dailySummary"] = legacy_plan.get("dailySummary") or []
    else:
        plan_obj = {
            "overview": title,
            "tasks": tasks,
            "dailySummary": legacy_plan.get("dailySummary") or [],
        }
        for key in (
            "type", "weeks", "focus_mode", "personalization",
            "subject_weights", "deadline",
        ):
            if legacy_plan.get(key) is not None:
                plan_obj[key] = legacy_plan[key]

    generated = legacy_plan.get("createdAt") or legacy_plan.get("generatedAt")
    generated_at = to_iso(generated) or datetime.now(timezone.utc).isoformat()

    model_val = model or legacy_plan.get("model")
    if not model_val:
        if legacy_plan.get("type") == "semester_master":
            model_val = "agent-semester"
        else:
            model_val = "agent"

    completed = legacy_plan.get("completed") or []
    if not isinstance(completed, list):
        completed = []

    return {
        "plan": plan_obj,
        "model": model_val,
        "generatedAt": generated_at,
        "completed": completed,
    }


def upsert_plan_current_sync(user_ref, payload: dict) -> dict:
    """Merge agent/workspace plan onto users/{uid}/plan/current only (Phase 4C.3.2)."""
    plan_ref = user_ref.collection("plan").document("current")
    plan_ref.set(
        {
            "plan": payload.get("plan"),
            "model": payload.get("model"),
            "generatedAt": payload.get("generatedAt"),
            "completed": payload.get("completed") or [],
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    snap = plan_ref.get()
    doc = snap.to_dict() if snap.exists else {}
    return {
        "success": True,
        "plan_id": "current",
        "plan": normalize_plan(doc, study_plan_doc=None),
    }


def load_plan_for_tool_mutation_sync(user_ref) -> tuple[Any, dict | None]:
    """Canonical-first active plan for tool mutations; returns (plan_ref, section copy)."""
    plan_ref = user_ref.collection("plan").document("current")
    plan_current_doc, study_plan_doc = load_active_plan_docs_sync(user_ref)
    section = normalize_plan(plan_current_doc, study_plan_doc)
    if not section.get("plan"):
        return plan_ref, None
    return plan_ref, copy.deepcopy(section)


def _task_matches_for_tools(
    task: dict,
    task_id: str | None,
    search_name: str,
) -> bool:
    if task_id and task.get("id") == task_id:
        return True
    if search_name and search_name in (task.get("title") or ""):
        return True
    return False


def apply_complete_task(
    plan_section: dict,
    task_id: str | None,
    task_name: str,
    *,
    done_at: str,
) -> dict | None:
    """Mark a task complete; updates completed[] and/or per-task done flags."""
    plan_obj = plan_section.get("plan")
    if not isinstance(plan_obj, dict):
        return None
    raw_tasks = plan_obj.get("tasks")
    tasks = raw_tasks if isinstance(raw_tasks, list) else []
    if not tasks:
        return None

    search_name = (task_name or "").strip()
    found = False
    completed = list(plan_section.get("completed") or [])
    completed_set = set(completed)
    new_tasks: list = []

    for raw in tasks:
        if not isinstance(raw, dict):
            new_tasks.append(raw)
            continue
        task = dict(raw)
        if _task_matches_for_tools(task, task_id, search_name):
            found = True
            key = _plan_task_completion_key(task)
            if key and key not in completed_set:
                completed.append(key)
                completed_set.add(key)
            task["done"] = True
            task["doneAt"] = done_at
        new_tasks.append(task)

    if not found:
        return None

    out_section = dict(plan_section)
    out_section["completed"] = completed
    out_plan = dict(plan_obj)
    out_plan["tasks"] = new_tasks
    out_section["plan"] = out_plan
    return out_section


def apply_modify_study_session(
    plan_section: dict,
    args: dict,
    *,
    now_iso: str,
) -> dict | None:
    """Update one task in plan_section; returns updated section or None if not found."""
    plan_obj = plan_section.get("plan")
    if not isinstance(plan_obj, dict):
        return None
    raw_tasks = plan_obj.get("tasks")
    tasks = list(raw_tasks) if isinstance(raw_tasks, list) else []
    if not tasks:
        return None

    search_name = str(args.get("task_name") or args.get("task_id") or "")
    task_id = args.get("task_id")
    found_idx = -1
    for idx, raw in enumerate(tasks):
        if not isinstance(raw, dict):
            continue
        if _task_matches_for_tools(raw, task_id, search_name):
            found_idx = idx
            break

    if found_idx == -1:
        return None

    task = dict(tasks[found_idx])

    if args.get("new_date"):
        task["date"] = args["new_date"]
        try:
            d = datetime.fromisoformat(str(args["new_date"])[:10])
            task["suggestedDay"] = _AR_WEEKDAYS[d.weekday()]
        except (ValueError, TypeError):
            pass
    if args.get("new_time"):
        task["time"] = args["new_time"]
        task["suggestedTime"] = args["new_time"]
    if args.get("new_duration") is not None:
        try:
            mins = int(args["new_duration"])
        except (TypeError, ValueError):
            mins = args["new_duration"]
        task["duration"] = mins
        task["durationMinutes"] = mins
    if args.get("new_subject"):
        task["subject"] = args["new_subject"]
        task["courseName"] = args["new_subject"]
    if args.get("new_priority"):
        task["priority"] = args["new_priority"]

    task["modifiedAt"] = now_iso
    task["modificationReason"] = args.get("reason", "")
    tasks[found_idx] = task

    out_section = dict(plan_section)
    out_plan = dict(plan_obj)
    out_plan["tasks"] = tasks
    out_section["plan"] = out_plan
    return out_section


def normalize_profile(user_doc: dict | None, uid: str | None = None) -> dict:
    """Canonical root profile fields with legacy nested fallbacks."""
    d = dict(user_doc or {})
    legacy_profile = d.get("profile") or {}
    legacy_prefs = d.get("study_preferences") or {}

    basic = {**DEFAULT_BASIC, **(d.get("basic") or {})}
    if not (basic.get("name") or "").strip():
        basic["name"] = legacy_profile.get("name") or ""
    if not (basic.get("major") or "").strip():
        basic["major"] = legacy_profile.get("major") or ""
    if not (basic.get("studentId") or "").strip():
        basic["studentId"] = legacy_profile.get("studentId") or ""

    goals = {**DEFAULT_GOALS, **(d.get("goals") or {})}
    if not goals.get("currentGpa") and legacy_profile.get("currentGpa") is not None:
        goals["currentGpa"] = legacy_profile.get("currentGpa")
    if not goals.get("targetGpa") and legacy_profile.get("targetGpa") is not None:
        goals["targetGpa"] = legacy_profile.get("targetGpa")

    preferences = {**DEFAULT_PREFS, **(d.get("preferences") or {})}
    if legacy_prefs:
        style = legacy_prefs.get("method") or legacy_prefs.get("studyStyle")
        if style and preferences.get("learningStyle") == DEFAULT_PREFS["learningStyle"]:
            if style in VALID_LEARNING:
                preferences["learningStyle"] = style
        focus = legacy_prefs.get("focus_length")
        if isinstance(focus, (int, float)) and focus > 0:
            if preferences.get("pomodoroFocus") == DEFAULT_PREFS["pomodoroFocus"]:
                preferences["pomodoroFocus"] = int(focus)
        best_time = legacy_prefs.get("best_time")
        if best_time and preferences.get("energyPeak") == DEFAULT_PREFS["energyPeak"]:
            preferences["energyPeak"] = best_time

    return {
        "basic": basic,
        "goals": goals,
        "preferences": preferences,
        "lastUpdated": d.get("lastUpdated") or to_iso(d.get("updatedAt")),
        "email": d.get("email"),
        "uid": d.get("uid") or uid,
    }


def normalize_transcript(
    main_doc: dict | None,
    legacy_transcript: dict | None,
) -> dict:
    """academic_record/main with optional transcripts-collection fallback."""
    empty = {
        "name": None,
        "nameEn": None,
        "studentId": None,
        "university": None,
        "major": None,
        "faculty": None,
        "degree": None,
        "gpa": None,
        "earnedHours": None,
        "planHours": None,
        "completedCourses": [],
        "currentCourses": [],
        "confidence": 0,
        "lastUpdated": None,
    }

    if main_doc:
        out = {**empty, **main_doc}
        current = main_doc.get("currentCourses") or main_doc.get("registeredCourses") or []
        out["currentCourses"] = current
        out["completedCourses"] = main_doc.get("completedCourses") or []
        out["lastUpdated"] = main_doc.get("lastUpdated") or to_iso(main_doc.get("updatedAt"))
        return out

    if legacy_transcript:
        courses = legacy_transcript.get("courses") or []
        return {
            **empty,
            "completedCourses": courses,
            "currentCourses": [],
            "gpa": legacy_transcript.get("cgpa"),
            "earnedHours": legacy_transcript.get("totalHours"),
            "lastUpdated": legacy_transcript.get("createdAt"),
            "confidence": 0,
        }

    return empty


def normalize_schedule(schedule_doc: dict | None, user_doc: dict | None) -> dict:
    if schedule_doc and schedule_doc.get("schedule"):
        return {
            "schedule": schedule_doc.get("schedule") or [],
            "lastUpdated": schedule_doc.get("lastUpdated")
            or to_iso(schedule_doc.get("updatedAt")),
        }
    timetable = (user_doc or {}).get("timetable")
    if timetable:
        return {
            "schedule": timetable if isinstance(timetable, list) else [],
            "lastUpdated": to_iso((user_doc or {}).get("updatedAt")),
        }
    return {"schedule": [], "lastUpdated": None}


def _study_plan_to_plan_section(study_plan_doc: dict) -> dict:
    """Map legacy study_plans document → plan/current-shaped section."""
    plan_obj = study_plan_doc.get("plan")
    if not plan_obj:
        tasks = study_plan_doc.get("tasks")
        if isinstance(tasks, list):
            plan_obj = {
                "overview": study_plan_doc.get("overview") or "",
                "tasks": tasks,
                "dailySummary": study_plan_doc.get("dailySummary") or [],
            }
    return {
        "plan": plan_obj,
        "model": study_plan_doc.get("model"),
        "generatedAt": study_plan_doc.get("generatedAt") or study_plan_doc.get("createdAt"),
        "completed": study_plan_doc.get("completed") or [],
    }


def normalize_plan(
    plan_current_doc: dict | None,
    study_plan_doc: dict | None,
) -> dict:
    empty = {"plan": None, "model": None, "generatedAt": None, "completed": []}
    if plan_current_doc and (
        plan_current_doc.get("plan") or plan_current_doc.get("generatedAt")
    ):
        return {
            "plan": plan_current_doc.get("plan"),
            "model": plan_current_doc.get("model"),
            "generatedAt": plan_current_doc.get("generatedAt"),
            "completed": plan_current_doc.get("completed") or [],
        }
    if study_plan_doc:
        return _study_plan_to_plan_section(study_plan_doc)
    return empty


def _map_message_role(role: str) -> str:
    if role in ("assistant", "bot"):
        return "bot"
    return "user"


def _normalize_messages(raw_messages: list) -> list[dict]:
    out: list[dict] = []
    for m in raw_messages[:CHAT_HISTORY_MSG_LIMIT]:
        if not isinstance(m, dict):
            continue
        role = _map_message_role(str(m.get("role") or "user"))
        ts = to_iso(m.get("timestamp")) or datetime.now().isoformat()
        msg: dict = {
            "role": role,
            "content": m.get("content") or "",
            "timestamp": ts,
        }
        if m.get("actions") is not None:
            msg["actions"] = m.get("actions")
        out.append(msg)
    return out


def _derive_preview(messages: list[dict]) -> str:
    if not messages:
        return ""
    last = messages[-1]
    text = (last.get("content") or "").strip().replace("\n", " ")
    if len(text) > 120:
        return text[:119] + "…"
    return text


def _thread_from_chat_doc(doc_id: str, data: dict) -> dict:
    messages = _normalize_messages(data.get("messages") or [])
    created = to_iso(data.get("createdAt")) or datetime.now().isoformat()
    updated = to_iso(data.get("updatedAt")) or created
    return {
        "id": data.get("id") or doc_id,
        "title": data.get("title") or "محادثة",
        "preview": data.get("preview") or _derive_preview(messages),
        "createdAt": created,
        "updatedAt": updated,
        "conversationId": data.get("conversationId") or doc_id,
        "messages": messages,
    }


def _load_chat_history_threads(user_ref) -> list[dict]:
    """Legacy chat_history fallback when canonical chats collection is empty."""
    threads: list[dict] = []
    try:
        conv_snaps = list(user_ref.collection("chat_history").limit(CHAT_HISTORY_CONV_LIMIT).stream())
    except Exception as exc:
        logger.warning("[workspace] chat_history list failed: %s", exc)
        return []

    for conv_snap in conv_snaps:
        conv_id = conv_snap.id
        conv_data = conv_snap.to_dict() or {}
        messages = conv_data.get("messages") or []

        if not messages:
            try:
                msg_snaps = (
                    user_ref.collection("chat_history")
                    .document(conv_id)
                    .collection("messages")
                    .limit(CHAT_HISTORY_MSG_LIMIT)
                    .stream()
                )
                messages = [m.to_dict() for m in msg_snaps]
            except Exception as exc:
                logger.debug("[workspace] messages subcollection read failed: %s", exc)
                messages = []

        normalized = _normalize_messages(messages)
        created = to_iso(conv_data.get("createdAt")) or datetime.now().isoformat()
        updated = (
            to_iso(conv_data.get("updatedAt"))
            or (normalized[-1]["timestamp"] if normalized else created)
        )
        title = conv_data.get("title") or conv_data.get("lastMessage") or "محادثة"
        if isinstance(title, str) and len(title) > 60:
            title = title[:59] + "…"

        threads.append({
            "id": conv_id,
            "title": title,
            "preview": _derive_preview(normalized),
            "createdAt": created,
            "updatedAt": updated,
            "conversationId": conv_id,
            "messages": normalized,
        })

    threads.sort(key=lambda t: t.get("updatedAt") or "", reverse=True)
    return threads


def normalize_chats(user_ref, chat_docs: list, user_doc: dict | None = None) -> dict:
    """Prefer users/{uid}/chats; fall back to chat_history only when empty and not suppressed."""
    if chat_docs:
        threads = [_thread_from_chat_doc(snap.id, snap.to_dict() or {}) for snap in chat_docs]
        threads.sort(key=lambda t: t.get("updatedAt") or "", reverse=True)
        return {"threads": threads}

    if (user_doc or {}).get("chatsSuppressLegacyFallback"):
        return {"threads": []}

    legacy_threads = _load_chat_history_threads(user_ref)
    return {"threads": legacy_threads}


def _set_chats_suppress_legacy_fallback(user_ref, *, suppress: bool) -> None:
    """Phase 2E.2 — control whether empty chats skips chat_history fallback on GET."""
    if suppress:
        user_ref.set(
            {
                "chatsSuppressLegacyFallback": True,
                "chatsSuppressLegacyFallbackAt": datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )
    else:
        user_ref.set({"chatsSuppressLegacyFallback": False}, merge=True)


def suppress_chats_legacy_fallback_sync(user_id: str, db) -> dict:
    """Set suppress flag on users/{uid} (idempotent). Does not touch chat_history."""
    user_ref = db.collection("users").document(user_id)
    _set_chats_suppress_legacy_fallback(user_ref, suppress=True)
    return {"success": True}


def normalize_achievements(state_doc: dict | None) -> dict:
    d = state_doc or {}
    return {
        "xp": int(d.get("xp") or 0),
        "unlockedBadges": list(d.get("unlockedBadges") or []),
        "goals": list(d.get("goals") or []),
        "weeklyGoals": list(d.get("weeklyGoals") or []),
        "lastLoginDate": d.get("lastLoginDate"),
    }


def fetch_notifications(user_ref) -> list[dict]:
    try:
        snaps = (
            user_ref.collection("notifications")
            .where(filter=FieldFilter("read", "==", False))
            .order_by("createdAt", direction="DESCENDING")
            .limit(NOTIFICATION_LIMIT)
            .get()
        )
        return [{"id": d.id, **(d.to_dict() or {})} for d in snaps]
    except Exception as exc:
        logger.warning("[workspace] notifications query failed: %s", exc)
        try:
            snaps = (
                user_ref.collection("notifications")
                .limit(NOTIFICATION_LIMIT)
                .get()
            )
            return [{"id": d.id, **(d.to_dict() or {})} for d in snaps]
        except Exception as exc2:
            logger.warning("[workspace] notifications fallback failed: %s", exc2)
            return []


def _fetch_active_study_plan(user_ref) -> dict | None:
    try:
        snaps = (
            user_ref.collection("study_plans")
            .where(filter=FieldFilter("active", "==", True))
            .order_by("createdAt", direction="DESCENDING")
            .limit(1)
            .get()
        )
        docs = list(snaps)
        return docs[0].to_dict() if docs else None
    except Exception as exc:
        logger.warning("[workspace] study_plans query failed: %s", exc)
        try:
            snaps = (
                user_ref.collection("study_plans")
                .order_by("createdAt", direction="DESCENDING")
                .limit(1)
                .get()
            )
            docs = list(snaps)
            return docs[0].to_dict() if docs else None
        except Exception as exc2:
            logger.warning("[workspace] study_plans fallback failed: %s", exc2)
            return None


def load_workspace_sync(user_id: str, db) -> dict:
    """Blocking Firestore reads + normalization. Run inside executor."""
    user_ref = db.collection("users").document(user_id)

    user_snap = user_ref.get()
    user_doc = user_snap.to_dict() if user_snap.exists else {}

    main_snap = user_ref.collection("academic_record").document("main").get()
    main_doc = main_snap.to_dict() if main_snap.exists else None

    legacy_transcript = None
    try:
        t_snaps = (
            user_ref.collection("transcripts")
            .order_by("createdAt", direction="DESCENDING")
            .limit(1)
            .get()
        )
        t_docs = list(t_snaps)
        legacy_transcript = t_docs[0].to_dict() if t_docs else None
    except Exception as exc:
        logger.warning("[workspace] transcripts query failed: %s", exc)

    schedule_snap = user_ref.collection("academic_record").document("schedule").get()
    schedule_doc = schedule_snap.to_dict() if schedule_snap.exists else None

    plan_current_doc, study_plan_doc = load_active_plan_docs_sync(user_ref)

    chat_snaps = list(user_ref.collection("chats").stream())

    ach_snap = user_ref.collection("achievements").document("state").get()
    ach_doc = ach_snap.to_dict() if ach_snap.exists else None

    return {
        "success": True,
        "profile": normalize_profile(user_doc, uid=user_id),
        "transcript": normalize_transcript(main_doc, legacy_transcript),
        "schedule": normalize_schedule(schedule_doc, user_doc),
        "plan": normalize_plan(plan_current_doc, study_plan_doc),
        "chats": normalize_chats(user_ref, chat_snaps, user_doc),
        "achievements": normalize_achievements(ach_doc),
        "notifications": fetch_notifications(user_ref),
    }


async def load_workspace(user_id: str, db) -> dict:
    """Async wrapper — runs blocking Firestore I/O in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, load_workspace_sync, user_id, db)


def save_profile_sync(user_id: str, db, payload: dict) -> dict:
    """Merge canonical profile fields onto users/{uid} (Phase 2A write path)."""
    user_ref = db.collection("users").document(user_id)
    last_updated = payload.get("lastUpdated") or datetime.now(timezone.utc).isoformat()

    user_ref.set(
        {
            "basic": payload.get("basic") or DEFAULT_BASIC,
            "goals": payload.get("goals") or DEFAULT_GOALS,
            "preferences": payload.get("preferences") or DEFAULT_PREFS,
            "lastUpdated": last_updated,
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    user_snap = user_ref.get()
    user_doc = user_snap.to_dict() if user_snap.exists else {}
    return {
        "success": True,
        "profile": normalize_profile(user_doc, uid=user_id),
    }


async def save_profile(user_id: str, db, payload: dict) -> dict:
    """Async wrapper — runs blocking Firestore write in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, save_profile_sync, user_id, db, payload)


def save_transcript_sync(user_id: str, db, payload: dict) -> dict:
    """Merge canonical transcript onto users/{uid}/academic_record/main (Phase 2B)."""
    main_ref = (
        db.collection("users").document(user_id).collection("academic_record").document("main")
    )
    last_updated = payload.get("lastUpdated") or datetime.now(timezone.utc).isoformat()

    main_ref.set(
        {
            "name": payload.get("name"),
            "nameEn": payload.get("nameEn"),
            "studentId": payload.get("studentId"),
            "university": payload.get("university"),
            "major": payload.get("major"),
            "faculty": payload.get("faculty"),
            "degree": payload.get("degree"),
            "gpa": payload.get("gpa"),
            "earnedHours": payload.get("earnedHours"),
            "planHours": payload.get("planHours"),
            "completedCourses": payload.get("completedCourses") or [],
            "currentCourses": payload.get("currentCourses") or [],
            "confidence": payload.get("confidence", 0),
            "lastUpdated": last_updated,
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    main_snap = main_ref.get()
    main_doc = main_snap.to_dict() if main_snap.exists else {}
    # Every upload also checks its courses against the catalog and records new
    # or conflicting ones for review (never blocks the save).
    from services.course_observations import observe_record

    course_check = observe_record(db, user_id, payload)
    return {
        "success": True,
        "transcript": normalize_transcript(main_doc, legacy_transcript=None),
        "course_check": {k: course_check[k] for k in ("checked", "match", "missing", "conflict")},
    }


async def save_transcript(user_id: str, db, payload: dict) -> dict:
    """Async wrapper — runs blocking Firestore write in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, save_transcript_sync, user_id, db, payload)


def save_schedule_sync(user_id: str, db, payload: dict) -> dict:
    """Merge canonical schedule onto users/{uid}/academic_record/schedule (Phase 2C)."""
    schedule_ref = (
        db.collection("users")
        .document(user_id)
        .collection("academic_record")
        .document("schedule")
    )
    last_updated = payload.get("lastUpdated") or datetime.now(timezone.utc).isoformat()

    schedule_ref.set(
        {
            "schedule": payload.get("schedule") or [],
            "lastUpdated": last_updated,
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    schedule_snap = schedule_ref.get()
    schedule_doc = schedule_snap.to_dict() if schedule_snap.exists else {}
    return {
        "success": True,
        "schedule": normalize_schedule(schedule_doc, user_doc=None),
    }


async def save_schedule(user_id: str, db, payload: dict) -> dict:
    """Async wrapper — runs blocking Firestore write in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, save_schedule_sync, user_id, db, payload)


def save_plan_sync(user_id: str, db, payload: dict) -> dict:
    """Merge canonical plan onto users/{uid}/plan/current (Phase 2D). Does not write study_plans."""
    plan_ref = db.collection("users").document(user_id).collection("plan").document("current")

    plan_ref.set(
        {
            "plan": payload.get("plan"),
            "model": payload.get("model"),
            "generatedAt": payload.get("generatedAt"),
            "completed": payload.get("completed") or [],
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    plan_snap = plan_ref.get()
    plan_doc = plan_snap.to_dict() if plan_snap.exists else {}
    return {
        "success": True,
        "plan": normalize_plan(plan_doc, study_plan_doc=None),
    }


async def save_plan(user_id: str, db, payload: dict) -> dict:
    """Async wrapper — runs blocking Firestore write in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, save_plan_sync, user_id, db, payload)


def save_chat_thread_sync(user_id: str, db, thread_id: str, payload: dict) -> dict:
    """Merge canonical chat thread onto users/{uid}/chats/{thread_id} (Phase 2E).

    Does not write chat_history — audit path remains POST /api/chat only.
    """
    chat_ref = (
        db.collection("users").document(user_id).collection("chats").document(thread_id)
    )

    messages = []
    for m in payload.get("messages") or []:
        if isinstance(m, dict):
            messages.append(m)

    chat_ref.set(
        {
            "id": payload.get("id") or thread_id,
            "title": payload.get("title") or "محادثة",
            "preview": payload.get("preview") or "",
            "createdAt": payload.get("createdAt")
            or datetime.now(timezone.utc).isoformat(),
            "conversationId": payload.get("conversationId"),
            "messages": messages,
            "updatedAt": fb_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    user_ref = db.collection("users").document(user_id)
    _set_chats_suppress_legacy_fallback(user_ref, suppress=False)

    chat_snap = chat_ref.get()
    chat_doc = chat_snap.to_dict() if chat_snap.exists else {}
    return {
        "success": True,
        "thread": _thread_from_chat_doc(thread_id, chat_doc),
    }


async def save_chat_thread(user_id: str, db, thread_id: str, payload: dict) -> dict:
    """Async wrapper — runs blocking Firestore write in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, save_chat_thread_sync, user_id, db, thread_id, payload
    )


def delete_chat_thread_sync(user_id: str, db, thread_id: str) -> dict:
    """Delete users/{uid}/chats/{thread_id} only (Phase 2E.1).

    Does not read, write, or delete chat_history — audit path unchanged.
    Idempotent: deleting a missing doc is success.
    """
    chat_ref = (
        db.collection("users").document(user_id).collection("chats").document(thread_id)
    )
    chat_ref.delete()

    chats_coll = db.collection("users").document(user_id).collection("chats")
    if not list(chats_coll.limit(1).stream()):
        user_ref = db.collection("users").document(user_id)
        _set_chats_suppress_legacy_fallback(user_ref, suppress=True)

    return {"success": True, "threadId": thread_id}


async def delete_chat_thread(user_id: str, db, thread_id: str) -> dict:
    """Async wrapper — runs blocking Firestore delete in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, delete_chat_thread_sync, user_id, db, thread_id
    )


async def suppress_chats_legacy_fallback(user_id: str, db) -> dict:
    """Async wrapper — runs blocking suppress-flag write in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, suppress_chats_legacy_fallback_sync, user_id, db
    )
