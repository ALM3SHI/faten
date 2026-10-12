"""When the main model is overloaded, the agent answers from the fast model."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import APIStatusError

from agent import loop
from config import get_settings


def _overloaded():
    req = httpx.Request("POST", "https://example.test/v1/chat/completions")
    resp = httpx.Response(503, request=req, json={"error": {"message": "The model is overloaded."}})
    return APIStatusError("The model is overloaded.", response=resp, body=None)


def _completion(text):
    msg = SimpleNamespace(content=text, tool_calls=None, role="assistant")
    return SimpleNamespace(
        choices=[SimpleNamespace(message=msg, finish_reason="stop")],
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
    )


class FakeClient:
    def __init__(self, fail_models):
        self.fail_models = set(fail_models)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kw):
        self.calls.append(kw["model"])
        if kw["model"] in self.fail_models:
            raise _overloaded()
        return _completion(f"answer from {kw['model']}")


def _run(client):
    msgs = [{"role": "system", "content": "sys"}, {"role": "user", "content": "حلل سجلي"}]
    return asyncio.run(loop.run_agent_loop(msgs, "u1", db=None, client=client, with_tools_enabled=False))


def test_overloaded_main_model_falls_back_to_fast_model():
    s = get_settings()
    client = FakeClient(fail_models=[s.llm_model])
    out = _run(client)
    assert client.calls == [s.llm_model, s.llm_fast_model]
    assert out["content"] == f"answer from {s.llm_fast_model}"


def test_healthy_main_model_is_used_directly():
    s = get_settings()
    client = FakeClient(fail_models=[])
    out = _run(client)
    assert client.calls == [s.llm_model]
    assert s.llm_model in out["content"]


def test_both_models_down_still_raises():
    s = get_settings()
    client = FakeClient(fail_models=[s.llm_model, s.llm_fast_model])

    async def no_fallback(*a, **k):
        return None

    loop._gemini_fallback, orig = no_fallback, loop._gemini_fallback
    try:
        with pytest.raises(APIStatusError):
            _run(client)
    finally:
        loop._gemini_fallback = orig
