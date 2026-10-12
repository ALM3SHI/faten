"""
Deterministic placement and normalization for AI-generated study plan tasks.

Used only by `services.plan_ai.generate_ai_study_plan` — manual sessions on
the frontend are not routed through this module.
"""
from __future__ import annotations

import logging
import re
from schemas.plan_ai import (
    GeneratePlanRequest,
    PlanCourseInput,
    PlanDailySummary,
    PlanScheduleSlotInput,
    PlanTask,
    StudyPlan,
)

logger = logging.getLogger(__name__)

WEEK_DAYS_AR = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
]

DAY_EN_TO_AR = {
    "sunday": "الأحد",
    "monday": "الإثنين",
    "tuesday": "الثلاثاء",
    "wednesday": "الأربعاء",
    "thursday": "الخميس",
    "friday": "الجمعة",
    "saturday": "السبت",
}

STUDY_DAY_START = "06:00"
STUDY_DAY_END = "23:00"

AI_SESSION_MIN = 45
AI_SESSION_MAX = 90
AI_SESSION_DEFAULT = 60

LECTURE_BUFFER_MINUTES = 60
SLOT_STEP_MINUTES = 15

# Preferred anchor starts per energy peak (minutes). Repair rotates through these.
PEAK_ANCHOR_STARTS: dict[str, list[int]] = {
    "morning": [
        6 * 60,
        7 * 60 + 30,
        9 * 60,
        10 * 60 + 30,
        11 * 60,
    ],
    "afternoon": [
        12 * 60,
        13 * 60 + 30,
        15 * 60,
        16 * 60 + 30,
        17 * 60,
    ],
    "night": [21 * 60, 22 * 60, 22 * 60 + 30, 23 * 60, 0, 60],
}

# Representative starts per bucket — always evaluated as candidates.
BUCKET_ANCHOR_STARTS: dict[str, dict[str, list[int]]] = {
    "morning": {
        "early": [6 * 60, 7 * 60],
        "mid": [8 * 60, 9 * 60],
        "late": [10 * 60, 11 * 60],
    },
    "afternoon": {
        "early": [12 * 60, 13 * 60 + 30],
        "mid": [14 * 60, 15 * 60],
        "late": [16 * 60, 16 * 60 + 30, 17 * 60],
    },
    "night": {
        "early": [21 * 60, 21 * 60 + 30],
        "mid": [22 * 60 + 30, 23 * 60],
        "late": [0, 60],
    },
}

# Time buckets inside each peak window — placement prefers less-used buckets.
# Each entry: (bucket_id, start_minute inclusive, end_minute inclusive).
PEAK_TIME_BUCKETS: dict[str, list[tuple[str, int, int]]] = {
    "morning": [
        ("early", 6 * 60, 8 * 60 - 1),
        ("mid", 8 * 60, 10 * 60 - 1),
        ("late", 10 * 60, 12 * 60 - 1),
    ],
    "afternoon": [
        ("early", 12 * 60, 14 * 60 - 1),
        ("mid", 14 * 60, 16 * 60 - 1),
        ("late", 16 * 60, 18 * 60 - 1),
    ],
    "night": [
        ("early", 21 * 60, 22 * 60 + 29),
        ("mid", 22 * 60 + 30, 23 * 60 + 59),
        ("late", 0, 2 * 60),
    ],
}

# Syllabus hallucination guard (same intent as plan_ai FORBIDDEN_TITLE_WORDS_AR).
FORBIDDEN_TITLE_WORDS_AR = ["الفصل", "الوحدة", "شابتر", "درس", "الباب"]

# Non-review task intents the model must not emit as primary titles.
FORBIDDEN_NON_REVIEW_WORDS = [
    "مشروع",
    "واجب",
    "اختبار",
    "امتحان",
    "تدريب",
    "pitch",
    "pitch deck",
    "capstone",
    "graduation project",
    "برمجة ميزة",
    "تطوير ميزة",
    "إعداد عرض",
    "تحضير شرائح",
]

REVIEW_TITLE_MARKERS = [
    "مراجعة",
    "حل أسئلة ومراجعة",
    "مراجعة محاضرة",
    "مراجعة مواضيع",
]

DAY_ALIASES: dict[str, str] = {
    "الاحد": "الأحد",
    "احد": "الأحد",
    "الأحد": "الأحد",
    "الاثنين": "الإثنين",
    "اثنين": "الإثنين",
    "الإثنين": "الإثنين",
    "الثلاثاء": "الثلاثاء",
    "ثلاثاء": "الثلاثاء",
    "الاربعاء": "الأربعاء",
    "الأربعاء": "الأربعاء",
    "اربعاء": "الأربعاء",
    "الخميس": "الخميس",
    "خميس": "الخميس",
    "الجمعة": "الجمعة",
    "جمعة": "الجمعة",
    "السبت": "السبت",
    "سبت": "السبت",
}

# (start_minute, end_minute_exclusive) — end is inclusive minute of last valid start
# for a session that fits entirely in band; we use inclusive end for "in window" checks.
PeakBand = tuple[int, int, bool]  # start, end_inclusive, is_overflow


def _to_minutes(hhmm: str) -> int:
    try:
        h, m = hhmm.strip().split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return -1


def _to_hhmm(mins: int) -> str:
    if mins >= 24 * 60:
        mins = 23 * 60 + 59
    if mins < 0:
        mins = 0
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _normalize_time(hhmm: str) -> str | None:
    raw = (hhmm or "").strip()
    m = re.match(r"^(\d{1,2}):(\d{2})$", raw)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h < 0 or h > 23 or mi < 0 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}"


def normalize_day(day: str) -> str | None:
    d = (day or "").strip()
    if d in WEEK_DAYS_AR:
        return d
    key = d.replace(" ", "").replace("ـ", "")
    return DAY_ALIASES.get(key)


def energy_peak_bands(energy_peak: str) -> list[PeakBand]:
    """Primary bands: morning 06–12, afternoon 12–18, night 21–02."""
    if energy_peak == "morning":
        return [(6 * 60, 12 * 60 - 1, False)]
    if energy_peak == "afternoon":
        return [(12 * 60, 18 * 60 - 1, False)]
    if energy_peak == "night":
        return [
            (21 * 60, 23 * 60 + 59, False),
            (0, 2 * 60, False),
        ]
    return [(6 * 60, 12 * 60 - 1, False)]


def _peak_bucket_order(energy_peak: str) -> list[str]:
    return [b[0] for b in PEAK_TIME_BUCKETS.get(energy_peak, [])]


def _target_bucket_for_task(
    energy_peak: str,
    task_index: int,
    used_bucket_counts: dict[str, int],
) -> str:
    """Rotate early → mid → late by task index; fall back if bucket is saturated."""
    order = _peak_bucket_order(energy_peak)
    if not order:
        return "early"
    min_count = min(used_bucket_counts.get(b, 0) for b in order)
    preferred = order[task_index % len(order)]
    if used_bucket_counts.get(preferred, 0) <= min_count + 1:
        return preferred
    underused = [b for b in order if used_bucket_counts.get(b, 0) == min_count]
    return underused[task_index % len(underused)] if underused else preferred


def _peak_bucket_id(energy_peak: str, start: int) -> str:
    """Classify a start minute into early/mid/late bucket for the peak window."""
    if energy_peak == "night":
        if 0 <= start <= 2 * 60:
            return "late"
        if start >= 21 * 60:
            if start < 22 * 60 + 30:
                return "early"
            if start <= 23 * 60 + 59:
                return "mid"
        return "unknown"

    for bucket_id, b_start, b_end in PEAK_TIME_BUCKETS.get(energy_peak, []):
        if b_start <= start <= b_end:
            return bucket_id
    return "unknown"


def _peak_hour_key(start: int) -> str:
    """Hour-of-day key for penalizing repeated start hours (not only exact HH:MM)."""
    return f"{start // 60:02d}"


def _nearest_anchor_index(energy_peak: str, start: int) -> int:
    anchors = PEAK_ANCHOR_STARTS.get(energy_peak, [])
    if not anchors:
        return -1
    best_idx = 0
    best_dist = 24 * 60
    for i, anchor in enumerate(anchors):
        dist = abs(start - anchor)
        if energy_peak == "night" and anchor < 3 * 60 and start >= 20 * 60:
            dist = min(dist, (24 * 60 - start) + anchor)
        if dist < best_dist:
            best_dist = dist
            best_idx = i
    return best_idx


def _bucket_balance_bonus(
    energy_peak: str,
    bucket_id: str,
    used_bucket_counts: dict[str, int],
    target_bucket_id: str,
) -> float:
    """Reward underused buckets and the active rotation target."""
    bucket_ids = _peak_bucket_order(energy_peak)
    if bucket_id not in bucket_ids:
        return 0.0
    counts = [used_bucket_counts.get(b, 0) for b in bucket_ids]
    my_count = used_bucket_counts.get(bucket_id, 0)
    min_count = min(counts) if counts else 0
    score = 0.0
    if bucket_id == target_bucket_id:
        score += 2800.0
    if my_count <= min_count:
        score += 900.0
    elif my_count > min_count:
        score -= float(my_count - min_count) * 1100.0
    if my_count >= min_count + 2 and min_count == 0:
        score -= 1800.0
    return score


def _session_fits_peak(start: int, duration: int, bands: list[PeakBand]) -> tuple[bool, bool]:
    """Returns (fits_any, fits_primary_only). Session end is start + duration (exclusive)."""
    end_inclusive = start + duration - 1
    fits_any = False
    fits_primary = False
    for band_start, band_end, is_overflow in bands:
        if start >= band_start and end_inclusive <= band_end:
            fits_any = True
            if not is_overflow:
                fits_primary = True
    return fits_any, fits_primary


def clamp_ai_duration(minutes: int) -> int:
    if not isinstance(minutes, int):
        try:
            minutes = int(minutes)
        except (TypeError, ValueError):
            minutes = AI_SESSION_DEFAULT
    if minutes < AI_SESSION_MIN:
        return AI_SESSION_DEFAULT
    if minutes > AI_SESSION_MAX:
        return AI_SESSION_MAX
    return minutes


def _title_has_forbidden_syllabus_word(title: str) -> bool:
    return any(w in (title or "") for w in FORBIDDEN_TITLE_WORDS_AR)


def _title_is_non_review(title: str) -> bool:
    lower = (title or "").lower()
    if any(w in lower or w in (title or "") for w in FORBIDDEN_NON_REVIEW_WORDS):
        return True
    if _title_has_forbidden_syllabus_word(title):
        return True
    return not any(marker in (title or "") for marker in REVIEW_TITLE_MARKERS)


def review_title_for_course(course_name: str | None, course_code: str) -> str:
    label = (course_name or "").strip() or (course_code or "").strip() or "المادة"
    return f"مراجعة أساسيات {label}"


def normalize_ai_review_title(task: PlanTask) -> PlanTask:
    """Force AI tasks to read as review/study sessions."""
    title = (task.title or "").strip()
    if _title_is_non_review(title):
        new_title = review_title_for_course(task.courseName, task.courseCode)
        logger.warning(
            "[plan_ai] review title rewrite: %r → %r (course=%s)",
            title,
            new_title,
            task.courseCode,
        )
        return task.model_copy(update={"title": new_title})
    if "مراجعة" not in title:
        course = (task.courseName or "").strip() or (task.courseCode or "").strip()
        prefixed = f"مراجعة {title}" if title else review_title_for_course(task.courseName, task.courseCode)
        if course and title and not title.startswith("مراجعة"):
            prefixed = f"مراجعة {title}"
        return task.model_copy(update={"title": prefixed})
    return task


def _minute_range(start_time: str, end_time: str) -> tuple[int, int] | None:
    start = _to_minutes(start_time)
    end = _to_minutes(end_time)
    if start < 0 or end < 0 or end <= start:
        return None
    return start, end


def _ranges_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _lecture_count_by_day(schedule: list[PlanScheduleSlotInput]) -> dict[str, int]:
    counts = {d: 0 for d in WEEK_DAYS_AR}
    for slot in schedule:
        day = normalize_day(str(slot.day)) or (slot.day or "").strip()
        if day in counts:
            counts[day] += 1
    return counts


def _max_sessions_for_day(lecture_count: int) -> int:
    """Busy days get fewer study sessions; lighter days can take more."""
    if lecture_count >= 4:
        return 2
    if lecture_count >= 1:
        return 3
    return 4


def _days_sorted_by_lightness(
    days: list[str],
    lecture_counts: dict[str, int],
    day_session_count: dict[str, int],
) -> list[str]:
    """Prefer scheduling on days with fewer lectures and fewer sessions already placed."""

    def sort_key(d: str) -> tuple[int, int, int]:
        return (
            lecture_counts.get(d, 0),
            day_session_count.get(d, 0),
            WEEK_DAYS_AR.index(d) if d in WEEK_DAYS_AR else 99,
        )

    return sorted(days, key=sort_key)


def _lecture_intervals_for_day(
    schedule: list[PlanScheduleSlotInput],
    day: str,
) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for slot in schedule:
        if (slot.day or "").strip() != day:
            continue
        r = _minute_range(slot.start_time, slot.end_time)
        if r:
            out.append(r)
    return out


def _blocked_around_lectures(
    lectures: list[tuple[int, int]],
    buffer: int,
) -> list[tuple[int, int]]:
    blocked: list[tuple[int, int]] = []
    for s, e in lectures:
        blocked.append((max(0, s - buffer), min(24 * 60, e + buffer)))
    blocked.sort()
    merged: list[tuple[int, int]] = []
    for s, e in blocked:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def _subtract_blocked(
    window: tuple[int, int],
    blocked: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Return free sub-intervals inside window after removing blocked zones."""
    w_start, w_end = window
    free: list[tuple[int, int]] = [(w_start, w_end)]
    for b_start, b_end in blocked:
        next_free: list[tuple[int, int]] = []
        for f_start, f_end in free:
            if b_end <= f_start or b_start >= f_end:
                next_free.append((f_start, f_end))
                continue
            if f_start < b_start:
                next_free.append((f_start, b_start))
            if b_end < f_end:
                next_free.append((b_end, f_end))
        free = next_free
    return [(s, e) for s, e in free if e - s > 0]


def _task_end_minutes(start: int, duration: int) -> int:
    return start + duration


def _conflicts_lecture(
    study: tuple[int, int],
    lectures: list[tuple[int, int]],
    buffer: int,
    strict_buffer: bool,
) -> bool:
    for lec in lectures:
        if _ranges_overlap(study, lec):
            return True
        if strict_buffer:
            expanded = (max(0, lec[0] - buffer), lec[1] + buffer)
            if _ranges_overlap(study, expanded):
                return True
    return False


def _conflicts_study(study: tuple[int, int], placed: list[tuple[int, int]]) -> bool:
    return any(_ranges_overlap(study, p) for p in placed)


def _is_valid_start(
    day: str,
    start: int,
    duration: int,
    schedule: list[PlanScheduleSlotInput],
    placed_by_day: dict[str, list[tuple[int, int]]],
    lecture_buffer: int,
    strict_buffer: bool,
) -> bool:
    study = (start, start + duration)
    lectures = _lecture_intervals_for_day(schedule, day)
    if _conflicts_lecture(study, lectures, 0, False):
        return False
    if strict_buffer and _conflicts_lecture(
        study, lectures, lecture_buffer, True
    ):
        return False
    if _conflicts_study(study, placed_by_day.get(day, [])):
        return False
    return True


def _iter_candidate_starts(
    free_windows: dict[str, list[dict[str, str]]],
    day: str,
    duration: int,
    schedule: list[PlanScheduleSlotInput],
    placed_by_day: dict[str, list[tuple[int, int]]],
    lecture_buffer: int,
    strict_buffer: bool,
    energy_peak: str,
) -> list[int]:
    lectures = _lecture_intervals_for_day(schedule, day)
    blocked = _blocked_around_lectures(lectures, lecture_buffer)
    placed = placed_by_day.get(day, [])
    starts_set: set[int] = set()

    for win in free_windows.get(day, []):
        w = _minute_range(win.get("start", ""), win.get("end", ""))
        if not w:
            continue
        for sub_start, sub_end in _subtract_blocked(w, blocked):
            cursor = sub_start
            while cursor + duration <= sub_end:
                study = (cursor, cursor + duration)
                if _conflicts_lecture(study, lectures, 0, False):
                    cursor += SLOT_STEP_MINUTES
                    continue
                if strict_buffer and _conflicts_lecture(
                    study, lectures, lecture_buffer, True
                ):
                    cursor += SLOT_STEP_MINUTES
                    continue
                if _conflicts_study(study, placed):
                    cursor += SLOT_STEP_MINUTES
                    continue
                starts_set.add(cursor)
                cursor += SLOT_STEP_MINUTES

    # Peak + per-bucket anchor times (21:00 / 23:00 / 00:00 for night, etc.).
    anchor_starts: set[int] = set(PEAK_ANCHOR_STARTS.get(energy_peak, []))
    for bucket_starts in BUCKET_ANCHOR_STARTS.get(energy_peak, {}).values():
        anchor_starts.update(bucket_starts)
    for anchor in anchor_starts:
        if _is_valid_start(
            day,
            anchor,
            duration,
            schedule,
            placed_by_day,
            lecture_buffer,
            strict_buffer,
        ):
            starts_set.add(anchor)

    return sorted(starts_set)


def _score_candidate(
    start: int,
    duration: int,
    day: str,
    bands: list[PeakBand],
    used_time_counts: dict[str, int],
    used_hour_counts: dict[str, int],
    used_bucket_counts: dict[str, int],
    used_anchor_zone_counts: dict[int, int],
    day_session_count: dict[str, int],
    lecture_counts: dict[str, int],
    total_placed_sessions: int,
    original_start: int,
    priority: str,
    energy_peak: str,
    task_index: int,
    target_bucket_id: str,
) -> float:
    fits_any, fits_primary = _session_fits_peak(start, duration, bands)
    score = 0.0
    if fits_primary:
        score += 2000
    elif fits_any:
        score -= 3000
    else:
        score -= 8000

    if priority == "high" and fits_primary:
        score += 400

    time_key = _to_hhmm(start)
    exact_repeat = used_time_counts.get(time_key, 0)
    score -= exact_repeat * 1400
    if exact_repeat == 0:
        score += 120

    hour_key = _peak_hour_key(start)
    hour_repeat = used_hour_counts.get(hour_key, 0)
    score -= hour_repeat * 850
    if hour_repeat == 0:
        score += 200

    bucket_id = _peak_bucket_id(energy_peak, start)
    bucket_repeat = used_bucket_counts.get(bucket_id, 0)
    score -= bucket_repeat * 1400
    score += _bucket_balance_bonus(
        energy_peak, bucket_id, used_bucket_counts, target_bucket_id
    )

    anchor_idx = _nearest_anchor_index(energy_peak, start)
    if anchor_idx >= 0:
        zone_repeat = used_anchor_zone_counts.get(anchor_idx, 0)
        score -= zone_repeat * 550
        anchors = PEAK_ANCHOR_STARTS.get(energy_peak, [])
        preferred = anchors[task_index % len(anchors)]
        preferred_idx = anchors.index(preferred) if preferred in anchors else anchor_idx
        if anchor_idx == preferred_idx:
            score += 700
        distance = abs(start - preferred)
        if energy_peak == "night" and preferred < 3 * 60 and start >= 20 * 60:
            distance = min(distance, (24 * 60 - start) + preferred)
        if distance <= 30:
            score += 450
        else:
            score -= distance * 0.8

    if original_start >= 0:
        score -= abs(start - original_start) * 0.05

    sessions_on_day = day_session_count.get(day, 0)
    score -= sessions_on_day * 450

    if total_placed_sessions >= 4 and sessions_on_day >= 2:
        share = (sessions_on_day + 1) / (total_placed_sessions + 1)
        if share > 0.45:
            score -= 900

    lectures_on_day = lecture_counts.get(day, 0)
    score += max(0, 5 - lectures_on_day) * 160

    return score


def _schedulable_days(req: GeneratePlanRequest) -> list[str]:
    day_off_ar = DAY_EN_TO_AR.get(req.preferences.dayOff, "")
    days = list(WEEK_DAYS_AR)
    if req.preferences.dayOff != "none" and day_off_ar in days:
        days = [d for d in days if d != day_off_ar]
    return days


def _course_lookup(req: GeneratePlanRequest) -> dict[str, PlanCourseInput]:
    return {c.code: c for c in req.courses}


def _priority_rank(p: str) -> int:
    return {"high": 0, "medium": 1, "low": 2}.get(p, 1)


def sanitize_ai_plan_tasks(
    plan: StudyPlan,
    courses_by_code: dict[str, PlanCourseInput],
) -> tuple[StudyPlan, dict[str, int]]:
    counters = {
        "titles_rewritten": 0,
        "durations_adjusted": 0,
    }
    new_tasks: list[PlanTask] = []
    for task in plan.tasks:
        t = task
        before_title = t.title
        t = normalize_ai_review_title(t)
        if t.title != before_title:
            counters["titles_rewritten"] += 1

        course = courses_by_code.get(t.courseCode)
        if course and not (t.courseName or "").strip():
            t = t.model_copy(update={"courseName": course.name})

        before_dur = t.durationMinutes
        new_dur = clamp_ai_duration(before_dur)
        if new_dur != before_dur:
            t = t.model_copy(update={"durationMinutes": new_dur})
            counters["durations_adjusted"] += 1

        day = normalize_day(t.suggestedDay)
        if day:
            t = t.model_copy(update={"suggestedDay": day})
        time_norm = _normalize_time(t.suggestedTime)
        if time_norm:
            t = t.model_copy(update={"suggestedTime": time_norm})

        new_tasks.append(t)

    return plan.model_copy(update={"tasks": new_tasks}), counters


def repair_ai_task_placements(
    plan: StudyPlan,
    req: GeneratePlanRequest,
    free_windows: dict[str, list[dict[str, str]]],
) -> tuple[StudyPlan, dict[str, int]]:
    """
    Reassign suggestedDay/suggestedTime so tasks avoid lectures (with buffer),
    respect energy peak bands, vary start times, and balance days.
    """
    counters = {
        "tasks_moved": 0,
        "tasks_unplaced_kept": 0,
        "buffer_relaxed": 0,
        "bucket_only_fallback": 0,
    }
    bands = energy_peak_bands(req.preferences.energyPeak)
    schedulable_days = _schedulable_days(req)
    if not schedulable_days:
        schedulable_days = list(WEEK_DAYS_AR)

    placed_by_day: dict[str, list[tuple[int, int]]] = {d: [] for d in WEEK_DAYS_AR}
    day_session_count: dict[str, int] = {d: 0 for d in WEEK_DAYS_AR}
    used_time_counts: dict[str, int] = {}
    used_hour_counts: dict[str, int] = {}
    used_bucket_counts: dict[str, int] = {}
    used_anchor_zone_counts: dict[int, int] = {}
    lecture_counts = _lecture_count_by_day(req.schedule)
    energy_peak = req.preferences.energyPeak

    sorted_tasks = sorted(
        plan.tasks,
        key=lambda t: (_priority_rank(t.priority), t.courseCode),
    )

    repaired: list[PlanTask] = []

    for task_index, task in enumerate(sorted_tasks):
        duration = clamp_ai_duration(task.durationMinutes)
        t = task.model_copy(update={"durationMinutes": duration})
        day = normalize_day(t.suggestedDay) or schedulable_days[0]
        time_norm = _normalize_time(t.suggestedTime) or "08:00"
        original_start = _to_minutes(time_norm)
        target_bucket = _target_bucket_for_task(
            energy_peak, task_index, used_bucket_counts
        )

        best: tuple[float, str, int] | None = None

        def consider(
            d: str,
            start: int,
            strict_buffer: bool,
            bucket_filter: str | None = None,
        ) -> None:
            nonlocal best
            if bucket_filter is not None:
                if _peak_bucket_id(energy_peak, start) != bucket_filter:
                    return
            day_cap = _max_sessions_for_day(lecture_counts.get(d, 0))
            if day_session_count.get(d, 0) >= day_cap:
                return
            if not _is_valid_start(
                d,
                start,
                duration,
                req.schedule,
                placed_by_day,
                LECTURE_BUFFER_MINUTES,
                strict_buffer,
            ):
                return
            fits_window, _ = _session_fits_peak(start, duration, bands)
            if not fits_window:
                return
            total_placed = sum(day_session_count.values())
            sc = _score_candidate(
                start,
                duration,
                d,
                bands,
                used_time_counts,
                used_hour_counts,
                used_bucket_counts,
                used_anchor_zone_counts,
                day_session_count,
                lecture_counts,
                total_placed,
                original_start,
                t.priority,
                energy_peak,
                task_index,
                target_bucket,
            )
            if best is None or sc > best[0]:
                best = (sc, d, start)

        def try_days(
            day_list: list[str],
            strict_buffer: bool,
            bucket_filter: str | None = None,
        ) -> None:
            ordered = _days_sorted_by_lightness(
                day_list, lecture_counts, day_session_count
            )
            for d in ordered:
                day_cap = _max_sessions_for_day(lecture_counts.get(d, 0))
                if day_session_count.get(d, 0) >= day_cap:
                    continue
                for start in _iter_candidate_starts(
                    free_windows,
                    d,
                    duration,
                    req.schedule,
                    placed_by_day,
                    LECTURE_BUFFER_MINUTES,
                    strict_buffer,
                    energy_peak,
                ):
                    consider(d, start, strict_buffer, bucket_filter)

        # Phase 1: target bucket only (strict buffer).
        if day in schedulable_days and original_start >= 0:
            consider(day, original_start, strict_buffer=True, bucket_filter=target_bucket)
        try_days(schedulable_days, strict_buffer=True, bucket_filter=target_bucket)
        # Phase 2: any bucket in peak window (strict buffer).
        if best is None:
            counters["bucket_only_fallback"] += 1
            if day in schedulable_days and original_start >= 0:
                consider(day, original_start, strict_buffer=True, bucket_filter=None)
            try_days(schedulable_days, strict_buffer=True, bucket_filter=None)
        # Phase 3: relax lecture buffer.
        if best is None:
            counters["buffer_relaxed"] += 1
            try_days(schedulable_days, strict_buffer=False, bucket_filter=target_bucket)
        if best is None:
            try_days(schedulable_days, strict_buffer=False, bucket_filter=None)
        if best is None and req.preferences.dayOff != "none":
            try_days(list(WEEK_DAYS_AR), strict_buffer=False, bucket_filter=None)

        if best is None:
            counters["tasks_unplaced_kept"] += 1
            logger.warning(
                "[plan_ai placement] no valid slot for %s on %s %s — keeping task",
                t.courseCode,
                day,
                time_norm,
            )
            repaired.append(t)
            continue

        _, new_day, new_start = best
        new_time = _to_hhmm(new_start)
        end = new_start + duration
        placed_by_day.setdefault(new_day, []).append((new_start, end))
        day_session_count[new_day] = day_session_count.get(new_day, 0) + 1
        used_time_counts[new_time] = used_time_counts.get(new_time, 0) + 1
        used_hour_counts[_peak_hour_key(new_start)] = (
            used_hour_counts.get(_peak_hour_key(new_start), 0) + 1
        )
        bucket_id = _peak_bucket_id(energy_peak, new_start)
        if bucket_id != "unknown":
            used_bucket_counts[bucket_id] = used_bucket_counts.get(bucket_id, 0) + 1
        anchor_idx = _nearest_anchor_index(energy_peak, new_start)
        if anchor_idx >= 0:
            used_anchor_zone_counts[anchor_idx] = (
                used_anchor_zone_counts.get(anchor_idx, 0) + 1
            )

        moved = new_day != day or new_time != time_norm
        if moved:
            counters["tasks_moved"] += 1
            reason = (t.reason or "").strip()
            if "أعيد جدولتها" not in reason:
                extra = f" أعيد جدولتها لتجنب تعارض المحاضرات واحترام وقت ذروتك ({req.preferences.energyPeak})."
                reason = (reason + extra).strip() if reason else extra.strip()
            t = t.model_copy(
                update={
                    "suggestedDay": new_day,
                    "suggestedTime": new_time,
                    "reason": reason,
                }
            )
        repaired.append(t)

    final_bucket_counts: dict[str, int] = {b: 0 for b in _peak_bucket_order(energy_peak)}
    chosen_times: list[str] = []
    for t in repaired:
        st = _normalize_time(t.suggestedTime)
        if st:
            chosen_times.append(f"{t.suggestedDay} {st}")
            bid = _peak_bucket_id(energy_peak, _to_minutes(st))
            if bid in final_bucket_counts:
                final_bucket_counts[bid] += 1
    logger.info(
        "[plan_ai placement] distribution energyPeak=%s tasks=%d "
        "bucket_counts=%s times=%s repair_stats=%s",
        energy_peak,
        len(repaired),
        final_bucket_counts,
        chosen_times,
        counters,
    )

    return plan.model_copy(update={"tasks": repaired}), counters


def recompute_daily_summaries(plan: StudyPlan) -> StudyPlan:
    sums: dict[str, int] = {}
    for t in plan.tasks:
        d = normalize_day(t.suggestedDay) or t.suggestedDay
        sums[d] = sums.get(d, 0) + t.durationMinutes

    if plan.dailySummary:
        updated = []
        for entry in plan.dailySummary:
            day = normalize_day(entry.day) or entry.day
            updated.append(entry.model_copy(update={"totalMinutes": sums.get(day, 0)}))
        return plan.model_copy(update={"dailySummary": updated})

    summaries = []
    for day in WEEK_DAYS_AR:
        if sums.get(day, 0) > 0:
            summaries.append(
                {
                    "day": day,
                    "summary": f"جلسات مراجعة بإجمالي {sums[day]} دقيقة.",
                    "totalMinutes": sums[day],
                }
            )
    return plan.model_copy(
        update={
            "dailySummary": [
                PlanDailySummary(**s) if isinstance(s, dict) else s for s in summaries
            ]
        }
    )
