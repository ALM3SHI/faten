"""Tool routing: every intent sees the read-only tools; write tools only for action intents."""

import pytest

from agent.prompts import build_system_prompt
from agent.tool_policy import ACTION_INTENTS, SAFE_TOOLS, tool_names, tools_for_intent
from agent.tools_schema import TOOLS_SCHEMA

ALL = {t["function"]["name"] for t in TOOLS_SCHEMA}
WRITE_TOOLS = {"create_study_plan", "update_profile", "emit_client_action", "generate_semester_master_plan", "add_course"}


def test_safe_tools_all_exist():
    assert SAFE_TOOLS <= ALL


@pytest.mark.parametrize("intent", ["GENERAL_QA", "PROFILE_QUERY", "COURSE_INFO", "ACADEMIC_CALENDAR", "REGULATIONS", "UNIVERSITY_NEWS"])
def test_info_intents_get_every_read_tool_but_no_write_tools(intent):
    names = set(tool_names(tools_for_intent(intent)))
    # The old routing gave COURSE_INFO only 2 tools and NEWS only 1 — a misrouted
    # regulations or attendance question could not be answered.
    assert {"search_regulations", "get_calendar_info", "get_attendance_status", "get_day_schedule", "get_university_news"} <= names
    assert not (names & WRITE_TOOLS)


@pytest.mark.parametrize("intent", sorted(ACTION_INTENTS))
def test_action_intents_get_everything(intent):
    assert set(tool_names(tools_for_intent(intent))) == ALL


@pytest.mark.parametrize("intent", ["GENERAL_QA", "REGULATIONS", "FULL_ACADEMIC_ANALYSIS"])
def test_tool_guide_is_in_every_prompt(intent):
    p = build_system_prompt(None, None, None, None, intent=intent)
    assert "get_attendance_status" in p and "search_regulations" in p
