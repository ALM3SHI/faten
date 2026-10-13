"""Push notifications: reminder texts, device registry, delivery and the cron jobs."""

import asyncio
import datetime as dt
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from auth.dependencies import get_current_user
from services import exams as ex
from services import push
from services import student_tools as st
from tasks import cron

UID = "stu1"
TOKEN = "fcm-token-" + "x" * 40
RIYADH = dt.timezone(dt.timedelta(hours=3))


class FakeMessaging:
    """Records what would be sent; tokens in `dead` fail as unregistered."""

    def __init__(self):
        self.sent = []
        self.dead = set()

    def __call__(self, messages):
        responses = []
        for m in messages:
            if m.token in self.dead:
                err = type("UnregisteredError", (Exception,), {})()
                responses.append(SimpleNamespace(success=False, exception=err))
            else:
                self.sent.append(m)
                responses.append(SimpleNamespace(success=True, exception=None))
        return SimpleNamespace(responses=responses)


@pytest.fixture
def fcm(monkeypatch):
    f = FakeMessaging()
    monkeypatch.setattr(push, "_send_each", f)
    return f


@pytest.fixture
def db(fake_db):
    fake_db.store[("users", UID)] = {"uid": UID}
    return fake_db


# ── texts ────────────────────────────────────────────────────────
def _exam(i, date, **kw):
    return ex.normalize_exam(i, {"subject": "تعلم الآلة", "date": date, **kw})


def test_exam_reminders_on_the_right_days():
    today = dt.date(2026, 12, 20)
    exams = [_exam("a", "2026-12-23", time="09:00", location="قاعة 105"), _exam("b", "2026-12-25"), _exam("c", "2026-12-20")]
    items = {i["key"].split(":")[1]: i for i in push.exam_reminders(exams, today)}
    assert set(items) == {"a", "c"}  # 3 days and today; 5 days is skipped
    assert items["a"]["title"] == "⏰ اختبارك في تعلم الآلة بعد 3 أيام"
    assert "الساعة 09:00" in items["a"]["body"] and "قاعة 105" in items["a"]["body"]
    assert items["c"]["title"].startswith("📝 اليوم اختبار")


def test_attendance_reminders_count_in_arabic():
    rows = [
        {"code": "CS1", "name": "الشبكات", "level": "warning", "remaining_unexcused": 2, "total_lectures": 30},
        {"code": "CS2", "name": "الذكاء", "level": "danger", "remaining_unexcused": 0, "total_lectures": 30},
        {"code": "CS3", "name": "آمن", "level": "safe", "remaining_unexcused": 4, "total_lectures": 30},
    ]
    items = push.attendance_reminders(rows, dt.date(2026, 10, 12))
    assert [i["title"] for i in items] == ["⚠️ باقي لك غيابين في الشبكات", "⚠️ وصلت آخر حد للغياب في الذكاء"]


def test_lecture_reminder_one_hour_before(monkeypatch):
    monkeypatch.setattr(st, "current_term", lambda d=None: object())
    monkeypatch.setattr(st, "any_holiday", lambda d: None)
    slots = [
        {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الإثنين", "start_time": "10:00", "room": "105", "building": "العابدية"},
        {"course_code": "CS4520", "course_name": "الشبكات", "day": "الإثنين", "start_time": "13:00"},
        {"course_code": "CS9", "course_name": "غداً", "day": "الثلاثاء", "start_time": "10:00"},
    ]
    now = dt.datetime(2026, 10, 12, 9, 0, tzinfo=RIYADH)  # Monday
    items = push.lecture_reminders(slots, now)
    assert len(items) == 1
    assert items[0]["title"] == "🔔 محاضرة تعلم الآلة بعد ساعة"
    assert items[0]["body"] == "تبدأ الساعة 10:00 في العابدية / 105."
    monkeypatch.setattr(st, "any_holiday", lambda d: "إجازة")
    assert push.lecture_reminders(slots, now) == []


# ── delivery ─────────────────────────────────────────────────────
def test_send_dedupes_and_forgets_dead_tokens(db, fcm):
    push.register_device(db, UID, TOKEN)
    dead = "dead-token-" + "y" * 40
    push.register_device(db, UID, dead)
    fcm.dead.add(dead)
    item = {"key": "exam:a:2026-12-23:3", "title": "t", "body": "b", "url": "/exams"}
    assert push.send_to_user(db, UID, [item]) == 1
    assert [m.token for m in fcm.sent] == [TOKEN]
    assert [t for _, t in push.device_tokens(db, UID)] == [TOKEN]
    assert fcm.sent[0].data == {"title": "t", "body": "b", "url": "/exams", "tag": "exam:a:2026-12-23:3"}
    assert push.send_to_user(db, UID, [item]) == 0  # already sent once
    assert len(fcm.sent) == 1


def test_prefs_default_on_and_can_be_switched_off(db):
    assert push.load_prefs(db, UID) == {"lectures": True, "attendance": True, "exams": True}
    push.save_prefs(db, UID, {"exams": False})
    assert push.load_prefs(db, UID)["exams"] is False


def test_daily_job_sends_exam_reminder(db, fcm, monkeypatch):
    monkeypatch.setattr(ex, "today_riyadh", lambda: dt.date(2026, 12, 20))
    push.register_device(db, UID, TOKEN)
    db.store[("users", UID, "exams", "e1")] = {"subject": "أمن الشبكات", "date": "2026-12-21", "done": False}
    monkeypatch.setattr(cron, "datetime", SimpleNamespace(now=lambda tz=None: dt.datetime(2026, 12, 20, 8, tzinfo=RIYADH)))
    assert asyncio.run(cron.push_daily_reminders(db)) == 1
    assert fcm.sent[0].data["title"] == "⏰ اختبارك في أمن الشبكات غداً"


def test_lecture_job(db, fcm, monkeypatch):
    monkeypatch.setattr(st, "current_term", lambda d=None: object())
    monkeypatch.setattr(st, "any_holiday", lambda d: None)
    push.register_device(db, UID, TOKEN)
    db.store[("users", UID, "academic_record", "schedule")] = {
        "schedule": [{"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الإثنين", "start_time": "10:00"}]
    }
    now = dt.datetime(2026, 10, 12, 9, 0, tzinfo=RIYADH)
    assert asyncio.run(cron.lecture_reminders_cron(db, now)) == 1
    push.save_prefs(db, UID, {"lectures": False})
    db.store.pop(next(k for k in db.store if k[:3] == ("users", UID, "push_log")))
    assert asyncio.run(cron.lecture_reminders_cron(db, now)) == 0


# ── API ──────────────────────────────────────────────────────────
@pytest.fixture
def client(db, monkeypatch):
    from routers import notifications

    monkeypatch.setattr(notifications, "get_db", lambda: db)
    main.app.dependency_overrides[get_current_user] = lambda: UID
    yield TestClient(main.app)
    main.app.dependency_overrides.pop(get_current_user, None)


def test_device_and_prefs_endpoints(client, db, fcm):
    r = client.post("/api/notifications/devices", json={"token": TOKEN})
    assert r.status_code == 200
    did = r.json()["id"]
    assert client.post("/api/notifications/test").json()["sent"] == 1
    assert client.put("/api/notifications/prefs", json={"lectures": False, "attendance": True, "exams": True}).json()["prefs"]["lectures"] is False
    assert client.get("/api/notifications/prefs").json()["prefs"]["lectures"] is False
    assert client.delete(f"/api/notifications/devices/{did}").status_code == 200
    r = client.post("/api/notifications/test")
    assert r.status_code == 409 and "فعّل الإشعارات" in r.json()["detail"]
    assert client.post("/api/notifications/devices", json={"token": "short"}).status_code == 422
