"""Offline check of the eval set: every question reaches the model with the
tool it needs (routing can't silently hide a tool again)."""

import json
from pathlib import Path

import pytest

from agent.intent import classify_intent_heuristic
from agent.tool_policy import tool_names, tools_for_intent
from agent.tools_schema import TOOLS_SCHEMA

CASES = json.loads((Path(__file__).resolve().parent.parent / "evals" / "agent_cases.json").read_text("utf-8"))
ALL = {t["function"]["name"] for t in TOOLS_SCHEMA}


def test_cases_are_well_formed():
    ids = [c["id"] for c in CASES]
    assert len(ids) == len(set(ids)) >= 15
    for c in CASES:
        assert c["q"].strip() and set(c["tools"]) <= ALL, c["id"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_expected_tool_is_offered(case):
    intent = classify_intent_heuristic([{"role": "user", "content": case["q"]}])["intent"]
    if intent in ("GREETING", "NAVIGATION"):
        assert not case["tools"], f"{case['id']} would bypass the agent ({intent})"
        return
    offered = set(tool_names(tools_for_intent(intent)))
    if case["tools"]:
        assert offered & set(case["tools"]), f"{case['id']}: intent={intent} offers none of {case['tools']}"
