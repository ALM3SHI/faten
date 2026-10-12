"""Agent student tools: attendance status, recording absences, day schedule, prayer times."""

import asyncio
import datetime as dt
import json
from pathlib import Path

import pytest

from agent.tools_executor import execute_tool
from services import student_tools as st

UID = "stu1"
SLOTS = [
    {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الأحد", "start_time": "10:00", "end_time": "11:50", "type": "نظري", "room": "105", "building": "العابدية"},
    {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الثلاثاء", "start_time": "10:00", "end_time": "11:50", "type": "نظري"},
    {"course_code": "CS4520", "course_name": "أمن الشبكات", "day": "الإثنين", "start_time": "11:00", "end_time": "12:50", "type": "نظري"},
    {"course_code": "CS4999", "course_name": "مشروع التخرج", "day": "الخميس", "start_time": "14:00", "end_time": "16:00", "type": "نظري"},
]

# Reference values from the frontend's `adhan` library (Umm al-Qura, Makkah).
ADHAN_REF = {
    "2026-01-15": {"fajr": "05:41", "sunrise": "07:01", "dhuhr": "12:30", "asr": "15:38", "maghrib": "17:59", "isha": "19:29"},
    "2026-06-21": {"fajr": "04:11", "sunrise": "05:39", "dhuhr": "12:22", "asr": "15:42", "maghrib": "19:06", "isha": "20:36"},
    "2026-10-12": {"fajr": "04:59", "sunrise": "06:15", "dhuhr": "12:07", "asr": "15:28", "maghrib": "17:59", "isha": "19:29"},
    "2026-12-21": {"fajr": "05:32", "sunrise": "06:54", "dhuhr": "12:19", "asr": "15:23", "maghrib": "17:44", "isha": "19:14"},
}


@pytest.fixture
def db(fake_db, monkeypatch):
    fake_db.store[("users", UID, "academic_record", "schedule")] = {"schedule": SLOTS}
    # Freeze "today" inside the first term (Monday 12 Oct 2026).
    monkeypatch.setattr(st, "today_riyadh", lambda: dt.date(2026, 10, 12))
    return fake_db


def run(tool, args, db):
    return asyncio.run(execute_tool(tool, args, UID, db))


# ── Pure helpers ──
@pytest.mark.parametrize("day,ref", ADHAN_REF.items())
def test_prayer_times_match_frontend_within_a_minute(day, ref):
    mine = st.prayer_times(dt.date.fromisoformat(day))
    for k, v in ref.items():
        assert abs(st.to_minutes(mine[k]) - st.to_minutes(v)) <= 1, (day, k, mine[k], v)


def test_absence_rules_match_frontend():
    e = lambda n, ex=False: [{"excused": ex}] * n
    assert st.absence_status(e(6), 40)["level"] == "danger"
    assert st.absence_status(e(7), 40)["level"] == "deprived"
    assert st.absence_status(e(2) + e(9, True), 40)["level"] == "deprived"
    s = st.absence_status(e(1), 30)
    assert (s["max_unexcused"], s["remaining_unexcused"], s["level"]) == (4, 3, "safe")


def test_resolve_day():
    mon = dt.date(2026, 10, 12)
    assert st.resolve_day("بكرة", mon) == dt.date(2026, 10, 13)
    assert st.resolve_day("الأحد", mon) == dt.date(2026, 10, 18)
    assert st.resolve_day("الإثنين", mon) == mon
    assert st.resolve_day("2026-11-01", mon) == dt.date(2026, 11, 1)


def test_match_course_by_code_and_arabic_name():
    courses = st.courses_from_schedule(SLOTS)
    assert [c["code"] for c in st.match_course("cs4510", courses)] == ["CS4510"]
    assert [c["code"] for c in st.match_course("تعلم الاله", courses)] == ["CS4510"]
    assert st.match_course("فيزياء", courses) == []


# ── Tools ──
def test_attendance_status_without_schedule(fake_db):
    out = run("get_attendance_status", {}, fake_db)
    assert out["success"] is False and "/schedule" in out["message"]


def test_record_absence_then_status(db):
    out = run("record_absence", {"course": "تعلم الآلة"}, db)
    assert out["success"] is True
    assert out["recorded"]["code"] == "CS4510" and out["recorded"]["date"] == "2026-10-12"
    assert out["recorded"]["excused"] is False
    saved = db.store[("users", UID, "academic_record", "attendance")]["courses"]["CS4510"]["entries"]
    assert len(saved) == 1

    run("record_absence", {"course": "CS4510", "date": "yesterday", "excused": True}, db)
    status = run("get_attendance_status", {"course": "CS4510"}, db)
    row = status["courses"][0]
    assert (row["unexcused"], row["excused"]) == (1, 1)
    assert row["total_lectures"] > 28
    assert row["remaining_unexcused"] == row["max_unexcused"] - 1


def test_record_absence_rejects_future_and_unknown(db):
    assert run("record_absence", {"course": "CS4510", "date": "tomorrow"}, db)["success"] is False
    bad = run("record_absence", {"course": "فيزياء"}, db)
    assert bad["success"] is False and len(bad["candidates"]) == 3


def test_attendance_payload_matches_frontend_store_shape(db):
    out = run("record_absence", {"course": "CS4999"}, db)
    snap = out["attendance"]
    entry = snap["courses"]["CS4999"]["entries"][0]
    assert set(entry) == {"id", "date", "excused"}
    assert "totalOverride" in snap["courses"]["CS4999"]
    json.dumps(snap)  # must be JSON-serialisable for the HTTP response


def test_day_schedule_with_prayer_conflict(db):
    out = run("get_day_schedule", {"day": "today"}, db)  # Monday
    assert out["weekday"] == "الإثنين"
    [lec] = out["lectures"]
    assert lec["code"] == "CS4520"
    assert lec["prayer_during"] and lec["prayer_during"][0].startswith("الظهر")
    assert out["prayer_times_makkah"]["الظهر"] in ("12:06", "12:07", "12:08")


def test_day_schedule_holiday_and_empty_day(db):
    out = run("get_day_schedule", {"day": "2026-11-22"}, db)  # Sunday in autumn break
    assert out["holiday"] == "إجازة الخريف"
    fri = run("get_day_schedule", {"day": "2026-10-16"}, db)
    assert fri["weekend"] is True and fri["lectures"] == []


def test_new_tools_are_registered():
    from agent.tools_schema import TOOLS_SCHEMA
    names = {t["function"]["name"] for t in TOOLS_SCHEMA}
    assert {"get_attendance_status", "record_absence", "get_day_schedule"} <= names
