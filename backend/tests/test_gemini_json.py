"""The JSON reader must not break replies that contain code blocks."""

import json

import pytest

from services.gemini import parse_json_text

LESSON = {"segments": [{"title": "ls", "markdown": "مثال:\n```bash\nls -la | grep txt\n```\nانتهى"}], "questions": []}


def test_json_with_code_fences_inside_strings():
    assert parse_json_text(json.dumps(LESSON, ensure_ascii=False)) == LESSON


def test_reply_wrapped_in_a_fence():
    text = "```json\n" + json.dumps(LESSON, ensure_ascii=False) + "\n```"
    assert parse_json_text(text) == LESSON
    assert parse_json_text("```\n[1, 2]\n```") == [1, 2]


def test_text_around_the_json_and_lists():
    assert parse_json_text('Here you go: {"a": 1} thanks') == {"a": 1}
    assert parse_json_text("result: [1, 2]") == [1, 2]


def test_cut_off_json_is_an_error():
    with pytest.raises(ValueError):
        parse_json_text('{"segments": [{"title": "x", "markdown": "```bash\nls')
