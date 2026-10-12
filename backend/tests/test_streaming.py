"""Streaming: chunk reassembly, Gemini thought signatures, agent loop and SSE endpoint."""

import asyncio
import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient
from openai.types.chat import ChatCompletionChunk

import main
from agent import loop
from agent.streaming import ToolCallAccumulator, collect_stream
from auth.dependencies import get_current_user
from services import student_tools as st

SIG = "CiQB0e2Kb_thought_signature_bytes=="


def chunk(delta=None, finish=None, idx=0):
    return ChatCompletionChunk.model_validate({
        "id": "c1", "object": "chat.completion.chunk", "created": 0, "model": "gemini",
        "choices": [{"index": idx, "delta": delta or {}, "finish_reason": finish}],
    })


class AsyncIter:
    def __init__(self, items):
        self.items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.items:
            raise StopAsyncIteration
        await asyncio.sleep(0)
        return self.items.pop(0)


TOOL_CHUNKS = [
    chunk({"role": "assistant", "tool_calls": [{
        "index": 0, "id": "call_a", "type": "function",
        "function": {"name": "get_day_schedule", "arguments": '{"day": '},
        "extra_content": {"google": {"thought_signature": SIG}},
    }]}),
    chunk({"tool_calls": [{"index": 0, "function": {"arguments": '"tomorrow"}'}}]}),
    chunk({}, finish="stop"),  # Gemini reports "stop" even for tool calls
]
TEXT_CHUNKS = [chunk({"content": "بكرة "}), chunk({"content": "عندك "}), chunk({"content": "محاضرة."}), chunk({}, finish="stop")]


def test_accumulator_merges_arguments_and_keeps_signature():
    acc = ToolCallAccumulator()
    for c in TOOL_CHUNKS:
        if c.choices[0].delta.tool_calls:
            acc.add(c.choices[0].delta.tool_calls)
    [tc] = acc.result()
    assert tc.id == "call_a" and tc.function.name == "get_day_schedule"
    assert json.loads(tc.function.arguments) == {"day": "tomorrow"}
    dumped = tc.model_dump(exclude_none=True)
    assert dumped["extra_content"]["google"]["thought_signature"] == SIG
    assert dumped["function"] == {"name": "get_day_schedule", "arguments": '{"day": "tomorrow"}'}


def test_collect_stream_forwards_tokens_and_fixes_finish_reason():
    got = []

    async def on_token(t):
        got.append(t)

    text = asyncio.run(collect_stream(AsyncIter(TEXT_CHUNKS), on_token))
    assert got == ["بكرة ", "عندك ", "محاضرة."]
    assert text.choices[0].message.content == "بكرة عندك محاضرة."
    tools = asyncio.run(collect_stream(AsyncIter(TOOL_CHUNKS), on_token))
    assert tools.choices[0].finish_reason == "tool_calls"


class StreamingModel:
    """stream=True → chunks; records every request so we can inspect echoes."""

    def __init__(self):
        self.requests = []
        self.chat = type("C", (), {"completions": type("X", (), {"create": self.create})()})()

    async def create(self, **kw):
        self.requests.append(kw)
        if kw.get("response_format"):  # intent classifier (non-streamed)
            from types import SimpleNamespace as NS
            msg = NS(content='{"intent": "GENERAL_QA"}', tool_calls=None, role="assistant")
            return NS(choices=[NS(message=msg, finish_reason="stop")], usage=None)
        assert kw.get("stream") is True
        has_tool_result = any(m.get("role") == "tool" for m in kw["messages"])
        return AsyncIter(TEXT_CHUNKS if has_tool_result else TOOL_CHUNKS)


@pytest.fixture
def schedule_db(fake_db, monkeypatch):
    monkeypatch.setattr(st, "today_riyadh", lambda: dt.date(2026, 10, 12))
    fake_db.store[("users", "u1", "academic_record", "schedule")] = {"schedule": [
        {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الثلاثاء", "start_time": "10:00", "end_time": "11:50"},
    ]}
    return fake_db


def test_agent_loop_streams_and_echoes_signature(schedule_db):
    model, tokens, statuses = StreamingModel(), [], []

    async def on_token(t):
        tokens.append(t)

    async def on_status(s):
        statuses.append(s)

    out = asyncio.run(loop.run_agent_loop(
        [{"role": "system", "content": "s"}, {"role": "user", "content": "وش عندي بكرة"}],
        "u1", schedule_db, client=model, on_token=on_token, on_status=on_status,
    ))
    assert out["content"] == "بكرة عندك محاضرة."
    assert "".join(tokens) == out["content"]
    assert statuses == ["get_day_schedule"]
    # The second request must echo the tool call with Gemini's signature intact.
    echoed = next(m for m in model.requests[1]["messages"] if m.get("tool_calls"))
    assert echoed["tool_calls"][0]["extra_content"]["google"]["thought_signature"] == SIG
    assert out["actions_log"][0]["tool"] == "get_day_schedule"


def test_sse_endpoint(schedule_db, monkeypatch):
    import routers.chat as chat_router
    monkeypatch.setattr(chat_router, "get_db", lambda: schedule_db)
    main.app.dependency_overrides[get_current_user] = lambda: "u1"
    main.app.state.openai_client = StreamingModel()
    try:
        with TestClient(main.app).stream(
            "POST", "/api/chat/stream",
            json={"messages": [{"role": "user", "content": "ممكن تقولي وش وراي من محاضرات بكرة لو سمحت"}]},
        ) as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            assert "gzip" not in r.headers.get("content-encoding", "")
            events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    finally:
        main.app.dependency_overrides.clear()
    kinds = [e["type"] for e in events]
    assert kinds[0] == "status" and kinds[-1] == "done"
    assert "".join(e["text"] for e in events if e["type"] == "token") == "بكرة عندك محاضرة."
    done = events[-1]["response"]
    assert done["message"] == "بكرة عندك محاضرة." and done["actions"][0]["tool"] == "get_day_schedule"


def test_sse_requires_auth():
    r = TestClient(main.app).post("/api/chat/stream", json={"messages": [{"role": "user", "content": "x"}]})
    assert r.status_code in (401, 403)
