"""
Which tools the agent may use for a message.

Before: each heuristic intent unlocked a hand-picked subset (often a single
tool), so a question routed to the "wrong" intent simply could not be
answered. Now every message that reaches the model gets *all read-only
tools*, so the model itself picks the right one; tools that change the
student's plan/profile are added only for intents where the student is
asking for changes or advice.
"""

from __future__ import annotations

from agent.tools_schema import TOOLS_SCHEMA

# Safe to expose on every message: they only read, or make a small change
# the student explicitly asked for and can undo from the UI.
SAFE_TOOLS = frozenset({
    "get_student_data",
    "analyze_transcript",
    "get_upcoming_exams",
    "get_gpa_history",
    "predict_gpa_pathway",
    "get_course_info",
    "get_course_reviews",
    "get_calendar_info",
    "search_regulations",
    "get_university_news",
    "get_attendance_status",
    "get_day_schedule",
    "record_absence",
    "navigate_to_page",
    "change_theme",
})

# Intents where the student asks the agent to change things or plan for them.
ACTION_INTENTS = frozenset({
    "SCHEDULE_TASK",
    "PLAN_OR_STUDY_ADVICE",
    "GPA_IMPROVEMENT",
    "FULL_ACADEMIC_ANALYSIS",
    "GPA_QUERY",
    "SEMESTER_QUERY",
    "UNKNOWN",
})


def _name(tool: dict) -> str:
    return tool.get("function", {}).get("name", "")


def tools_for_intent(intent: str) -> list[dict]:
    if intent in ACTION_INTENTS:
        return list(TOOLS_SCHEMA)
    return [t for t in TOOLS_SCHEMA if _name(t) in SAFE_TOOLS]


def tool_names(tools: list[dict]) -> list[str]:
    return [_name(t) for t in tools]
