"""Phone/browser push notifications through Firebase Cloud Messaging.

Devices:   users/{uid}/devices/{id}  {token, platform, createdAt, lastSeen}
Prefs:     users/{uid}.notificationPrefs {lectures, attendance, exams}
Sent log:  users/{uid}/push_log/{key}    (one reminder per key, ever)

The reminder texts are built by small pure functions (exam_reminders,
attendance_reminders, lecture_reminders) so they can be tested without
Firebase; send_to_user() does the delivery, skips anything already sent
and forgets tokens FCM reports as dead.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
from typing import Any, Iterable

from services import student_tools as st
from services.exams import describe, load_exams, upcoming

logger = logging.getLogger(__name__)

PREF_KEYS = ("lectures", "attendance", "exams")
DEFAULT_PREFS = {k: True for k in PREF_KEYS}
MAX_DEVICES = 10
EXAM_REMINDER_DAYS = (0, 1, 3, 7)


# ── Devices & preferences ─────────────────────────────────────────
def device_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:32]


def _user_ref(db, uid: str):
    return db.collection("users").document(uid)


def register_device(db, uid: str, token: str, platform: str = "web") -> str:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    did = device_id(token)
    devices = _user_ref(db, uid).collection("devices")
    ref = devices.document(did)
    snap = ref.get()
    created = (snap.to_dict() or {}).get("createdAt", now) if snap.exists else now
    ref.set({"token": token, "platform": platform[:20], "createdAt": created, "lastSeen": now})
    # Keep the newest MAX_DEVICES (old browsers pile up otherwise).
    rows = sorted(devices.get(), key=lambda s: (s.to_dict() or {}).get("lastSeen", ""), reverse=True)
    for old in rows[MAX_DEVICES:]:
        devices.document(old.id).delete()
    return did


def remove_device(db, uid: str, did: str) -> None:
    _user_ref(db, uid).collection("devices").document(did).delete()


def load_prefs(db, uid: str) -> dict:
    snap = _user_ref(db, uid).get()
    saved = ((snap.to_dict() or {}).get("notificationPrefs") or {}) if snap.exists else {}
    return {k: bool(saved.get(k, True)) for k in PREF_KEYS}


def save_prefs(db, uid: str, prefs: dict) -> dict:
    clean = {k: bool(prefs.get(k, True)) for k in PREF_KEYS}
    _user_ref(db, uid).set({"notificationPrefs": clean}, merge=True)
    return clean


def device_tokens(db, uid: str) -> list[tuple[str, str]]:
    return [(s.id, (s.to_dict() or {}).get("token", "")) for s in _user_ref(db, uid).collection("devices").get()
            if (s.to_dict() or {}).get("token")]


# ── Reminder texts (pure) ─────────────────────────────────────────
def _count_ar(n: int, one: str, two: str, few: str) -> str:
    if n == 1:
        return one
    if n == 2:
        return two
    return f"{n} {few}"


def exam_reminders(exams: list[dict], today: dt.date) -> list[dict]:
    """'اختبارك بعد 3 أيام' — on the day, the day before, 3 and 7 days before."""
    items = []
    for e in upcoming(exams, today):
        d = describe(e, today)
        if d["days_left"] not in EXAM_REMINDER_DAYS:
            continue
        at = f" الساعة {d['time']}" if d["time"] else ""
        where = f" — {d['location']}" if d["location"] else ""
        if d["days_left"] == 0:
            title = f"📝 اليوم اختبار {d['subject']}"
            body = f"بالتوفيق!{at}{where} — خذ نفساً عميقاً وراجع أهم النقاط."
        else:
            title = f"⏰ اختبارك في {d['subject']} {d['when']}"
            body = f"{d['weekday']} {d['date']}{at}{where}. افتح خطة المذاكرة وشوف مهام اليوم."
        items.append({"key": f"exam:{e['id']}:{d['date']}:{d['days_left']}", "title": title, "body": body, "url": "/exams"})
    return items


def attendance_reminders(rows: list[dict], today: dt.date) -> list[dict]:
    """'باقي لك غيابين' when a course is close to the deprivation limit."""
    items = []
    for r in rows:
        level, left = r.get("level"), int(r.get("remaining_unexcused") or 0)
        if level not in ("warning", "danger", "deprived") or r.get("total_lectures", 0) <= 0:
            continue
        name = r.get("name") or r.get("code")
        if level == "deprived":
            title, body = f"🚫 تجاوزت حد الغياب في {name}", "راجع أستاذ المقرر أو القسم في أقرب وقت."
        elif left == 0:
            title, body = f"⚠️ وصلت آخر حد للغياب في {name}", "أي غياب إضافي بدون عذر يعني الحرمان من الاختبار النهائي."
        else:
            title = f"⚠️ باقي لك {_count_ar(left, 'غياب واحد', 'غيابين', 'غيابات')} في {name}"
            body = "بعدها تُحرم من الاختبار النهائي (15% بدون عذر). احضر المحاضرات القادمة."
        # One reminder per course per level/remaining count, not every morning.
        items.append({"key": f"absence:{r.get('code')}:{level}:{left}", "title": title, "body": body, "url": "/attendance"})
    return items


def lecture_reminders(slots: list[dict], now: dt.datetime, window: tuple[int, int] = (30, 90)) -> list[dict]:
    """'محاضرة بعد ساعة' for lectures starting `window` minutes from now (Riyadh time)."""
    today = now.date()
    if st.any_holiday(today) or st.current_term(today) is None:
        return []
    wd = st.js_weekday(today)
    now_min = now.hour * 60 + now.minute
    items = []
    for s in slots:
        if st.weekday_index(str(s.get("day") or "")) != wd or not s.get("start_time"):
            continue
        start = st.to_minutes(str(s["start_time"]))
        delta = start - now_min
        if not (window[0] < delta <= window[1]):
            continue
        name = s.get("course_name") or s.get("course_code") or "محاضرة"
        when = "بعد ساعة" if 50 <= delta <= 70 else f"بعد {delta} دقيقة"
        place = " / ".join(x for x in (s.get("building"), s.get("room")) if x)
        body = f"تبدأ الساعة {s['start_time']}" + (f" في {place}" if place else "") + "."
        key = f"lecture:{today.isoformat()}:{s.get('course_code') or name}:{s['start_time']}"
        items.append({"key": key, "title": f"🔔 محاضرة {name} {when}", "body": body, "url": "/schedule"})
    return items


# ── Delivery ──────────────────────────────────────────────────────
_DEAD_TOKEN_ERRORS = ("UnregisteredError", "SenderIdMismatchError", "InvalidArgumentError")


def _send_each(messages: list) -> Any:  # pragma: no cover - thin wrapper, patched in tests
    from firebase_admin import messaging

    return messaging.send_each(messages)


def _build_message(token: str, item: dict):
    from firebase_admin import messaging

    # Data-only: public/push-sw.js shows the notification itself (RTL, icon, link).
    return messaging.Message(
        token=token,
        data={"title": item["title"], "body": item["body"], "url": item.get("url", "/dashboard"), "tag": item["key"][:64]},
        webpush=messaging.WebpushConfig(headers={"Urgency": "high", "TTL": "21600"}),
    )


def send_to_user(db, uid: str, items: Iterable[dict], *, dedupe: bool = True) -> int:
    """Push each item to every device of the student; returns how many were sent."""
    items = list(items)
    if not items:
        return 0
    devices = device_tokens(db, uid)
    if not devices:
        return 0
    log = _user_ref(db, uid).collection("push_log")
    sent = 0
    for item in items:
        log_ref = log.document(hashlib.sha256(item["key"].encode()).hexdigest()[:32])
        if dedupe and log_ref.get().exists:
            continue
        response = _send_each([_build_message(token, item) for _, token in devices])
        ok = 0
        for (did, _), res in zip(devices, getattr(response, "responses", [])):
            if getattr(res, "success", False):
                ok += 1
            elif type(getattr(res, "exception", None)).__name__ in _DEAD_TOKEN_ERRORS:
                remove_device(db, uid, did)
        if ok:
            sent += 1
            if dedupe:
                log_ref.set({"key": item["key"], "sentAt": dt.datetime.now(dt.timezone.utc).isoformat()})
        devices = device_tokens(db, uid)
        if not devices:
            break
    return sent


# ── Jobs (called by tasks/cron.py) ────────────────────────────────
def users_with_devices(db) -> list[str]:
    return [u.id for u in db.collection("users").get() if list(_user_ref(db, u.id).collection("devices").limit(1).get())]


def daily_items(db, uid: str, today: dt.date) -> list[dict]:
    from services.agent_student_tools import _load_attendance, _load_schedule, _status_rows

    prefs = load_prefs(db, uid)
    items: list[dict] = []
    if prefs["exams"]:
        items += exam_reminders(load_exams(_user_ref(db, uid)), today)
    if prefs["attendance"]:
        courses = st.courses_from_schedule(_load_schedule(db, uid))
        if courses:
            rows = _status_rows(courses, _load_attendance(db, uid), st.current_term(today))
            items += attendance_reminders(rows, today)
    return items


def lecture_items(db, uid: str, now: dt.datetime) -> list[dict]:
    from services.agent_student_tools import _load_schedule

    if not load_prefs(db, uid)["lectures"]:
        return []
    return lecture_reminders(_load_schedule(db, uid), now)
