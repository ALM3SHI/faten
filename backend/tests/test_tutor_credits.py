"""Credits are refunded — once — whenever a study step or upload gives the student nothing."""

import httpx
import pytest
from fastapi import HTTPException

from common.errors import AI_BAD_REPLY_MESSAGE
from pdf_factory import make_pdf
from services import quota
from services.tutor.ai import ask_json as REAL_ASK_JSON
from test_tutor_flow import LECTURE, UID, Session, api, credits, upload  # noqa: F401


def lesson_fails(fake, monkeypatch, exc):
    real = fake.__call__

    async def flaky(prompt, user, **kw):
        if "Teach ONE topic" in prompt:
            raise exc
        return await real(prompt, user, **kw)

    monkeypatch.setattr("services.tutor.ai.ask_json", flaky)
    return real


def test_failed_lesson_is_refunded_every_time_and_progress_untouched(api, monkeypatch):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    assert credits(db) == 5
    lesson_fails(fake, monkeypatch, HTTPException(status_code=502, detail=AI_BAD_REPLY_MESSAGE))
    for _ in range(3):
        r = http.post(f"/api/tutor/lectures/{s.lid}/step", json={"action": "next", "payload": {}, "version": s.state["version"]})
        assert r.status_code == 502 and r.json()["detail"] == AI_BAD_REPLY_MESSAGE
        assert credits(db) == 5  # charged 2, refunded 2
    usage = db.store[("ai_usage", UID)]
    assert usage["refunded"] == 6
    assert http.get(f"/api/tutor/lectures/{s.lid}").json()["state"]["version"] == s.state["version"]
    # and when Gemini recovers, the same step works and is charged once
    monkeypatch.setattr("services.tutor.ai.ask_json", fake)
    s.step("next")
    assert credits(db) == 7 and s.state["stage"] == "check"


def test_timeout_is_refunded_with_a_clear_message(api, monkeypatch):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    # the real ask_json → call_gemini path, with Gemini never answering
    monkeypatch.setattr("services.tutor.ai.ask_json", REAL_ASK_JSON)

    async def never(self, url, **kw):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx.AsyncClient, "post", never)
    r = http.post(f"/api/tutor/lectures/{s.lid}/step", json={"action": "next", "payload": {}, "version": s.state["version"]})
    assert r.status_code == 504 and "تأخرت" in r.json()["detail"]
    assert credits(db) == 5


def test_conflict_after_the_model_answered_is_refunded(api, monkeypatch):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    from services.tutor import store

    real_commit = store.commit

    def racing_commit(*a, **kw):
        raise store.Conflict()

    monkeypatch.setattr(store, "commit", racing_commit)
    r = http.post(f"/api/tutor/lectures/{s.lid}/step", json={"action": "next", "payload": {}, "version": s.state["version"]})
    assert r.status_code == 409 and credits(db) == 5
    monkeypatch.setattr(store, "commit", real_commit)
    s.step("next")  # lesson was cached by the failed attempt: no new charge
    assert credits(db) == 5 and fake.calls["lesson"] == 1


def test_failed_upload_is_refunded(api):
    http, db, fake, _ = api
    fake.vision_readable = False
    r = upload(http, make_pdf([{"image": True}]))
    assert r.status_code == 400 and credits(db) == 0
    assert db.store[("ai_usage", UID)]["refunded"] == 5


def test_no_refund_into_the_next_day_and_never_below_zero(fake_db):
    fake_db.store[("ai_usage", "u1")] = {"date": "2026-10-15", "used": 3}
    assert quota.refund_ai_credits("u1", 2, "2026-10-14") is False  # charged yesterday
    assert fake_db.store[("ai_usage", "u1")]["used"] == 3
    assert quota.refund_ai_credits("u1", 9, "2026-10-15") is True
    assert fake_db.store[("ai_usage", "u1")]["used"] == 0
    assert fake_db.store[("ai_usage", "u1")]["refunded"] == 3
    assert quota.refund_ai_credits("u1", 2, None) is False  # quota disabled → nothing was charged


def test_ledger_refunds_each_charge_once(fake_db, settings):
    settings.DAILY_AI_CREDITS = 60
    ledger = quota.CreditLedger("u2")
    ledger.charge(2)
    ledger.charge(1)
    assert fake_db.store[("ai_usage", "u2")]["used"] == 3
    assert ledger.refund_all() == 3
    assert ledger.refund_all() == 0  # second call is a no-op
    assert fake_db.store[("ai_usage", "u2")]["used"] == 0


def test_quota_hit_midway_refunds_what_was_already_charged(fake_db, settings):
    settings.DAILY_AI_CREDITS = 3
    ledger = quota.CreditLedger("u3")
    ledger.charge(2)
    with pytest.raises(HTTPException) as e:
        ledger.charge(2)
    assert e.value.status_code == 429
    ledger.refund_all()
    assert fake_db.store[("ai_usage", "u3")]["used"] == 0
