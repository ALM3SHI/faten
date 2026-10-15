"""Firestore-backed implementations of the agent's student tools."""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from services import student_tools as st

logger = logging.getLogger(__name__)


def _record_ref(db, user_id: str, name: str):
    return db.collection("users").document(user_id).collection("academic_record").document(name)


def _load_schedule(db, user_id: str) -> list[dict]:
    snap = _record_ref(db, user_id, "schedule").get()
    if snap.exists:
        slots = (snap.to_dict() or {}).get("schedule") or []
        if slots:
            return slots
    user = db.collection("users").document(user_id).get()
    tt = (user.to_dict() or {}).get("timetable") if user.exists else None
    return tt if isinstance(tt, list) else []


def _load_attendance(db, user_id: str) -> dict:
    snap = _record_ref(db, user_id, "attendance").get()
    data = (snap.to_dict() or {}) if snap.exists else {}
    courses = data.get("courses")
    return courses if isinstance(courses, dict) else {}


def _status_rows(courses: list[dict], records: dict, term) -> list[dict]:
    rows = []
    for c in courses:
        rec = records.get(c["code"]) or {}
        total = rec.get("totalOverride") or st.estimate_sessions(c, term)
        rows.append({"code": c["code"], "name": c["name"], **st.absence_status(rec.get("entries") or [], total)})
    return rows


def get_attendance_status(args: dict, user_id: str, db) -> dict:
    slots = _load_schedule(db, user_id)
    courses = st.courses_from_schedule(slots)
    if not courses:
        return {"success": False, "message": "ما فيه جدول محفوظ للطالب. اطلب منه رفع جدوله من صفحة الجدول (/schedule) ليُحسب عدد المحاضرات."}
    records = _load_attendance(db, user_id)
    query = str(args.get("course") or "").strip()
    if query:
        matched = st.match_course(query, courses)
        if not matched:
            return {"success": False, "message": f"لم أجد مقرراً باسم «{query}» في جدول الطالب.", "courses": [c["name"] for c in courses]}
        courses = matched
    term = st.current_term()
    return {
        "success": True,
        "term": term.term if term else None,
        "rule": "الحرمان إذا زاد الغياب بدون عذر عن 15% أو مجموع الغياب (مع العذر) عن 25% — القاعدة التنفيذية للمادة 14",
        "courses": _status_rows(courses, records, term),
        "note": "الأرقام تقديرية من جدول الطالب؛ المرجع الرسمي سجل الحضور عند أستاذ المقرر.",
        "page": "/attendance",
    }


def record_absence(args: dict, user_id: str, db) -> dict:
    slots = _load_schedule(db, user_id)
    courses = st.courses_from_schedule(slots)
    if not courses:
        return {"success": False, "message": "ما فيه جدول محفوظ للطالب، فلا أعرف مقرراته. اطلب منه رفع الجدول أولاً."}
    query = str(args.get("course") or "").strip()
    matched = st.match_course(query, courses)
    if len(matched) != 1:
        return {
            "success": False,
            "message": "حدّد المقرر بدقة." if matched else f"لم أجد «{query}» في جدول الطالب.",
            "candidates": [{"code": c["code"], "name": c["name"]} for c in (matched or courses)],
        }
    course = matched[0]

    raw_date = str(args.get("date") or "today").strip().lower()
    today = st.today_riyadh()
    if raw_date in ("yesterday", "أمس", "امس", "البارحة"):
        day = today - dt.timedelta(days=1)
    else:
        day = st.resolve_day(raw_date, today)
    if day > today:
        return {"success": False, "message": "لا يمكن تسجيل غياب في تاريخ مستقبلي."}

    records = _load_attendance(db, user_id)
    rec = dict(records.get(course["code"]) or {"entries": [], "totalOverride": None})
    entry = {"id": secrets.token_hex(6), "date": day.isoformat(), "excused": bool(args.get("excused"))}
    rec["entries"] = sorted([*(rec.get("entries") or []), entry], key=lambda e: e.get("date") or "", reverse=True)
    records[course["code"]] = rec
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    _record_ref(db, user_id, "attendance").set({"courses": records, "lastUpdated": now}, merge=True)

    term = st.current_term()
    status = _status_rows([course], records, term)[0]
    return {
        "success": True,
        "recorded": {"course": course["name"], "code": course["code"], **entry},
        "status": status,
        # The frontend applies this snapshot to its attendance store directly.
        "attendance": {"courses": records, "lastUpdated": now},
    }


def get_day_schedule(args: dict, user_id: str, db) -> dict:
    day = st.resolve_day(str(args.get("day") or "today"))
    wd = st.js_weekday(day)
    day_name = st.AR_WEEKDAYS[wd]
    slots = [s for s in _load_schedule(db, user_id) if st.weekday_index(str(s.get("day") or "")) == wd]
    slots.sort(key=lambda s: st.to_minutes(str(s.get("start_time") or "00:00")))
    prayers = st.prayer_times(day)
    lectures = []
    for s in slots:
        start, end = str(s.get("start_time") or ""), str(s.get("end_time") or "")
        during = [
            f"{st.PRAYER_AR[k]} {prayers[k]}"
            for k in ("dhuhr", "asr", "maghrib")
            if start and end and st.to_minutes(start) < st.to_minutes(prayers[k]) < st.to_minutes(end)
        ]
        lectures.append({
            "course": s.get("course_name") or s.get("course_code"),
            "code": s.get("course_code"),
            "start": start,
            "end": end,
            "type": s.get("type"),
            "location": " / ".join(x for x in (s.get("building"), s.get("room")) if x) or None,
            "prayer_during": during,
        })
    holiday = st.any_holiday(day)
    return {
        "success": True,
        "date": day.isoformat(),
        "weekday": day_name,
        "holiday": holiday,
        "weekend": wd in (5, 6),
        "lectures": lectures,
        "prayer_times_makkah": {st.PRAYER_AR[k]: v for k, v in prayers.items()},
        "note": None if slots else ("لا توجد محاضرات في هذا اليوم حسب الجدول المحفوظ." if _load_schedule(db, user_id) else "لا يوجد جدول محفوظ للطالب."),
    }


def get_graduation_progress(args: dict, user_id: str, db) -> dict:
    user = db.collection("users").document(user_id).get()
    udata = (user.to_dict() or {}) if user.exists else {}
    rec_snap = _record_ref(db, user_id, "main").get()
    rec = (rec_snap.to_dict() or {}) if rec_snap.exists else {}
    basic = udata.get("basic") or {}
    profile = udata.get("profile") or {}
    # UQU transcripts never print the plan total; a stored record `planHours` is the
    # attempted-hours footer (older uploads also copied it into the profile).
    legacy = rec.get("planHours")
    plan = basic.get("totalPlanHours") or profile.get("totalPlanHours")
    if plan and legacy and float(plan) == float(legacy):
        plan = None
    earned = rec.get("earnedHours") if rec.get("earnedHours") is not None else profile.get("earnedHours")
    current = sum(
        float(c.get("creditHours") or c.get("credit_hours") or 0) for c in (rec.get("currentCourses") or [])
    )
    progress = st.graduation_progress(plan, earned, current)
    if progress is None:
        return {"success": False, "message": "لا أعرف ساعات خطة الطالب أو ساعاته المجتازة. اطلب منه رفع سجله الأكاديمي وتحديد ساعات الخطة من الملف الشخصي (/profile)."}
    return {"success": True, **progress, "note": "تقدير بالساعات فقط؛ المقررات المتبقية بالتحديد يحددها المرشد الأكاديمي حسب الخطة الدراسية."}


_TOOLS = {
    "get_attendance_status": get_attendance_status,
    "record_absence": record_absence,
    "get_day_schedule": get_day_schedule,
    "get_graduation_progress": get_graduation_progress,
}


def run_student_tool(name: str, args: dict, user_id: str, db) -> dict:
    try:
        return _TOOLS[name](args or {}, user_id, db)
    except Exception as exc:  # never crash the agent loop on a tool
        logger.exception("[student-tools] %s failed", name)
        return {"success": False, "message": f"تعذّر تنفيذ الأداة: {type(exc).__name__}"}
