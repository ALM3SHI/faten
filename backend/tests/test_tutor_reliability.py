"""Gemini replies as they really fail: bad escapes, cut-off JSON, timeouts,
models that refuse thinkingConfig / responseJsonSchema."""

import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

from common.errors import AI_BAD_REPLY_MESSAGE, AI_TIMEOUT_MESSAGE
from services import gemini
from services.gemini import parse_json_text, repair_json_escapes
from services.tutor import ai, schemas


class FakeGemini:
    """Stands in for httpx.AsyncClient.post; scripted replies in order."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.payloads: list[dict] = []
        self.models: list[str] = []

    async def post(self, client, url, json=None, headers=None):  # noqa: A002
        self.payloads.append(json)
        self.models.append(url.split("/models/")[1].split(":")[0])
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        status, body = r
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))


def ok(text, finish="STOP"):
    return 200, {"candidates": [{"finishReason": finish, "content": {"parts": [{"text": text}]}}], "usageMetadata": {"thoughtsTokenCount": 7}}


def refused(message):
    return 400, {"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": message}}


@pytest.fixture
def fake(monkeypatch, settings):
    def install(replies):
        f = FakeGemini(replies)
        monkeypatch.setattr(httpx.AsyncClient, "post", lambda self, url, **kw: f.post(self, url, **kw))
        return f

    monkeypatch.setattr(ai, "_disabled", set())
    return install


def run(coro):
    return asyncio.run(coro)


# ── parsing ──────────────────────────────────────────────────────


def test_shell_lesson_with_bad_escapes_is_read():
    lesson_json = '{"segments": [{"title": "grep", "markdown": "```bash\\ngrep -E \'\\d+\\s\' log | sed \'s/\\./,/g\'\\n```"}], "questions": []}'
    out = parse_json_text(lesson_json)
    assert "grep -E '\\d+\\s'" in out["segments"][0]["markdown"]
    assert out["segments"][0]["markdown"].startswith("```bash\n")


def test_repair_keeps_valid_escapes():
    assert repair_json_escapes(r'"a\nb \"q\" \\d \u0627 \d C:\users"') == r'"a\nb \"q\" \\d \u0627 \\d C:\\users"'
    assert parse_json_text('{"t": "col1\tcol2"}') == {"t": "col1\tcol2"}  # raw tab


def test_cut_off_json_still_fails_loudly():
    with pytest.raises(ValueError):
        parse_json_text('{"segments": [{"markdown": "half a lesson')


# ── call_gemini ──────────────────────────────────────────────────


def test_schema_and_thinking_are_sent(fake):
    f = fake([ok('{"markdown": "x", "pages": [1], "in_lecture": true}')])
    run(ai.ask_json("p", "u", schema=schemas.ASK))
    cfg = f.payloads[0]["generationConfig"]
    assert cfg["responseJsonSchema"] == schemas.ASK
    assert cfg["thinkingConfig"] == {"thinkingLevel": "low"}
    assert cfg["responseMimeType"] == "application/json"


def test_model_that_refuses_thinking_is_retried_without_it_and_remembered(fake):
    f = fake([refused("Thinking level is not supported for this model."), ok('{"a": 1}'), ok('{"b": 2}')])
    assert run(ai.ask_json("p", "u", schema=schemas.ASK)) == {"a": 1}
    assert "thinkingConfig" in f.payloads[0]["generationConfig"]
    assert "thinkingConfig" not in f.payloads[1]["generationConfig"]
    assert "responseJsonSchema" in f.payloads[1]["generationConfig"]  # only the refused option is dropped
    run(ai.ask_json("p", "u"))
    assert "thinkingConfig" not in f.payloads[2]["generationConfig"]  # remembered


def test_unclear_400_drops_both_options_then_a_real_400_surfaces(fake):
    f = fake([refused("Invalid JSON payload received."), refused("Invalid JSON payload received.")])
    with pytest.raises(HTTPException) as e:
        run(ai.ask_json("p", "u", schema=schemas.ASK))
    assert e.value.upstream_status == 400
    second = f.payloads[1]["generationConfig"]
    assert "thinkingConfig" not in second and "responseJsonSchema" not in second
    assert len(f.payloads) == 2  # the plain request is not repeated on the fast model for a 400


def test_unreadable_reply_falls_back_to_fast_model(fake, settings):
    f = fake([ok('{"segments": [{"markdown": "half', finish="MAX_TOKENS"), ok('{"ok": true}')])
    assert run(ai.ask_json("p", "u")) == {"ok": True}
    assert f.models == [settings.GEMINI_MODEL, settings.GEMINI_FAST_MODEL]


def test_timeout_is_an_arabic_retryable_error(fake, settings):
    f = fake([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")])
    with pytest.raises(HTTPException) as e:
        run(ai.ask_json("p", "u"))
    assert e.value.status_code == 504 and e.value.detail == AI_TIMEOUT_MESSAGE
    assert f.models == [settings.GEMINI_MODEL, settings.GEMINI_FAST_MODEL]


def test_network_error_is_retryable(fake):
    f = fake([httpx.ConnectError("down"), ok('{"x": 1}')])
    assert run(ai.ask_json("p", "u")) == {"x": 1}
    assert len(f.payloads) == 2


def test_both_models_unreadable_gives_the_known_message(fake, caplog):
    fake([ok("not json"), ok("still not json")])
    with pytest.raises(HTTPException) as e:
        run(ai.ask_json("p", "u", kind="lesson"))
    assert e.value.detail == AI_BAD_REPLY_MESSAGE
    assert "finishReason=STOP" in caplog.text and "failed for lesson" in caplog.text


def test_other_callers_keep_working_without_new_options(fake):
    f = fake([ok('{"title": "x"}')])
    assert run(gemini.call_gemini(system_prompt="s", user_content="u", temperature=0.1, response_mime_type="application/json")) == {"title": "x"}
    cfg = f.payloads[0]["generationConfig"]
    assert "thinkingConfig" not in cfg and "responseJsonSchema" not in cfg


def test_schemas_are_plain_json():
    for name in ("LESSON", "QUESTIONS", "TEACH", "GRADE", "ASK", "STRUCTURE", "VISION"):
        assert json.loads(json.dumps(getattr(schemas, name)))["type"] == "object"
