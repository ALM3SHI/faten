"""A model that answers "busy" is skipped for a while by every tool
(services/model_health.py), and the schedule reader falls back too."""

import asyncio

import httpx
import pytest

from services import gemini, model_health
from services.schedule_vision import analyze_schedule_vision as read_schedule


def busy():
    return httpx.Response(503, json={"error": {"code": 503, "status": "UNAVAILABLE", "message": "high demand"}})


def ok(text):
    return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}]})


@pytest.fixture
def replies(monkeypatch, settings):
    seen: list[str] = []
    queue: list[httpx.Response] = []

    async def post(self, url, **kw):
        seen.append(url.split("/models/")[1].split(":")[0])
        r = queue.pop(0)
        r.request = httpx.Request("POST", url)
        return r

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return queue, seen, settings


def test_prefer_skips_a_busy_model_only_while_it_is_busy(monkeypatch):
    assert model_health.prefer("main", "fast") == "main"
    model_health.mark_busy("main", seconds=60)
    assert model_health.prefer("main", "fast") == "fast"
    model_health.mark_busy("fast", seconds=60)
    assert model_health.prefer("main", "fast") == "main"  # both busy: no point switching
    model_health.reset()
    model_health.mark_busy("main", seconds=-1)  # expired
    assert model_health.prefer("main", "fast") == "main"


def test_any_tool_stops_waiting_on_a_busy_model(replies):
    queue, seen, s = replies
    queue += [busy()]
    with pytest.raises(Exception):
        asyncio.run(gemini.call_gemini("sys", "u", 0.1, response_mime_type="application/json"))
    assert model_health.is_busy(s.GEMINI_MODEL)
    # the next request — from any tool — goes straight to the fast model
    queue += [ok('{"ok": true}')]
    assert asyncio.run(gemini.call_gemini("sys", "u", 0.1, response_mime_type="application/json")) == {"ok": True}
    assert seen == [s.GEMINI_MODEL, s.GEMINI_FAST_MODEL]


def test_chat_fallback_text_also_avoids_a_busy_model(replies):
    queue, seen, s = replies
    model_health.mark_busy(s.GEMINI_MODEL)
    queue += [ok("مرحبا")]
    assert asyncio.run(gemini.call_gemini_chat_text([{"role": "user", "content": "hi"}], "sys")) == "مرحبا"
    assert seen == [s.GEMINI_FAST_MODEL]


def test_schedule_reader_tries_the_fast_model_when_the_main_one_is_busy(replies):
    from pdf_factory import make_pdf

    queue, seen, s = replies
    queue += [busy(), ok('{"courses": []}')]
    try:
        asyncio.run(read_schedule(make_pdf([["Schedule", "nothing here"]])))
    except Exception:
        pass  # an empty schedule may be rejected later; what matters is who was asked
    assert seen == [s.GEMINI_MODEL, s.GEMINI_FAST_MODEL]
