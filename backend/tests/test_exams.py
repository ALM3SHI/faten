"""Student exam timetable: parsing, countdown, conflicts and the agent tools."""

import asyncio
import datetime as dt

import pytest

from agent.intent import classify_intent_heuristic
from agent.tools_executor import execute_tool
from services import exams as ex

UID = "stu1"
TODAY = dt.date(2026, 12, 20)  # Sunday


@pytest.fixture
def db(fake_db, monkeypatch):
    monkeypatch.setattr(ex, "today_riyadh", lambda: TODAY)
    col = ("users", UID, "exams")
    fake_db.store[col + ("e1",)] = {"subject": "تعلم الآلة", "course_code": "cs4510", "date": "2026-12-27", "time": "09:00", "location": "قاعة 105", "exam_type": "final", "done": False}
    fake_db.store[col + ("e2",)] = {"subject": "أمن الشبكات", "date": "2026-12-23", "time": "13:00", "done": False}
    fake_db.store[col + ("e3",)] = {"subject": "مادة منتهية", "date": "2026-12-01", "done": False}
    fake_db.store[col + ("e4",)] = {"subject": "اختبار منجز", "date": "2026-12-24", "done": True}
    fake_db.store[col + ("bad",)] = {"subject": "بلا تاريخ"}
    return fake_db


def run(tool, args, db):
    return asyncio.run(execute_tool(tool, args, UID, db))


@pytest.mark.parametrize("raw,expected", [
    ("09:30", "09:30"), ("9", "09:00"), ("10:00 AM", "10:00"), ("1:15 pm", "13:15"),
    ("12 ص", "00:00"), ("2 م", "14:00"), ("٩:٣٠ ص", "09:30"), ("25:00", None), ("بكرة", None), (None, None),
])
def test_normalize_time(raw, expected):
    assert ex.normalize_time(raw) == expected


def test_normalize_exam_cleans_fields():
    e = ex.normalize_exam("x", {"subject": " AI ", "course_code": "cs101", "date": "٢٠٢٦-١٢-٢٧", "duration_minutes": "5", "exam_type": "weird"})
    assert e == {
        "id": "x", "subject": "AI", "course_code": "CS101", "date": "2026-12-27", "time": None,
        "duration_minutes": 15, "location": None, "exam_type": "exam", "notes": "", "done": False,
    }
    assert ex.normalize_exam("y", {"subject": "no date"}) is None


def test_conflicts_overlap_and_same_day():
    a = ex.normalize_exam("a", {"subject": "A", "date": "2026-12-27", "time": "09:00", "duration_minutes": 120})
    b = ex.normalize_exam("b", {"subject": "B", "date": "2026-12-27", "time": "10:30"})
    c = ex.normalize_exam("c", {"subject": "C", "date": "2026-12-27", "time": "13:00"})
    d = ex.normalize_exam("d", {"subject": "D", "date": "2026-12-28"})
    found = ex.conflicts([c, d, b, a])
    kinds = {tuple(f["exams"]): f["kind"] for f in found}
    assert kinds == {("a", "b"): "overlap", ("a", "c"): "same_day", ("b", "c"): "same_day"}


def test_when_label():
    assert [ex.when_label(n) for n in (0, 1, 2, 7, 12)] == ["اليوم", "غداً", "بعد يومين", "بعد 7 أيام", "بعد 12 يوماً"]


def test_get_upcoming_exams_answers_next_exam(db):
    out = run("get_upcoming_exams", {}, db)
    assert out["success"] and out["count"] == 2
    nxt = out["next_exam"]
    assert nxt["subject"] == "أمن الشبكات" and nxt["days_left"] == 3 and nxt["weekday"] == "الأربعاء"
    assert out["message"] == "اختبارك القادم: أمن الشبكات يوم الأربعاء 2026-12-23 الساعة 13:00 (بعد 3 أيام)."
    assert [e["id"] for e in out["exams"]] == ["e2", "e1"]
    assert out["conflicts"] == []


def test_get_upcoming_exams_without_exams(fake_db, monkeypatch):
    monkeypatch.setattr(ex, "today_riyadh", lambda: TODAY)
    out = run("get_upcoming_exams", {}, fake_db)
    assert out["count"] == 0 and "/exams" in out["message"]


def test_add_upcoming_exam_normalizes_and_warns_on_clash(db):
    out = run("add_upcoming_exam", {"subject": "قواعد البيانات", "date": "2026-12-27", "time": "10:00 AM", "location": "B-204"}, db)
    assert out["success"]
    assert out["exam"]["time"] == "10:00" and out["exam"]["duration_minutes"] == 120 and out["exam"]["source"] == "agent"
    assert "يتعارض" in out["warning"] and "تعلم الآلة" in out["warning"]
    stored = db.store[("users", UID, "exams", out["id"])]
    assert stored["date"] == "2026-12-27" and stored["done"] is False and "id" not in stored


def test_add_upcoming_exam_rejects_unclear_date(db):
    out = run("add_upcoming_exam", {"subject": "X", "date": "الأسبوع الجاي"}, db)
    assert out["success"] is False


@pytest.mark.parametrize("text,intent", [
    ("متى اختباري الجاي؟", "MY_EXAMS"),
    ("كم باقي على الفاينل", "MY_EXAMS"),
    ("وش جدول اختباراتي", "MY_EXAMS"),
    ("عندي تعارض في الاختبارات؟", "MY_EXAMS"),
    ("أضف اختبار فيزياء يوم الأحد", "SCHEDULE_TASK"),
    ("متى الاختبارات النهائية للجامعة", "ACADEMIC_CALENDAR"),
])
def test_exam_questions_route_to_the_right_intent(text, intent):
    assert classify_intent_heuristic([{"role": "user", "content": text}])["intent"] == intent
