"""The student's own exam timetable (users/{uid}/exams/{id}).

One document per exam, written by the /exams page and by the agent's
add_upcoming_exam tool:

    subject           str   course name shown to the student
    course_code       str | None
    date              "YYYY-MM-DD"
    time              "HH:MM" (24h) | None
    duration_minutes  int   (default 120)
    location          str | None
    exam_type         "final" | "midterm" | "quiz" | "exam" | "assignment"
    notes             str
    done              bool
    createdAt / updatedAt  ISO-8601

Everything here reads the whole (small) collection and filters in Python,
so no composite Firestore index is needed. The frontend twin is
frontend/src/lib/exams.ts.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any, Iterable

from services.student_tools import today_riyadh

DEFAULT_DURATION = 120
EXAM_TYPES = ("final", "midterm", "quiz", "exam", "assignment")
_AR_WEEKDAYS = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def normalize_time(value: Any) -> str | None:
    """'10:00 AM' / '2 م' / '14:30' / '٩:٣٠ ص' → 'HH:MM' (24h); None if unreadable."""
    if value is None:
        return None
    s = str(value).translate(_AR_DIGITS).strip().lower()
    if not s:
        return None
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|ص|م|صباحا|صباحاً|مساء|مساءً)?$", s)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    suffix = m.group(3) or ""
    if suffix.startswith(("p", "م", "مساء")) and hour < 12:
        hour += 12
    if suffix.startswith(("a", "ص")) and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def normalize_date(value: Any) -> str | None:
    """Accept 'YYYY-MM-DD' (also with Arabic digits or a time part)."""
    if value is None:
        return None
    s = str(value).translate(_AR_DIGITS).strip()[:10]
    try:
        return dt.date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def normalize_exam(doc_id: str, data: dict) -> dict | None:
    """Clean one Firestore document; None when it has no usable date."""
    date = normalize_date(data.get("date"))
    if not date:
        return None
    try:
        duration = int(data.get("duration_minutes") or DEFAULT_DURATION)
    except (TypeError, ValueError):
        duration = DEFAULT_DURATION
    exam_type = str(data.get("exam_type") or "exam")
    return {
        "id": doc_id,
        "subject": str(data.get("subject") or data.get("course_code") or "اختبار").strip(),
        "course_code": (str(data["course_code"]).strip().upper() or None) if data.get("course_code") else None,
        "date": date,
        "time": normalize_time(data.get("time")),
        "duration_minutes": max(15, min(duration, 600)),
        "location": (str(data.get("location")).strip() or None) if data.get("location") else None,
        "exam_type": exam_type if exam_type in EXAM_TYPES else "exam",
        "notes": str(data.get("notes") or ""),
        "done": bool(data.get("done", False)),
    }


def _sort_key(e: dict) -> tuple:
    return (e["date"], e["time"] or "99:99", e["subject"])


def load_exams(user_ref) -> list[dict]:
    """All exams of the student, cleaned and sorted by date/time."""
    out = []
    for snap in user_ref.collection("exams").get():
        exam = normalize_exam(snap.id, snap.to_dict() or {})
        if exam:
            out.append(exam)
    return sorted(out, key=_sort_key)


def upcoming(exams: Iterable[dict], today: dt.date | None = None) -> list[dict]:
    """Not done, today or later — soonest first."""
    t = (today or today_riyadh()).isoformat()
    return sorted((e for e in exams if not e["done"] and e["date"] >= t), key=_sort_key)


def _minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def conflicts(exams: Iterable[dict]) -> list[dict]:
    """Pairs of exams on the same day: overlapping times are 'overlap',
    otherwise 'same_day' (two exams in one day is still worth a warning)."""
    items = sorted(exams, key=_sort_key)
    found = []
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if b["date"] != a["date"]:
                break
            kind = "same_day"
            if a["time"] and b["time"]:
                a_start, b_start = _minutes(a["time"]), _minutes(b["time"])
                if a_start < b_start + b["duration_minutes"] and b_start < a_start + a["duration_minutes"]:
                    kind = "overlap"
            found.append({"date": a["date"], "kind": kind, "exams": [a["id"], b["id"]],
                          "subjects": [a["subject"], b["subject"]]})
    return found


def days_until(exam: dict, today: dt.date | None = None) -> int:
    return (dt.date.fromisoformat(exam["date"]) - (today or today_riyadh())).days


def when_label(days: int) -> str:
    if days <= 0:
        return "اليوم"
    if days == 1:
        return "غداً"
    if days == 2:
        return "بعد يومين"
    if days <= 10:
        return f"بعد {days} أيام"
    return f"بعد {days} يوماً"


def describe(exam: dict, today: dt.date | None = None) -> dict:
    """Exam + countdown fields the agent can quote as-is."""
    d = dt.date.fromisoformat(exam["date"])
    days = days_until(exam, today)
    return {
        **exam,
        "weekday": _AR_WEEKDAYS[d.weekday()],
        "days_left": days,
        "when": when_label(days),
    }


def upcoming_summary(exams: list[dict], today: dt.date | None = None, limit: int = 10) -> dict:
    """What get_upcoming_exams returns: next exam, the list, and conflicts."""
    ahead = upcoming(exams, today)
    described = [describe(e, today) for e in ahead[:limit]]
    clashes = conflicts(ahead)
    result: dict[str, Any] = {
        "success": True,
        "count": len(ahead),
        "exams": described,
        "conflicts": clashes,
        "page": "/exams",
    }
    if described:
        n = described[0]
        at = f" الساعة {n['time']}" if n["time"] else ""
        where = f" في {n['location']}" if n["location"] else ""
        result["next_exam"] = n
        result["message"] = f"اختبارك القادم: {n['subject']} يوم {n['weekday']} {n['date']}{at}{where} ({n['when']})."
    else:
        result["message"] = "لا توجد اختبارات قادمة مسجّلة. يقدر الطالب يضيفها من صفحة الاختبارات (/exams) أو يخبرك بها."
    if any(c["kind"] == "overlap" for c in clashes):
        result["warning"] = "يوجد تعارض في أوقات بعض الاختبارات — نبّه الطالب ليراجع الجدول."
    return result
