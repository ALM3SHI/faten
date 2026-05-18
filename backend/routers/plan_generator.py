"""
================================================================
UQU Academic Assistant — Smart Plan Generator Router
================================================================
Generates personalized weekly study schedules using a pure
rule-based algorithm. No external AI calls — works offline
with no quota limits.

Key features:
  - Avoids conflicts with university lecture times (schedule_slots)
  - Weights sessions by difficulty, weak-subject history, deadline
  - Personalizes titles by study style (mind maps, flashcards, etc.)
  - Distributes sessions across multiple weeks proportionally

Endpoints:
  POST /api/plan/generate         (Bearer auth) — smart algorithm
  POST /api/plan/generate-fallback (Bearer auth) — basic fallback
"""

import logging
import math
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from auth.bearer import verify_firebase_token
from schemas.plan_generator import (
    PlanGenerationRequest,
    PlanGenerationResponse,
    FallbackPlanRequest,
    FallbackPlanResponse,
    PlanTask,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plan", tags=["Plan Generator"])


# ── Time helpers ──────────────────────────────────────────────────────────────

def _parse_time_mins(t: str) -> int:
    """'HH:MM' → minutes since midnight. Returns 0 on parse failure."""
    try:
        parts = str(t).strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return 0


def _format_time(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _subtract_conflicts(
    slot_start: int,
    slot_end: int,
    conflicts: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Return free sub-intervals of [slot_start, slot_end] with conflict blocks removed."""
    free: list[tuple[int, int]] = [(slot_start, slot_end)]
    for cs, ce in sorted(conflicts, key=lambda x: x[0]):
        new_free: list[tuple[int, int]] = []
        for fs, fe in free:
            if ce <= fs or cs >= fe:
                new_free.append((fs, fe))
            else:
                if fs < cs:
                    new_free.append((fs, cs))
                if fe > ce:
                    new_free.append((ce, fe))
        free = new_free
    return free


# ── Session title / note generators ──────────────────────────────────────────

_STYLE_TITLES: dict[str, list[str]] = {
    "خرائط": ["رسم خريطة ذهنية", "توسيع الخريطة الذهنية", "تنظيم المفاهيم بصرياً", "مراجعة الخريطة الذهنية"],
    "بطاقات": ["مراجعة البطاقات", "اختبار ذاتي بالبطاقات", "تكرار متباعد", "إنشاء بطاقات جديدة"],
    "تلخيص": ["تلخيص الوحدة", "إعادة صياغة الأفكار الرئيسية", "مراجعة الملخص السابق", "تلخيص الفصل"],
    "مجموعات": ["جلسة نقاش جماعي", "حل مسائل جماعي", "مراجعة تبادلية", "شرح للزميل"],
    "تطبيقي": ["حل مسائل تطبيقية", "تطبيق عملي", "مراجعة التمارين", "اختبار ذاتي"],
}
_DEFAULT_TITLES = ["مراجعة", "حل تمارين", "قراءة وفهم", "مراجعة شاملة", "تطبيق عملي"]


def _get_title(course_name: str, style: str, idx: int) -> str:
    for key, titles in _STYLE_TITLES.items():
        if key in (style or ""):
            return f"{titles[idx % len(titles)]}: {course_name}"
    return f"{_DEFAULT_TITLES[idx % len(_DEFAULT_TITLES)]}: {course_name}"


def _get_note(course_name: str, difficulty: str, is_weak: bool, stress: str, style: str) -> str:
    parts: list[str] = []
    if is_weak:
        parts.append(f"ركّز مضاعفاً على {course_name} — تحتاج اهتماماً إضافياً")
    diff = (difficulty or "").lower()
    if "hard" in diff or "صعب" in diff:
        parts.append("استخدم تقنية بومودورو (25 دق تركيز + 5 دق راحة)")
    elif "easy" in diff or "سهل" in diff:
        parts.append("يمكنك المتابعة السريعة بعد الفهم")
    if "high" in (stress or "").lower() or "مرتفع" in (stress or ""):
        parts.append("الفهم أهم من الكمية — خذ وقتك")
    if "خرائط" in (style or ""):
        parts.append("ارسم خريطة ذهنية قبل البدء")
    elif "بطاقات" in (style or ""):
        parts.append("اختبر نفسك بالبطاقات بعد القراءة")
    return " — ".join(parts) if parts else "اقرأ وفهم ثم لخص بكلماتك الخاصة"


# ── Core algorithm ────────────────────────────────────────────────────────────

_DAY_ORDER = ["الأحد", "الإثنين", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
_DAY_IDX = {d: i for i, d in enumerate(_DAY_ORDER)}

_DIFF_WEIGHT = {"easy": 0.7, "سهل": 0.7, "medium": 1.0, "متوسط": 1.0, "hard": 1.4, "صعب": 1.4}
_SPEED_MULT = {"fast": 0.8, "سريع": 0.8, "normal": 1.0, "متوسط": 1.0, "slow": 1.3, "بطيء": 1.3}


def _smart_generate(req: PlanGenerationRequest) -> tuple[str, list[dict]]:
    """
    Build a conflict-aware, preference-weighted study schedule.
    Returns (reasoning_message, list_of_task_dicts).
    """
    prefs = (req.profile.preferences if req.profile and req.profile.preferences else None)

    study_time_pref = (prefs.studyTime if prefs else None) or "مساء"
    study_style = (prefs.studyStyle if prefs else None) or "مراجعة"
    stress = (prefs.stressLevel if prefs else None) or "متوسط"
    speed = (prefs.learningSpeed if prefs else None) or "متوسط"

    session_min = max(20, req.sessionMin or 60)
    max_weeks = max(1, req.weeks or 1)

    base_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if req.planStart:
        try:
            base_date = datetime.strptime(req.planStart[:10], "%Y-%m-%d")
        except ValueError:
            pass

    if study_time_pref == "صباح" or "morning" in study_time_pref.lower():
        pref_center = 9 * 60
    elif study_time_pref == "مساء" or "evening" in study_time_pref.lower():
        pref_center = 18 * 60
    else:
        pref_center = 15 * 60

    class_blocks: dict[str, list[tuple[int, int]]] = {}
    conflict_block_count = 0
    for c in req.courses:
        for slot in getattr(c, "schedule_slots", []):
            day = slot.get("day")
            if not day: continue
            start_str = slot.get("startTime") or slot.get("time") or "00:00"
            end_str = slot.get("endTime") or slot.get("timeEnd") or "00:00"
            start_mins = _parse_time_mins(start_str)
            end_mins = _parse_time_mins(end_str)
            if start_mins < end_mins:
                if day not in class_blocks:
                    class_blocks[day] = []
                class_blocks[day].append((start_mins, end_mins))
                conflict_block_count += 1

    # ── Weak subjects ─────────────────────────────────────────────────────────
    weak_names: set[str] = set()
    
    letter_to_gpa = {
        "A+": 4.0, "A": 3.75, "B+": 3.5, "B": 3.0, 
        "C+": 2.5, "C": 2.0, "D+": 1.5, "D": 1.0, "F": 0.0
    }

    for c in req.completedCourses:
        if c.grade is None:
            continue
        val = None
        try:
            val = float(c.grade)
        except (ValueError, TypeError):
            # Check if it's a letter grade
            grade_str = str(c.grade).strip().upper()
            if grade_str in letter_to_gpa:
                val = letter_to_gpa[grade_str]
        
        if val is not None and val <= 3.5:
            weak_names.add(c.name.strip().lower())

    # ── Auto-generate courses from weak subjects if none provided ─────────────
    if not req.courses and req.completedCourses:
        reasoning_prefix = "نظراً لعدم وجود مواد مسجلة حالياً، تم بناء خطة مراجعة للمواد التي تحتاج تقوية بناءً على سجلك الأكاديمي. "
        for name in weak_names:
            # Find the original record to get the full name
            orig = next((c for c in req.completedCourses if c.name.strip().lower() == name), None)
            if orig:
                req.courses.append(PlanCourse(
                    name=orig.name,
                    difficulty="hard",
                    id=f"weak_{orig.name}",
                    color="#f87171"
                ))
    else:
        reasoning_prefix = ""

    if not req.courses:
        return "لا توجد مواد مسجلة حالياً ولا يوجد سجل أكاديمي لتحليله. يرجى إضافة موادك في صفحة المعدل أو رفع السجل الأكاديمي أولاً.", []

    # ── Build weekly session template ─────────────────────────────────────────
    weekly_template: list[dict] = []
    for slot in req.slots:
        day = slot.day
        slot_start = _parse_time_mins(str(slot.time))
        slot_end = _parse_time_mins(str(slot.timeEnd))
        if slot_end <= slot_start:
            continue
        conflicts = sorted(class_blocks.get(day, []), key=lambda x: x[0])
        for (fs, fe) in _subtract_conflicts(slot_start, slot_end, conflicts):
            s = fs
            while s + session_min <= fe:
                weekly_template.append(
                    {"day": day, "startMins": s, "endMins": s + session_min, "place": slot.place}
                )
                s += session_min

    weekly_template.sort(
        key=lambda s: (_DAY_IDX.get(s["day"], 7), abs(s["startMins"] - pref_center))
    )

    if not weekly_template:
        reasoning = (
            "لم يتم العثور على أوقات متاحة للمذاكرة. "
            "يرجى مراجعة الأوقات المتاحة في البروفايل والتأكد من عدم تعارضها الكامل مع جدول المحاضرات."
        )
        return reasoning, []

    # ── Course demand calculation ─────────────────────────────────────────────
    speed_factor = _SPEED_MULT.get(speed, 1.0)
    weekly_cap = len(weekly_template)

    course_ids: list[str] = []
    course_map: dict[str, object] = {}
    course_demand: dict[str, int] = {}
    course_deadline: dict[str, int] = {}
    hard_courses: list[object] = []

    for c in req.courses:
        cid: str = str(getattr(c, "id", None) or c.name)
        diff_factor = _DIFF_WEIGHT.get(str(getattr(c, "difficulty", None) or "medium"), 1.0)
        is_weak = any(w in c.name.strip().lower() for w in weak_names)
        weak_factor = 1.3 if is_weak else 1.0

        current = float(getattr(c, "currentProgress", None) or 0)
        remaining_pct = max(0.0, 100.0 - current)
        per_session = float(getattr(c, "progressPerSession", None) or 0)

        if per_session > 0:
            base_sessions = math.ceil(remaining_pct / per_session)
        else:
            base_sessions = max_weeks * 2

        total = max(1, math.ceil(base_sessions * diff_factor * speed_factor * weak_factor))
        # Cap per-course share so one course doesn't monopolise the plan
        per_course_cap = max(1, int(weekly_cap * max_weeks * 0.75 / max(1, len(req.courses))))
        total = min(total, per_course_cap)

        course_demand[cid] = total
        course_ids.append(cid)
        course_map[cid] = c

        exam_str = getattr(c, "examDate", None)
        if exam_str:
            try:
                exam_dt = datetime.strptime(str(exam_str)[:10], "%Y-%m-%d")
                diff_days = (exam_dt - base_date).days
                w_idx = max(1, min(max_weeks, math.floor(diff_days / 7) + 1))
                course_deadline[cid] = w_idx
            except ValueError:
                course_deadline[cid] = max_weeks
        else:
            course_deadline[cid] = max_weeks

        diff_str = str(getattr(c, "difficulty", "") or "").lower()
        if "hard" in diff_str or "صعب" in diff_str:
            hard_courses.append(c)

    # ── Distribute sessions across weeks ──────────────────────────────────────
    study_tasks: list[dict] = []
    remaining_demand = dict(course_demand)
    session_idx_per_course: dict[str, int] = {cid: 0 for cid in course_ids}

    for w in range(1, max_weeks + 1):
        weekly_quotas: dict[str, int] = {}
        for cid in course_ids:
            rem = remaining_demand.get(cid, 0)
            deadline_w = course_deadline.get(cid, max_weeks)
            if rem <= 0 or w > deadline_w:
                weekly_quotas[cid] = 0
                continue
            weeks_left = deadline_w - w + 1
            weekly_quotas[cid] = max(0, math.ceil(rem / weeks_left))

        weekly_assigned: dict[str, int] = {cid: 0 for cid in course_ids}

        for sess in weekly_template:
            best_cid: str | None = None
            best_score: float = -1.0

            for cid in course_ids:
                rem = remaining_demand.get(cid, 0)
                if rem <= 0:
                    continue
                deadline_w = course_deadline.get(cid, max_weeks)
                if w > deadline_w:
                    continue

                quota_left = weekly_quotas.get(cid, 0) - weekly_assigned.get(cid, 0)
                urgency = 1.0 / max(1, deadline_w - w + 1)
                score = rem * 100.0 + urgency * 1000.0 + (500.0 if quota_left > 0 else 0.0)

                if score > best_score:
                    best_score = score
                    best_cid = cid

            if best_cid is None:
                continue

            course = course_map[best_cid]
            c_name_raw = getattr(course, "name", "")
            c_name: str = c_name_raw.strip() if c_name_raw and c_name_raw.strip() else "مادة غير مسماة"
            c_diff: str = str(getattr(course, "difficulty", "") or "medium")
            c_color: str = str(getattr(course, "color", "") or "#6366f1")
            c_id: str | None = getattr(course, "id", None)
            is_weak = any(wn in c_name.strip().lower() for wn in weak_names)
            sidx = session_idx_per_course.get(best_cid, 0)

            offset_days = (w - 1) * 7 + _DAY_IDX.get(sess["day"], 0)
            task_date = base_date + timedelta(days=offset_days)

            study_tasks.append(
                {
                    "day": sess["day"],
                    "time": _format_time(sess["startMins"]),
                    "timeEnd": _format_time(sess["endMins"]),
                    "courseName": c_name,
                    "title": _get_title(c_name, study_style, sidx),
                    "note": _get_note(c_name, c_diff, is_weak, stress, study_style),
                    "place": sess["place"],
                    "week": w,
                    "date": task_date.strftime("%Y-%m-%d"),
                    "courseId": c_id or best_cid,
                    "courseColor": c_color,
                }
            )

            remaining_demand[best_cid] = max(0, remaining_demand[best_cid] - 1)
            weekly_assigned[best_cid] = weekly_assigned.get(best_cid, 0) + 1
            session_idx_per_course[best_cid] = sidx + 1

    # ── Reasoning message ─────────────────────────────────────────────────────
    parts: list[str] = []
    if reasoning_prefix:
        parts.append(reasoning_prefix)
    parts.append(f"بنيت خطتك على مدى {max_weeks} أسبوع بمجموع {len(study_tasks)} جلسة دراسية.")
    if study_time_pref:
        parts.append(f"راعيت تفضيلك لوقت {study_time_pref} في ترتيب الجلسات.")
    if study_style and study_style != "مراجعة":
        parts.append(f"صُمّمت عناوين الجلسات بأسلوب {study_style}.")
    if weak_names:
        parts.append("أعطيت أولوية مضاعفة للمواد ذات التاريخ الأكاديمي الضعيف.")
    if hard_courses:
        names = " و".join(getattr(c, "name", "") for c in hard_courses[:2])
        parts.append(f"المواد الصعبة ({names}) حصلت على جلسات أكثر.")
    if conflict_block_count > 0:
        parts.append(f"تم تجنّب التعارض مع {conflict_block_count} فترة محاضرة جامعية.")
    if "مرتفع" in stress or "high" in stress.lower():
        parts.append("نظراً لمستوى ضغطك المرتفع، وُزّعت الجلسات لتفادي الإرهاق.")
    if "بطيء" in speed or "slow" in speed.lower():
        parts.append("أُضيفت جلسات إضافية لتتناسب مع سرعة استيعابك.")

    return " ".join(parts), study_tasks


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=PlanGenerationResponse)
async def generate_plan(
    body: PlanGenerationRequest,
    user_id: str = Depends(verify_firebase_token),
) -> PlanGenerationResponse:
    """
    Generate a smart study plan using the built-in rule-based algorithm.

    No external API calls — works offline, no quota limits.
    Respects class schedule conflicts, learning preferences,
    difficulty weights, and weak-subject history from completed courses.
    """
    reasoning, tasks = _smart_generate(body)
    plan_tasks = [PlanTask(**t) for t in tasks]
    return PlanGenerationResponse(reasoning=reasoning, tasks=plan_tasks)


@router.post("/generate-fallback", response_model=FallbackPlanResponse)
async def generate_fallback_plan(
    body: FallbackPlanRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FallbackPlanResponse:
    """Basic schedule distributor (kept as a secondary fallback)."""
    slots = body.slots
    courses = body.courses
    session_min = body.sessionMin
    max_weeks = body.weeks
    plan_start = body.planStart

    weekly_sessions_template: list[dict] = []
    day_index = {
        "الأحد": 0, "الإثنين": 1, "الاثنين": 1, "الثلاثاء": 2,
        "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6,
    }

    for s in slots:
        day = s.get("day", "الأحد")
        time_str = s.get("time", "00:00")
        time_end_str = s.get("timeEnd", "00:00")
        try:
            start_h, start_m = map(int, time_str.split(":"))
            end_h, end_m = map(int, time_end_str.split(":"))
        except Exception:
            start_h = start_m = end_h = end_m = 0
        start_mins = start_h * 60 + start_m
        end_mins = end_h * 60 + end_m
        if end_mins < start_mins:
            end_mins += 24 * 60
        diff = end_mins - start_mins
        for i in range(diff // session_min):
            sm = start_mins + i * session_min
            weekly_sessions_template.append(
                {"day": day, "startMins": sm, "endMins": sm + session_min, "place": s.get("place", "")}
            )

    if not weekly_sessions_template:
        return FallbackPlanResponse(success=False, message="الفترات المتاحة قصيرة جداً بالنسبة لمدة الجلسة.")

    demand: dict = {}
    deadline_week: dict = {}
    warnings: list[str] = []
    weekly_cap = len(weekly_sessions_template)
    try:
        base_date = datetime.strptime(plan_start, "%Y-%m-%d")
    except ValueError:
        base_date = datetime.now()

    for c in courses:
        cid = c.get("id")
        try:
            current = min(100.0, max(0.0, float(c.get("currentProgress") or 0)))
        except Exception:
            current = 0.0
        try:
            per_session = max(0.0, float(c.get("progressPerSession") or 0))
        except Exception:
            per_session = 0.0
        remaining = max(0.0, 100.0 - current)
        if per_session > 0:
            required_sessions = math.ceil(remaining / per_session)
        else:
            try:
                wh = max(1, int(c.get("weeklyHours") or 1))
            except Exception:
                wh = 1
            required_sessions = wh * max_weeks
        demand[cid] = required_sessions
        exam_date_str = c.get("examDate")
        if exam_date_str:
            try:
                exam_date = datetime.strptime(exam_date_str, "%Y-%m-%d")
                diff_days = (exam_date - base_date).days
                w_idx = 1 if diff_days < 0 else math.floor(diff_days / 7) + 1
                w_idx = min(max_weeks, max(1, w_idx))
                deadline_week[cid] = w_idx
            except ValueError:
                deadline_week[cid] = max_weeks
        else:
            deadline_week[cid] = max_weeks
        capacity = weekly_cap * deadline_week[cid]
        if required_sessions > capacity:
            warnings.append(
                f'المادة "{c.get("name")}" تحتاج ~{required_sessions} جلسة حتى 100٪، لكن السعة المتاحة {capacity} جلسة فقط.'
            )

    study_tasks: list[dict] = []
    for w in range(1, max_weeks + 1):
        weekly_quota: dict = {}
        weekly_assigned: dict = {}
        for cid, left in demand.items():
            if left <= 0 or w > deadline_week[cid]:
                weekly_quota[cid] = 0
                weekly_assigned[cid] = 0
                continue
            weeks_remaining = deadline_week[cid] - w + 1
            weekly_quota[cid] = min(left, math.ceil(left / weeks_remaining))
            weekly_assigned[cid] = 0
        for sess in weekly_sessions_template:
            chosen_id = None
            best_score = -float("inf")
            for cid, left in demand.items():
                if left <= 0 or w > deadline_week[cid]:
                    continue
                quota_left = weekly_quota[cid] - weekly_assigned[cid]
                if quota_left > 0:
                    score = quota_left * 1000 + left
                    if score > best_score:
                        best_score = score
                        chosen_id = cid
            if not chosen_id:
                for cid, left in demand.items():
                    if left <= 0 or w > deadline_week[cid]:
                        continue
                    if left > best_score:
                        best_score = left
                        chosen_id = cid
            if not chosen_id:
                continue
            course = next((c for c in courses if c.get("id") == chosen_id), None)
            if not course:
                continue
            demand[chosen_id] -= 1
            if weekly_quota[chosen_id] > 0:
                weekly_assigned[chosen_id] += 1
            offset_days = (w - 1) * 7 + day_index.get(sess["day"], 0)
            d = base_date + timedelta(days=offset_days)
            study_tasks.append(
                {
                    "id": str(uuid.uuid4()),
                    "kind": "study",
                    "week": w,
                    "day": sess["day"],
                    "date": d.strftime("%Y-%m-%d"),
                    "time": _format_time(sess["startMins"]),
                    "timeEnd": _format_time(sess["endMins"]),
                    "courseId": course.get("id"),
                    "courseName": course.get("name", ""),
                    "courseColor": course.get("color", ""),
                    "title": f"{course.get('name', '')}: جلسة تقدّم دراسي",
                    "place": sess.get("place", ""),
                    "note": f"💡 اقرأ وفهم ثم لخص بأسلوبك — تقدم متوقع: {course.get('progressPerSession', '?')}%",
                }
            )

    return FallbackPlanResponse(success=True, plan=study_tasks, warnings=warnings)
