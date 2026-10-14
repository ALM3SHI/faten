"""The shared AI budget: queue briefly, then answer "busy" — never hammer Google."""

import asyncio

import httpx
import pytest

from common.errors import AI_BUSY_DAY_MESSAGE, AI_BUSY_MESSAGE
from services import gemini
from services.ai_gate import AIBusyError, gate


def run(coro):
    return asyncio.run(coro)


def test_per_minute_limit_turns_extra_calls_away(settings):
    settings.AI_MAX_PER_MINUTE = 2
    settings.AI_QUEUE_WAIT_SECONDS = 0.05

    async def scenario():
        await gate.acquire(); await gate.release()
        await gate.acquire(); await gate.release()
        with pytest.raises(AIBusyError) as e:
            await gate.acquire()
        return e.value

    err = run(scenario())
    assert err.detail == AI_BUSY_MESSAGE and err.status_code == 429
    assert err.upstream_status is None  # not a retryable provider failure
    assert gate.snapshot()["rejected"] == 1


def test_concurrent_calls_wait_their_turn(settings):
    settings.AI_MAX_CONCURRENT = 1
    settings.AI_QUEUE_WAIT_SECONDS = 2
    order = []

    async def call(name, hold):
        async with gate.slot():
            order.append(f"{name}+")
            await asyncio.sleep(hold)
            order.append(f"{name}-")

    async def scenario():
        await asyncio.gather(call("a", 0.1), call("b", 0))

    run(scenario())
    assert order == ["a+", "a-", "b+", "b-"]


def test_a_full_queue_gives_up_after_the_wait(settings):
    settings.AI_MAX_CONCURRENT = 1
    settings.AI_QUEUE_WAIT_SECONDS = 0.05

    async def scenario():
        async with gate.slot():
            with pytest.raises(AIBusyError):
                await gate.acquire()
        await gate.acquire()  # free again once the first call ends
        await gate.release()

    run(scenario())


def test_daily_budget(settings):
    settings.AI_MAX_PER_DAY = 1

    async def scenario():
        async with gate.slot():
            pass
        with pytest.raises(AIBusyError) as e:
            await gate.acquire()
        return e.value

    assert run(scenario()).detail == AI_BUSY_DAY_MESSAGE


def test_gemini_is_not_called_when_busy(settings, monkeypatch):
    settings.AI_MAX_PER_MINUTE = 1
    settings.AI_QUEUE_WAIT_SECONDS = 0.05
    calls = []

    async def fake_post(self, url, **kw):
        calls.append(url)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    async def scenario():
        assert await gemini.call_gemini("s", "u", 0.2) == {"ok": True}
        with pytest.raises(AIBusyError):
            await gemini.call_gemini("s", "u", 0.2)
        # the chat fallback never raises — it just reports no answer
        assert await gemini.call_gemini_chat_text([{"role": "user", "content": "hi"}], "s") is None

    run(scenario())
    assert len(calls) == 1


def test_tutor_does_not_retry_a_busy_gate(settings, monkeypatch):
    from services.tutor import ai

    settings.AI_MAX_PER_MINUTE = 1
    settings.AI_QUEUE_WAIT_SECONDS = 0.05
    calls = []

    async def fake_post(self, url, **kw):
        calls.append(url)
        return httpx.Response(429, json={"error": {"message": "quota"}}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    async def scenario():
        with pytest.raises(Exception):
            await ai.ask_json("p", "u", kind="t")

    run(scenario())
    # one real (refused) call, then the busy gate — no retry storm
    assert len(calls) == 1
