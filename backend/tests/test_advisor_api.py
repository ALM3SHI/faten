"""Advisor HTTP API + chat tool, over the in-memory Firestore."""

from __future__ import annotations

import asyncio
import copy
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import advisor_fixtures as fx
import main
from agent.tools_executor import execute_tool
from auth.dependencies import get_current_user

UID, OTHER = "stu-a", "stu-b"


@pytest.fixture
def api(fake_db):
    state = {"uid": UID}
    main.app.dependency_overrides[get_current_user] = lambda: state["uid"]
    client = TestClient(main.app)
    client.state = state
    yield client, fake_db
    main.app.dependency_overrides.clear()


def seed_record(db, uid, rec):
    db.store[("users", uid, "academic_record", "main")] = copy.deepcopy(rec)


def test_requires_sign_in():
    r = TestClient(main.app).post("/api/advisor/analyze", json={})
    assert r.status_code == 401


def test_catalog_endpoints_expose_provenance(api):
    client, _ = api
    data = client.get("/api/advisor/catalog").json()
    cs = next(p for p in data["programs"] if p["id"] == "uqu-478")
    assert cs["curriculum"]["source_url"] == "https://uqu.edu.sa/App/Degrees/478"
    assert cs["curriculum"]["verification"] == "incomplete" and cs["curriculum"]["unlisted_hours"] == 11
    assert any(r["rule"] == "max_regular_load" and r["status"] == "unavailable" for r in data["rules"])
    detail = client.get("/api/advisor/catalog/uqu-478").json()
    assert detail["curriculum"]["courses"][0]["name"] and detail["curriculum"]["provenance"]["raw_sha256"]
    assert client.get("/api/advisor/catalog/nope").status_code == 404


def test_unknown_major_asks_the_student_to_choose(api):
    client, db = api
    seed_record(db, UID, fx.python_track_student())  # major=None
    r = client.post("/api/advisor/analyze", json={})
    assert r.status_code == 409
    assert {p["id"] for p in r.json()["detail"]["programs"]} >= {"uqu-478", "uqu-1490"}


def test_settings_are_validated(api):
    client, _ = api
    assert client.put("/api/advisor/settings", json={"max_load": 30}).status_code == 400
    assert client.put("/api/advisor/settings", json={"program_id": "mit-cs"}).status_code == 400
    assert client.put("/api/advisor/settings", json={"target_term": "next year"}).status_code == 400
    assert client.put("/api/advisor/settings", json={"program_grad_gpa": 5}).status_code == 400
    ok = client.put("/api/advisor/settings", json={"program_id": "uqu-478", "max_load": 15, "summer": True,
                                                   "unavailable": [{"code": "cs 2105", "term": "next"}]})
    assert ok.status_code == 200
    saved = client.get("/api/advisor/settings").json()
    assert saved["max_load"] == 15 and saved["unavailable"] == [{"code": "CS2105", "term": "next"}]


def test_analysis_never_touches_the_official_record_and_is_private(api):
    client, db = api
    rec = fx.failed_prerequisites()
    seed_record(db, UID, rec)
    before = copy.deepcopy(db.store[("users", UID, "academic_record", "main")])
    r = client.post("/api/advisor/analyze", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"] == {"id": "uqu-478", "name": "علوم الحاسب الآلي", "source": "record"}
    assert body["summary"]["what"] and body["run_id"]
    assert db.store[("users", UID, "academic_record", "main")] == before
    assert ("users", UID, "advisor_runs", body["run_id"]) in db.store
    assert client.get("/api/advisor/latest").json()["run"]["run_id"] == body["run_id"]

    client.state["uid"] = OTHER  # another student cannot read it
    assert client.get("/api/advisor/latest").json() == {"run": None}
    assert client.post("/api/advisor/ask", json={"run_id": body["run_id"], "question": "ليش؟"}).status_code == 404


def test_what_if_overrides_are_not_saved(api):
    client, db = api
    seed_record(db, UID, fx.high_performer())
    r = client.post("/api/advisor/analyze", json={"overrides": {"summer": True, "max_load": 21}}).json()
    assert r["scenarios"]["fastest"]["load_cap"] == 21
    assert ("users", UID, "advisor", "settings") not in db.store


def test_validate_schedule_endpoint(api):
    client, db = api
    seed_record(db, UID, fx.record([fx.course(c, h, "B", fx.T1) for c, h in fx.CS_L1]))
    out = client.post("/api/advisor/validate-schedule", json={"codes": ["CS1704", "CS2105"]}).json()
    assert out["valid"] is False and out["violations"]


def test_compare_majors_endpoint(api):
    client, db = api
    seed_record(db, UID, fx.python_track_student())
    out = client.post("/api/advisor/compare-majors", json={"interests": ["تعلم"]}).json()
    assert len(out["programs"]) == 7 and out["disclaimer"]
    assert client.post("/api/advisor/compare-majors", json={"program_ids": ["x"]}).status_code == 400


class _FakeLLM:
    def __init__(self, text):
        self.text = text
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kw):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.text))])

    async def close(self):
        pass


@pytest.mark.parametrize("answer,source,charged", [
    ({"answer": "ابدأ بإعادة CS1701 لأنه يفتح مقررات أخرى.", "points": [], "next_step": "راجع مرشدك."}, "llm_validated", 1),
    ({"answer": "سجّل CS9999 ونجاحك مضمون.", "points": [], "next_step": ""}, "deterministic", 0),
])
def test_ask_is_grounded_and_refunds_rejected_answers(api, monkeypatch, settings, answer, source, charged):
    client, db = api
    settings.DAILY_AI_CREDITS = 50
    seed_record(db, UID, fx.failed_prerequisites())
    run_id = client.post("/api/advisor/analyze", json={}).json()["run_id"]
    monkeypatch.setattr("agent.loop.get_openai_client", lambda: _FakeLLM(json.dumps(answer, ensure_ascii=False)))
    out = client.post("/api/advisor/ask", json={"run_id": run_id, "question": "ليش أعيد CS1701؟"}).json()
    assert out["source"] == source
    if source == "deterministic":
        assert out["problems"] and out["summary"]["what"]
    usage = db.store.get(("ai_usage", UID), {})
    assert usage.get("used") == charged  # a rejected answer gives the credit back


def test_instructor_reviews_are_verified_and_sparse_data_gives_no_pick(api, monkeypatch):
    client, db = api
    monkeypatch.setattr("services.community.get_db", lambda: db)
    empty = client.get("/api/advisor/instructors/CS2105").json()
    assert empty["verdict"] == "no_data"
    assert {p["name"]: p["available"] for p in empty["providers"]} == {"faten_verified_students": True, "qaym": False}
    assert empty["imported"]["profiles"] and empty["imported"]["source"]["kind"] == "team_compiled_student_reviews"
    assert all(p["name"] != "أحمد" for p in empty["instructors"])  # imported profiles never enter the verified numbers
    mp = client.get("/api/advisor/instructor-map", params={"program_id": "uqu-478"})
    assert mp.status_code == 200 and mp.json()["courses"]
    assert client.get("/api/advisor/instructor-map", params={"program_id": "nope"}).status_code == 404
    review = {"instructor": "د. أحمد", "clarity": 5, "organization": 4, "fairness": 5, "workload": 3, "recommend": True}
    assert client.put("/api/advisor/instructors/CS2105/review", json=review).status_code == 403  # not in record
    seed_record(db, UID, fx.record([fx.course("CS2105", 3, "B", fx.T1)]))
    assert client.put("/api/advisor/instructors/CS2105/review", json={**review, "clarity": 9}).status_code == 400
    out = client.put("/api/advisor/instructors/CS2105/review", json=review).json()
    assert out["verdict"] == "insufficient" and out["recommendation"] is None
    assert out["instructors"][0]["instructor"] == "أحمد" and out["instructors"][0]["reviews"] == 1
    stored = [v for k, v in db.store.items() if k[:3] == ("instructor_reviews", "CS2105", "reviews")]
    assert len(stored) == 1 and stored[0]["uid"] == UID


def test_chat_tool_reads_the_engine(fake_db):
    seed_record(fake_db, UID, fx.failed_prerequisites())
    out = asyncio.run(execute_tool("get_academic_plan", {}, UID, fake_db))
    assert out["success"] and out["courses"] and out["courses"][0]["code"]
    assert "ممكنة رياضياً" in out["note"]
    none = asyncio.run(execute_tool("get_academic_plan", {}, OTHER, fake_db))
    assert none["success"] is False and "/advisor" in none["message"]


def test_analysis_after_saving_settings(api):
    """Real UI flow: the student saves settings (always incl. program_id), then analyses.
    Regression: program_id was passed twice → TypeError → 500 without CORS headers."""
    client, db = api
    seed_record(db, UID, fx.failed_prerequisites())
    assert client.put("/api/advisor/settings", json={"program_id": "uqu-478", "priority": "protect_gpa", "max_load": 15,
                                                     "summer": True, "target_term": "1450-2", "program_grad_gpa": 2.0,
                                                     "weekly_work_hours": 10, "interests": ["الشبكات"],
                                                     "unavailable": [{"code": "CS1701", "term": "next"}]}).status_code == 200
    r = client.post("/api/advisor/analyze", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"]["source"] == "student" and body["scenarios"]["fastest"]["load_cap"] == 15
    assert "CS1701" not in {c["code"] for c in body["next_term"]["courses"]}
    # what-if overrides on top of saved settings take the same path
    r2 = client.post("/api/advisor/analyze", json={"overrides": {"program_id": "uqu-478", "max_load": 18}})
    assert r2.status_code == 200, r2.text
    assert client.get("/api/advisor/latest").json()["run"]["run_id"]


def test_saved_major_that_differs_from_the_record_is_flagged(api):
    """Real case: the record says Computer Science but settings were saved as AI.
    The analysis follows the settings (the student's choice) and says so plainly."""
    client, db = api
    rec = fx.failed_prerequisites()
    seed_record(db, UID, rec)
    detected = client.post("/api/advisor/analyze", json={}).json()
    rec_pid = detected["program"]["id"]
    assert detected["program"]["source"] == "record" and "program_conflict" not in detected
    other = "uqu-1490" if rec_pid != "uqu-1490" else "uqu-478"
    body = client.post("/api/advisor/analyze", json={"overrides": {"program_id": other}}).json()
    assert body["program"]["id"] == other
    assert body["program_conflict"]["record_program_id"] == rec_pid
    assert "بياناتك وأهدافك" in body["program_conflict"]["message"]
    same = client.post("/api/advisor/analyze", json={"overrides": {"program_id": rec_pid}}).json()
    assert "program_conflict" not in same
