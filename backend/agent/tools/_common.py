"""Helpers shared by the agent tool groups (agent/tools/*)."""

import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def coerce_task_dict(t, idx: int) -> dict | None:
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


def time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    if not time_str or ":" not in time_str:
        return -1
    try:
        parts = time_str.split(":")
        return int(parts[0]) * 60 + int(parts[1][:2])
    except (ValueError, TypeError):
        return -1

def check_time_conflict(target_date: str, start_time: str, duration_mins: int, schedule: list, active_plan_tasks: list, suggested_day: str = None) -> str | None:
    """Check if the proposed time range overlaps with any lecture or existing task."""
    start_mins = time_to_minutes(start_time)
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
                
                lec_start = time_to_minutes(lec_start_raw)
                lec_end = time_to_minutes(lec_end_raw)
                
                if lec_start >= 0 and lec_end >= 0:
                    if max(start_mins, lec_start) < min(end_mins, lec_end):
                        return f"تعارض مع محاضرة {lec_name} من {lec_start_raw} إلى {lec_end_raw}."

    # Check active plan tasks
    for task in active_plan_tasks:
        if task.get("targetDate") == target_date or (target_day and task.get("suggestedDay") == target_day and not task.get("targetDate")):
            t_start = time_to_minutes(task.get("suggestedTime", task.get("time", "")))
            t_dur = to_int(task.get("durationMinutes", task.get("duration", 0)), 0)
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

def to_int(v, default: int) -> int:
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


def to_float(v, default: float) -> float:
    """Best-effort float coercion. Falls back to `default` on any failure."""
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# Canonical profile / preferences field mapping (Phase 4C.5).
PROFILE_BASIC_FIELDS = frozenset({
    "name", "major", "level", "studentId", "totalPlanHours",
})
PROFILE_GOALS_FIELDS = frozenset({"currentGpa", "targetGpa"})
VALID_LEARNING_STYLES = frozenset({"visual", "auditory", "kinesthetic", "reading"})
ENERGY_PEAK_ALIASES = {
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


def coerce_profile_field_value(field: str, value):
    """Coerce update_profile values for canonical basic/goals fields."""
    if field in ("currentGpa", "targetGpa"):
        return to_float(value, 0.0)
    if field == "totalPlanHours":
        if value is None or value == "":
            return ""
        try:
            return int(value)
        except (TypeError, ValueError):
            return value
    if field == "earnedHours":
        return to_int(value, 0)
    return value


def apply_learning_preference(preferences: dict, field: str, value) -> dict:
    """Map agent study_preferences keys → canonical preferences (Phase 4C.5)."""
    prefs = dict(preferences or {})
    raw = str(value).strip() if value is not None else ""

    if field == "best_time":
        key = raw.lower()
        prefs["energyPeak"] = ENERGY_PEAK_ALIASES.get(key, ENERGY_PEAK_ALIASES.get(raw, raw))
    elif field == "method":
        style = raw.lower()
        if style in VALID_LEARNING_STYLES:
            prefs["learningStyle"] = style
        else:
            prefs["learningStyle"] = raw
    elif field == "focus_length":
        prefs["pomodoroFocus"] = to_int(value, prefs.get("pomodoroFocus", 25))
    else:
        # study_hours, study_speed, stress_level — no canonical rename yet.
        prefs[field] = to_int(value, value) if field == "study_hours" else value

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
