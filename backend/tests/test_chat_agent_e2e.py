"""End-to-end through POST /api/chat with a fake model that uses a tool.

Proves the routing change: a GENERAL_QA question (which used to get *no*
tools) can now call get_day_schedule, and the tool result reaches the
reply and the response's action log.
"""

import datetime as dt
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from openai.types.chat import ChatCompletionMessageToolCall

import main
from auth.dependencies import get_current_user
from services import student_tools as st

UID = "stu-e2e"


class FakeModel:
    """First agent call → tool call; second → answer quoting the tool result."""

    def __init__(self):
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    async def create(self, **kw):
        self.requests.append(kw)
        if kw.get("response_format"):  # intent classifier
            return self._reply('{"intent": "GENERAL_QA"}')
        tool_msgs = [m for m in kw["messages"] if m.get("role") == "tool"]
        if not tool_msgs:
            tc = ChatCompletionMessageToolCall(
                id="call_1", type="function",
                function={"name": "get_day_schedule", "arguments": json.dumps({"day": "tomorrow"})},
            )
            msg = SimpleNamespace(content=None, tool_calls=[tc], role="assistant")
            return self._wrap(msg, "tool_calls")
        result = json.loads(tool_msgs[-1]["content"])
        lec = result["lectures"][0]
        return self._reply(f"بكرة {result['weekday']}: {lec['course']} الساعة {lec['start']}")

    def _reply(self, text):
        return self._wrap(SimpleNamespace(content=text, tool_calls=None, role="assistant"), "stop")

    @staticmethod
    def _wrap(msg, finish):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=msg, finish_reason=finish)],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )


@pytest.fixture
def client(fake_db, monkeypatch):
    import routers.chat as chat_router
    monkeypatch.setattr(chat_router, "get_db", lambda: fake_db)
    monkeypatch.setattr(st, "today_riyadh", lambda: dt.date(2026, 10, 12))  # Monday
    fake_db.store[("users", UID, "academic_record", "schedule")] = {"schedule": [
        {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الثلاثاء", "start_time": "10:00", "end_time": "11:50", "type": "نظري"},
    ]}
    model = FakeModel()
    main.app.dependency_overrides[get_current_user] = lambda: UID
    main.app.state.openai_client = model
    try:
        yield TestClient(main.app), model
    finally:
        main.app.dependency_overrides.clear()


def test_general_question_can_use_schedule_tool(client):
    http, model = client
    r = http.post("/api/chat", json={"messages": [{"role": "user", "content": "ممكن تقولي وش وراي من محاضرات بكرة لو سمحت"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["message"] == "بكرة الثلاثاء: تعلم الآلة الساعة 10:00"
    assert [a["tool"] for a in body["actions"]] == ["get_day_schedule"]
    agent_calls = [k for k in model.requests if not k.get("response_format")]
    offered = {t["function"]["name"] for t in agent_calls[0]["tools"]}
    assert "get_day_schedule" in offered and "create_study_plan" not in offered
