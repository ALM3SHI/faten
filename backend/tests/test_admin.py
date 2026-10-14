"""Admin dashboard: who may open it, the numbers it shows, review moderation."""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

import main
from auth import admin as admin_auth
from services import admin

TODAY = dt.date(2026, 10, 13)
RID = "a" * 20


@pytest.fixture
def admins(settings):
    settings.ADMIN_EMAILS = " Boss@Example.com , second@example.com"
    return settings


def test_only_verified_listed_emails_are_admins(admins):
    assert admin_auth.is_admin_claims({"email": "boss@example.com", "email_verified": True})
    assert admin_auth.is_admin_claims({"email": "SECOND@example.com", "email_verified": True})
    assert not admin_auth.is_admin_claims({"email": "boss@example.com", "email_verified": False})
    assert not admin_auth.is_admin_claims({"email": "student@example.com", "email_verified": True})
    assert not admin_auth.is_admin_claims({"email_verified": True})


def test_nobody_is_admin_when_the_setting_is_empty(settings):
    settings.ADMIN_EMAILS = ""
    assert not admin_auth.is_admin_claims({"email": "boss@example.com", "email_verified": True})


def test_endpoint_checks_the_token(admins, monkeypatch):
    client = TestClient(main.app)
    monkeypatch.setattr(admin_auth.auth, "verify_id_token", lambda t: {"uid": "s1", "email": "student@example.com", "email_verified": True})
    r = client.get("/api/admin/me", headers={"Authorization": "Bearer x"})
    assert r.status_code == 403 and r.json()["detail"] == admin_auth.NOT_ADMIN
    monkeypatch.setattr(admin_auth.auth, "verify_id_token", lambda t: {"uid": "a1", "email": "boss@example.com", "email_verified": True})
    assert client.get("/api/admin/me", headers={"Authorization": "Bearer x"}).json() == {"admin": True}
    assert client.get("/api/admin/me").status_code == 401


def _seed(db):
    s = db.store
    s[("users", "u1")] = {"createdAt": "2026-10-12T09:00:00.000Z"}
    s[("users", "u2")] = {"createdAt": "2026-09-20T09:00:00.000Z"}
    s[("users", "u3")] = {"createdAt": "2025-01-01T09:00:00.000Z"}
    s[("users", "u1", "devices", "d1")] = {"token": "t"}
    s[("ai_usage", "u1")] = {"date": "2026-10-13", "used": 7}
    s[("ai_usage", "u2")] = {"date": "2026-10-09", "used": 3}
    s[("ai_usage", "u3")] = {"date": "2026-09-01", "used": 9}
    s[("feedback", "f1")] = {"rating": "up", "createdAt": "2026-10-10T10:00:00+00:00", "tools": ["search_regulations"]}
    s[("feedback", "f2")] = {"rating": "down", "createdAt": "2026-10-11T10:00:00+00:00", "question": "q", "answer": "a", "comment": "غلط", "tools": ["search_regulations"], "uid": "u1"}
    s[("feedback", "f3")] = {"rating": "down", "createdAt": "2026-08-01T10:00:00+00:00"}
    s[("course_reviews", "CS1101")] = {"name": "مقدمة في البرمجة", "count": 2}
    s[("course_reviews", "CS1101", "reviews", RID)] = {"tip": "نصيحة", "reports": ["x", "y", "z"], "hidden": True, "updatedAt": "2026-10-01", "uid": "u2"}
    s[("course_reviews", "CS1101", "reviews", "b" * 20)] = {"tip": "عادي", "reports": [], "hidden": False}


def test_overview_numbers_and_no_personal_data(fake_db):
    _seed(fake_db)
    out = admin.overview(fake_db, TODAY)
    assert out["users"] == {"total": 3, "new_7d": 1, "new_30d": 2}
    assert out["usage"] == {"active_today": 1, "active_7d": 2, "requests_today": 7, "refunded_today": 0}
    assert out["devices"] == 1
    fb = out["feedback"]
    assert (fb["up"], fb["down"], fb["satisfaction"]) == (1, 1, 50)
    assert fb["recent_down"][0]["comment"] == "غلط"
    assert out["reported_reviews"] == [{"code": "CS1101", "course": "مقدمة في البرمجة", "id": RID, "tip": "نصيحة", "reports": 3, "hidden": True, "updatedAt": "2026-10-01"}]
    flat = repr(out)
    assert "u1" not in flat and "u2" not in flat


def test_restore_and_hide_a_review(fake_db, admins, monkeypatch):
    _seed(fake_db)
    monkeypatch.setattr(admin_auth.auth, "verify_id_token", lambda t: {"uid": "a1", "email": "boss@example.com", "email_verified": True})
    client = TestClient(main.app)
    h = {"Authorization": "Bearer x"}
    assert client.post(f"/api/admin/reviews/CS1101/{RID}/restore", headers=h).json() == {"success": True}
    rev = fake_db.store[("course_reviews", "CS1101", "reviews", RID)]
    assert rev["hidden"] is False and rev["reports"] == []
    client.post(f"/api/admin/reviews/cs1101/{RID}/hide", headers=h)
    assert fake_db.store[("course_reviews", "CS1101", "reviews", RID)]["hidden"] is True
    assert client.post(f"/api/admin/reviews/CS1101/{RID}/delete", headers=h).status_code == 400
    assert client.post(f"/api/admin/reviews/CS1101/{'c' * 20}/hide", headers=h).status_code == 404
