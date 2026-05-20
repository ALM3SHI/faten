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


def workspace_plan_to_active_plan(plan_section: dict | None) -> dict | None:
    """Map workspace `plan` slice → legacy active_plan shape for agent context."""
    if not plan_section or not plan_section.get("plan"):
        return None
    plan_obj = plan_section["plan"]
    tasks = plan_obj.get("tasks") if isinstance(plan_obj, dict) else []
    return {
        "plan": plan_obj,
        "tasks": tasks or [],
        "active": True,
        "model": plan_section.get("model"),
        "generatedAt": plan_section.get("generatedAt"),
        "completed": plan_section.get("completed") or [],
    }


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

    plan_snap = user_ref.collection("plan").document("current").get()
    plan_current_doc = plan_snap.to_dict() if plan_snap.exists else None

    study_plan_doc = None
    if not (plan_current_doc and plan_current_doc.get("plan")):
        study_plan_doc = _fetch_active_study_plan(user_ref)

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
    return {
        "success": True,
        "transcript": normalize_transcript(main_doc, legacy_transcript=None),
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
