"""
Deterministic helpers behind the agent's student tools:
  • term windows from the official calendar (data/uqu_calendar.py)
  • absence rules — mirror of frontend/src/lib/attendance.ts
  • Umm al-Qura prayer times for Makkah — mirror of frontend/src/lib/prayer-times.ts

Everything here is pure (no Firestore, no network) so it is fully unit-tested
and the agent never has to "do maths" itself.
"""

from __future__ import annotations

import datetime as dt
import math
import re
from dataclasses import dataclass

from data.uqu_calendar import UQU_CALENDAR

RIYADH = dt.timezone(dt.timedelta(hours=3))

AR_WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]  # Sunday first


def today_riyadh() -> dt.date:
    return dt.datetime.now(RIYADH).date()


def weekday_index(day: str) -> int:
    """Index in AR_WEEKDAYS (0 = Sunday), or -1. Accepts common spellings."""
    d = (day or "").strip().replace("ال", "", 1) if day else ""
    norm = {re.sub("^ال", "", w).replace("إ", "ا"): i for i, w in enumerate(AR_WEEKDAYS)}
    return norm.get(d.replace("إ", "ا"), -1)


def js_weekday(d: dt.date) -> int:
    """Sunday = 0 … Saturday = 6 (same as JS getDay)."""
    return (d.weekday() + 1) % 7


# ── Term windows ────────────────────────────────────────────────────
@dataclass
class TermWindow:
    term: str
    start: dt.date
    last_teaching_day: dt.date
    holidays: list[tuple[dt.date, dt.date, str]]

    def is_holiday(self, d: dt.date) -> str | None:
        for s, e, title in self.holidays:
            if s <= d <= e:
                return title
        return None


def _iso(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def term_windows() -> list[TermWindow]:
    out = []
    for t in UQU_CALENDAR:
        start = next((e for e in t["events"] if e["title"].startswith("بداية الفصل")), None)
        finals = next((e for e in t["events"] if e["title"] == "الاختبارات النهائية"), None)
        if not start or not finals:
            continue
        holidays = [
            (_iso(e["start"]), _iso(e["end"] or e["start"]), e["title"])
            for e in t["events"] if e["type"] == "holiday"
        ]
        out.append(TermWindow(t["term"], _iso(start["start"]), _iso(finals["start"]) - dt.timedelta(days=1), holidays))
    return out


def current_term(on: dt.date | None = None) -> TermWindow | None:
    on = on or today_riyadh()
    terms = term_windows()
    for t in terms:
        if t.start <= on <= t.last_teaching_day:
            return t
    for t in terms:
        if on < t.start:
            return t
    return terms[-1] if terms else None


def any_holiday(d: dt.date) -> str | None:
    for t in UQU_CALENDAR:
        for e in t["events"]:
            if e["type"] == "holiday" and _iso(e["start"]) <= d <= _iso(e["end"] or e["start"]):
                return e["title"]
    return None


def teaching_dates(term: TermWindow, weekdays: set[int]) -> list[dt.date]:
    days = (term.last_teaching_day - term.start).days
    out = []
    for i in range(days + 1):
        d = term.start + dt.timedelta(days=i)
        if js_weekday(d) in weekdays and not term.is_holiday(d):
            out.append(d)
    return out


# ── Courses from the timetable ──────────────────────────────────────
def courses_from_schedule(slots: list[dict]) -> list[dict]:
    courses: dict[str, dict] = {}
    for s in slots or []:
        code = str(s.get("course_code") or s.get("course_name") or "").strip()
        if not code:
            continue
        c = courses.setdefault(code, {"code": code, "name": s.get("course_name") or code, "weekdays": []})
        wd = weekday_index(str(s.get("day") or ""))
        if wd >= 0:
            c["weekdays"].append(wd)
    return sorted(courses.values(), key=lambda c: c["code"])


def estimate_sessions(course: dict, term: TermWindow | None) -> int:
    wds = course.get("weekdays") or []
    if not term or not wds:
        return max(1, len(wds)) * 15
    per_day: dict[int, int] = {}
    for w in wds:
        per_day[w] = per_day.get(w, 0) + 1
    return sum(per_day[js_weekday(d)] for d in teaching_dates(term, set(per_day)))


# ── Absence rules (Article 14, executive rule) ─────────────────────
UNEXCUSED_LIMIT = 0.15
TOTAL_LIMIT = 0.25
WARNING_RATIO = 0.7

LEVEL_AR = {"safe": "آمن", "warning": "انتبه", "danger": "آخر حد", "deprived": "تجاوز الحد (حرمان)"}


def absence_status(entries: list[dict], total_sessions: int) -> dict:
    total = max(0, int(total_sessions or 0))
    excused = sum(1 for e in entries if e.get("excused"))
    unexcused = len(entries) - excused
    max_unexcused = math.floor(total * UNEXCUSED_LIMIT + 1e-9)
    max_total = math.floor(total * TOTAL_LIMIT + 1e-9)
    remaining = max(0, min(max_unexcused - unexcused, max_total - (excused + unexcused)))
    level = "safe"
    if total > 0:
        if unexcused > max_unexcused or excused + unexcused > max_total:
            level = "deprived"
        elif remaining == 0:
            level = "danger"
        else:
            used = max(
                unexcused / max_unexcused if max_unexcused else 0,
                (excused + unexcused) / max_total if max_total else 0,
            )
            if used >= WARNING_RATIO:
                level = "warning"
    return {
        "total_lectures": total,
        "excused": excused,
        "unexcused": unexcused,
        "max_unexcused": max_unexcused,
        "max_total": max_total,
        "remaining_unexcused": remaining,
        "level": level,
        "level_ar": LEVEL_AR[level],
    }


def _norm(s: str) -> str:
    s = re.sub(r"[ً-ْـ]", "", (s or "").lower())
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", "", s)


def match_course(query: str, courses: list[dict]) -> list[dict]:
    """Courses whose code or name matches the query (code exact first)."""
    q = _norm(query)
    if not q:
        return []
    exact = [c for c in courses if _norm(c["code"]) == q]
    if exact:
        return exact
    return [c for c in courses if q in _norm(c["code"]) or q in _norm(c["name"]) or _norm(c["name"]) in q]


# ── Prayer times (Umm al-Qura, Makkah) ─────────────────────────────
MAKKAH = (21.4225, 39.8262)
PRAYER_AR = {"fajr": "الفجر", "sunrise": "الشروق", "dhuhr": "الظهر", "asr": "العصر", "maghrib": "المغرب", "isha": "العشاء"}


def _sun(jd: float) -> tuple[float, float]:
    """Declination (deg) and equation of time (hours) — praytimes.org algorithm."""
    d = jd - 2451545.0
    g = math.radians((357.529 + 0.98560028 * d) % 360)
    q = (280.459 + 0.98564736 * d) % 360
    lam = math.radians((q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360)
    e = math.radians(23.439 - 0.00000036 * d)
    ra = math.degrees(math.atan2(math.cos(e) * math.sin(lam), math.cos(lam))) / 15.0
    decl = math.degrees(math.asin(math.sin(e) * math.sin(lam)))
    eqt = q / 15.0 - (ra % 24)
    eqt = (eqt + 12) % 24 - 12
    return decl, eqt


def _hour_angle(angle: float, decl: float, lat: float) -> float:
    a, d, l = map(math.radians, (angle, decl, lat))
    v = (-math.sin(a) - math.sin(l) * math.sin(d)) / (math.cos(l) * math.cos(d))
    return math.degrees(math.acos(max(-1.0, min(1.0, v)))) / 15.0


def prayer_times(day: dt.date, lat: float = MAKKAH[0], lng: float = MAKKAH[1], tz: float = 3.0) -> dict[str, str]:
    """{"fajr": "HH:MM", …} — Fajr 18.5°, Isha = Maghrib + 90 min, Asr Shafi'i (Umm al-Qura)."""
    jd = dt.datetime(day.year, day.month, day.day, 12).toordinal() + 1721424.5 - lng / 360.0
    decl, eqt = _sun(jd)
    noon = 12 + tz - lng / 15.0 - eqt

    def asr_angle() -> float:
        return -math.degrees(math.atan(1 / (1 + math.tan(math.radians(abs(lat - decl))))))

    t = {
        "fajr": noon - _hour_angle(18.5, decl, lat),
        "sunrise": noon - _hour_angle(0.833, decl, lat),
        "dhuhr": noon,
        "asr": noon + _hour_angle(asr_angle(), decl, lat),
        "maghrib": noon + _hour_angle(0.833, decl, lat),
    }
    t["isha"] = t["maghrib"] + 1.5

    def fmt(h: float) -> str:
        m = int(round(h * 60)) % (24 * 60)
        return f"{m // 60:02d}:{m % 60:02d}"

    return {k: fmt(v) for k, v in t.items()}


def to_minutes(t: str) -> int:
    h, m = (t or "0:0").split(":")[:2]
    return int(h) * 60 + int(m)


def resolve_day(value: str | None, today: dt.date | None = None) -> dt.date:
    """'today' / 'tomorrow' / 'اليوم' / 'بكرة' / Arabic weekday / YYYY-MM-DD → date."""
    today = today or today_riyadh()
    v = (value or "today").strip().lower()
    if v in ("today", "اليوم", ""):
        return today
    if v in ("tomorrow", "بكرة", "بكره", "غدا", "غداً", "الغد"):
        return today + dt.timedelta(days=1)
    try:
        return dt.date.fromisoformat(v)
    except ValueError:
        pass
    wd = weekday_index(value or "")
    if wd >= 0:
        ahead = (wd - js_weekday(today)) % 7
        return today + dt.timedelta(days=ahead)
    return today


# ── Graduation progress (mirror of frontend/src/lib/graduation.ts) ──
FAST_LOAD, COMFORT_LOAD = 18, 14


def graduation_progress(plan_hours, earned_hours, current_hours) -> dict | None:
    try:
        plan = float(plan_hours)
        earned = float(earned_hours)
    except (TypeError, ValueError):
        return None
    if plan <= 0 or earned < 0:
        return None
    in_progress = max(0.0, float(current_hours or 0))
    remaining = max(0.0, plan - earned)
    after = max(0.0, remaining - in_progress)
    return {
        "plan_hours": int(plan),
        "earned_hours": int(earned),
        "this_term_hours": int(in_progress),
        "remaining_hours": int(remaining),
        "remaining_after_this_term": int(after),
        "percent": min(100, round(earned / plan * 100)),
        "terms_after_this_one": {"min": math.ceil(after / FAST_LOAD), "max": math.ceil(after / COMFORT_LOAD)},
        "graduates_this_term": remaining > 0 and after == 0,
        "assumption": f"العبء الدراسي بين {COMFORT_LOAD} و{FAST_LOAD} ساعة للفصل",
    }
