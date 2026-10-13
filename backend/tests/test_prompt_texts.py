"""Static prompt texts live in agent/prompt_texts/*.md and must all load."""

import re
from pathlib import Path

from agent.prompt_texts import prompt_text
from agent.prompts import NAVIGATION_AMBIGUOUS_PROMPT, build_system_prompt

TEXT_DIR = Path(__file__).resolve().parents[1] / "agent" / "prompt_texts"
PROMPTS_SRC = (Path(__file__).resolve().parents[1] / "agent" / "prompts.py").read_text(encoding="utf-8")


def test_every_referenced_text_exists_and_is_used():
    referenced = set(re.findall(r'prompt_text\("(\w+)"\)', PROMPTS_SRC))
    on_disk = {p.stem for p in TEXT_DIR.glob("*.md")}
    assert referenced == on_disk
    for name in referenced:
        assert prompt_text(name).strip(), name


def test_texts_have_no_stray_placeholders():
    for p in TEXT_DIR.glob("*.md"):
        text = prompt_text(p.stem)
        placeholders = re.findall(r"\{(\w+)\}", text)
        expected = ["today_ar"] if p.stem == "base_identity" else []
        assert placeholders == expected, p.name


def test_prompt_is_assembled_from_the_texts():
    p = build_system_prompt(None, None, None, None, intent="REGULATIONS")
    assert prompt_text("scope_policy") in p
    assert prompt_text("regulations") in p
    assert prompt_text("tool_guide") in p
    assert "{today_ar}" not in p
    assert NAVIGATION_AMBIGUOUS_PROMPT.startswith("You are a route resolver")
