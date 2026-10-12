"""Account deletion, agent memory and reply feedback."""

import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from agent.tools_executor import execute_tool
from auth.dependencies import get_current_user
from services import account, memory
from services.community import upsert_review

UID, OTHER = "stu-del", "someone-else"


@pytest.fixture
def client(fake_db, monkeypatch):
    import routers.account as acc_router
    monkeypatch.setattr(acc_router, "get_db", lambda: fake_db)
    monkeypatch.setattr(account, "get_db", lambda: fake_db)
    main.app.dependency_overrides[get_current_user] = lambda: UID
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.clear()


# ── Memory ──
def test_memory_remember_dedupe_and_cap(fake_db):
    r = memory.remember(fake_db, UID, "  يعمل دواماً جزئياً   مساءً ")
    assert r["success"] and r["saved"]["text"] == "يعمل دواماً جزئياً مساءً"
    assert memory.remember(fake_db, UID, "يعمل دواماً جزئياً مساءً")["message"] == "محفوظة مسبقاً."
    for i in range(30):
        memory.remember(fake_db, UID, f"هدف رقم {i}")
    items = memory.load_items(fake_db, UID)
    assert len(items) == memory.MAX_ITEMS and items[-1]["text"] == "هدف رقم 29"


@pytest.mark.parametrize("text", ["عنده اكتئاب ويتعالج", "راتبه 5000", "رقم الهوية 1234567890"])
def test_memory_refuses_sensitive_data(fake_db, text):
    r = memory.remember(fake_db, UID, text)
    assert r["success"] is False and memory.load_items(fake_db, UID) == []


def test_memory_tools_and_prompt_block(fake_db):
    asyncio.run(execute_tool("remember_fact", {"text": "يذاكر بالليل"}, UID, fake_db))
    asyncio.run(execute_tool("remember_fact", {"text": "هدفه معدل 3.5"}, UID, fake_db))
    block = memory.prompt_block(memory.load_items(fake_db, UID))
    assert "يذاكر بالليل" in block and "هدفه معدل 3.5" in block
    out = asyncio.run(execute_tool("forget_fact", {"text": "بالليل"}, UID, fake_db))
    assert out["removed"] == 1
    assert [i["text"] for i in memory.load_items(fake_db, UID)] == ["هدفه معدل 3.5"]
    assert memory.prompt_block([]) == ""


def test_memory_endpoints(client, fake_db):
    memory.remember(fake_db, UID, "يسكن في العوالي")
    items = client.get("/api/memory").json()["items"]
    assert len(items) == 1
    assert client.delete(f"/api/memory/{items[0]['id']}").json()["removed"] == 1
    memory.remember(fake_db, UID, "أ ب ج")
    assert client.delete("/api/memory").json()["items"] == 0


# ── Feedback ──
def test_feedback_save_toggle_and_validation(client, fake_db):
    body = {"rating": "down", "question": "كم الغياب؟", "answer": "15%", "conversationId": "c1", "tools": ["search_regulations"]}
    r = client.post("/api/feedback", json=body).json()
    doc = fake_db.store[("feedback", r["id"])]
    assert doc["uid"] == UID and doc["rating"] == "down" and doc["tools"] == ["search_regulations"]
    client.post("/api/feedback", json={**body, "rating": "up"})
    assert fake_db.store[("feedback", r["id"])]["rating"] == "up"  # same reply → same doc
    client.post("/api/feedback", json={**body, "rating": None})
    assert ("feedback", r["id"]) not in fake_db.store
    assert client.post("/api/feedback", json={**body, "rating": "meh"}).status_code == 422


# ── Account deletion ──
def test_delete_account_full_flow(fake_db, seed, monkeypatch):
    monkeypatch.setattr(account, "get_db", lambda: fake_db)
    monkeypatch.setattr("services.community.get_db", lambda: fake_db)
    seed.courses(fake_db, UID, ["CS4510"])
    seed.courses(fake_db, OTHER, ["CS4510"])
    review = {"difficulty": 4, "workload": 3, "usefulness": 5, "recommend": True, "comment": "ممتازة"}
    upsert_review(UID, "CS4510", review)
    upsert_review(OTHER, "CS4510", review)
    fake_db.store[("users", UID, "chats", "t1")] = {"title": "x"}
    fake_db.store[("users", UID, "academic_record", "attendance")] = {"courses": {}}
    fake_db.store[("ai_usage", UID)] = {"used": 3}
    fake_db.store[("feedback", "f1")] = {"uid": UID}
    fake_db.store[("feedback", "f2")] = {"uid": OTHER}
    deleted = []

    out = account.delete_account(UID, delete_auth_user=deleted.append)

    assert out["reviews_deleted"] == 1 and out["feedback_deleted"] == 1
    assert deleted == [UID]
    assert not any(p[:2] == ("users", UID) for p in fake_db.store)
    assert ("ai_usage", UID) not in fake_db.store
    assert ("feedback", "f2") in fake_db.store
    assert any(p[:2] == ("users", OTHER) for p in fake_db.store)
    assert fake_db.store[("course_reviews", "CS4510")]["count"] == 1


def test_delete_endpoint_requires_explicit_confirmation(client, monkeypatch):
    calls = []
    monkeypatch.setattr("routers.account.delete_account", lambda uid: calls.append(uid) or {"success": True})
    assert client.request("DELETE", "/api/account", json={}).status_code == 422
    assert client.request("DELETE", "/api/account", json={"confirm": "yes"}).status_code == 422
    assert client.request("DELETE", "/api/account", json={"confirm": "حذف"}).json() == {"success": True}
    assert calls == [UID]


def test_summarize_feedback_counts_and_orders():
    from services.feedback import summarize_feedback

    rows = [
        {"rating": "up", "tools": ["get_gpa"], "createdAt": "2026-10-01"},
        {"rating": "down", "tools": ["search_regulations"], "createdAt": "2026-10-02", "question": "q1", "comment": "خطأ"},
        {"rating": "down", "tools": [], "createdAt": "2026-10-05", "question": "q2"},
        {"rating": "up", "createdAt": "2026-10-03"},
    ]
    rep = summarize_feedback(rows, limit=5)
    assert (rep["total"], rep["up"], rep["down"], rep["satisfaction"]) == (4, 2, 2, 50)
    assert [r["question"] for r in rep["recent_down"]] == ["q2", "q1"]
    assert rep["by_tool"]["(بدون أداة)"] == {"up": 1, "down": 1}
    assert "uid" not in rep["recent_down"][0]
    assert summarize_feedback([])["satisfaction"] is None
