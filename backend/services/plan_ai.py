"""
================================================================
UQU Academic Assistant — AI Study Plan Generator Service
================================================================
Builds a weekly study plan tailored to the student's courses, busy
timetable, and Smart Preferences Hub selections.

Pipeline:
    request → free-window precomputation → system + user prompts
        → AsyncOpenAI chat-completions call to a Llama-compatible
          endpoint (OpenRouter / Groq / Ollama) with JSON mode
        → Pydantic-validate the output → return StudyPlan

Why an OpenAI-compatible Llama endpoint?
Gemini's free tier was hitting RESOURCE_EXHAUSTED before we could
finish QA on the architecture. Llama 3.3 70B Instruct over an
OpenAI-compatible base URL (OpenRouter / Groq / Ollama) gives us
a generous-quota drop-in replacement without changing the prompt
or response contract. Swapping back to Gemini is a one-file change.
================================================================
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    BadRequestError,
)
from pydantic import ValidationError

from config import get_settings
from schemas.plan_ai import (
    GeneratePlanRequest,
    PlanPreferencesInput,
    PlanScheduleSlotInput,
    PlanTask,
    StudyPlan,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────

# Weekdays in the order the schedule store uses (Saudi work week).
# The plan is allowed to use Friday/Saturday too if the student's
# `dayOff` permits it — those days are simply free of fixed
# lectures, so the full 7-day list is what the model schedules against.
WEEK_DAYS_AR = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
]

# English → Arabic day map (preferences `dayOff` is English).
DAY_EN_TO_AR = {
    "sunday": "الأحد",
    "monday": "الإثنين",
    "tuesday": "الثلاثاء",
    "wednesday": "الأربعاء",
    "thursday": "الخميس",
    "friday": "الجمعة",
    "saturday": "السبت",
}

# Window of allowed study hours (24-hour). Outside this, the model
# is instructed not to schedule.
STUDY_DAY_START = "06:00"
STUDY_DAY_END = "23:00"

# Friendly Arabic blurbs for the preference enums — fed directly
# into the prompt so the model can quote the student's preferences
# back at them inside `reason` strings.
LEARNING_STYLE_AR = {
    "visual": "بصري (مخططات ورسوم)",
    "auditory": "سمعي (محاضرات وملخصات صوتية)",
    "kinesthetic": "حركي (تطبيق عملي وتمارين)",
    "reading": "قرائي/كتابي (ملخصات مكتوبة)",
}

ENERGY_PEAK_AR = {
    "morning": "صباحاً (6 ص – 12 ظهراً)",
    "afternoon": "ظهراً وعصراً (12 ظهراً – 6 مساءً)",
    "night": "مساءً وليلاً (9 م – 2 ص)",
}

TASK_STRATEGY_AR = {
    "eat_frog": "ابدأ بالمهام الصعبة أولاً (أكل الضفدع)",
    "snowball": "ابدأ بالمهام السهلة أولاً لبناء الزخم (كرة الثلج)",
}


# ──────────────────────────────────────────────────────────────────
# Task quality guardrails (anti-hallucination)
# ──────────────────────────────────────────────────────────────────

# Hard ceiling on any single task. Violates Pomodoro discipline above
# this. If the model needs more, it MUST split into "الجزء 1" / "الجزء 2".
MAX_TASK_MINUTES = 50

# Words the model is strictly forbidden from using in task titles. They
# produce the lazy "Review Chapter 1" pattern we keep seeing and trick the
# model into inventing syllabus numbers that don't exist. Keep this list
# small and surgical — overly broad bans force evasive paraphrasing.
FORBIDDEN_TITLE_WORDS_AR = ["الفصل", "الوحدة", "شابتر", "درس", "الباب"]

# Heuristic: course names containing any of these markers are treated as
# practical/project work and get a distinct task vocabulary.
PROJECT_COURSE_MARKERS_AR = [
    "مشروع",
    "تخرج",
    "graduation",
    "project",
    "capstone",
    "تدريب",
    "internship",
]


# ──────────────────────────────────────────────────────────────────
# Free-window precomputation
# ──────────────────────────────────────────────────────────────────


def _to_minutes(hhmm: str) -> int:
    """'HH:MM' → minutes-since-midnight. Returns -1 on bad input."""
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return -1


def _to_hhmm(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _free_windows_by_day(
    busy: list[PlanScheduleSlotInput],
    min_chunk_minutes: int,
) -> dict[str, list[dict[str, str]]]:
    """For each weekday, return a list of {start, end} windows during
    which the student has at least `min_chunk_minutes` of contiguous
    free time inside [STUDY_DAY_START, STUDY_DAY_END].
    """
    day_start = _to_minutes(STUDY_DAY_START)
    day_end = _to_minutes(STUDY_DAY_END)

    # Group busy slots by day.
    by_day: dict[str, list[tuple[int, int]]] = {d: [] for d in WEEK_DAYS_AR}
    for slot in busy:
        s = _to_minutes(slot.start_time)
        e = _to_minutes(slot.end_time)
        if s < 0 or e < 0 or e <= s:
            continue
        if slot.day in by_day:
            by_day[slot.day].append((s, e))

    out: dict[str, list[dict[str, str]]] = {}
    for day, intervals in by_day.items():
        intervals.sort()
        # Merge overlapping/adjacent intervals.
        merged: list[tuple[int, int]] = []
        for s, e in intervals:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))

        # Walk gaps between merged busy intervals.
        windows: list[dict[str, str]] = []
        cursor = day_start
        for s, e in merged:
            if s - cursor >= min_chunk_minutes:
                windows.append({"start": _to_hhmm(cursor), "end": _to_hhmm(s)})
            cursor = max(cursor, e)
        if day_end - cursor >= min_chunk_minutes:
            windows.append({"start": _to_hhmm(cursor), "end": _to_hhmm(day_end)})

        out[day] = windows
    return out


# ──────────────────────────────────────────────────────────────────
# Post-LLM safety net (defense-in-depth)
# ──────────────────────────────────────────────────────────────────
# The hardened system prompt is the primary defense, but Llama 3.3 70B
# still drifts (lazy "مراجعة الفصل 1" titles, 60/75/90-min blocks). The
# sanitizer below intercepts every parsed task and:
#
#   • Scrubs titles that contain any FORBIDDEN_TITLE_WORDS_AR — the
#     offending title is replaced with a generic safe one referencing
#     the course name. No LLM retry (saves time + API quota).
#
#   • Enforces the MAX_TASK_MINUTES (or per-student effective) cap.
#     Overlong tasks are split into contiguous "الجزء 1 / الجزء 2 / …"
#     parts with short-break gaps; if splitting can't be safely sized
#     (bad time field), we fall back to a hard cap.
#
# Every intervention emits a `logger.warning` so we can monitor drift
# rates over time without disrupting the user-facing flow.

# Cap how many parts one overlong task can split into. Keeps the task
# list sane when the LLM emits something wild like a 240-min block.
_MAX_SPLIT_PARTS = 4


def _title_has_forbidden_word(title: str) -> bool:
    """True if any blacklisted Arabic syllabus word appears in `title`."""
    if not title:
        return False
    return any(w in title for w in FORBIDDEN_TITLE_WORDS_AR)


def _fallback_title(task: PlanTask) -> str:
    """Generic safe title built from the course name + a neutral verb.

    Uses courseName when present (most Arabic-rendered), else courseCode,
    else a defensive last resort so a missing field never crashes the run.
    """
    course = (task.courseName or "").strip() or (task.courseCode or "").strip() or "هذه المادة"
    return f"جلسة مذاكرة وتطبيق عملي لمادة {course}"


def _split_overlong_task(
    task: PlanTask,
    effective_max: int,
    short_break: int,
) -> list[PlanTask]:
    """Split a task whose `durationMinutes` exceeds `effective_max` into
    ≤ `_MAX_SPLIT_PARTS` contiguous parts, each ≤ `effective_max` minutes.

    Time math:
        part_i.suggestedTime = original_start + (i-1) * (per_part + short_break)

    If `task.durationMinutes <= effective_max`, returns the task unchanged
    in a single-element list (caller can extend uniformly).

    If the original `suggestedTime` is malformed (can't compute follow-up
    starts), we fall back to a hard cap on the original task — degraded
    but safe.
    """
    duration = task.durationMinutes
    if duration <= effective_max:
        return [task]

    # ceil(duration / effective_max), capped so we never produce more
    # than _MAX_SPLIT_PARTS rows. The cap means very long LLM-emitted
    # tasks (e.g., 240 min) lose some planned content in exchange for
    # not flooding the user's plan with 8 fragments.
    parts_needed = min(_MAX_SPLIT_PARTS, max(2, -(-duration // effective_max)))
    # Evenly distribute, but never below the schema minimum (15) nor
    # above the effective cap. Pydantic's PlanTask.durationMinutes has
    # ge=15, le=240 — staying inside that range avoids re-validation.
    per_part = min(effective_max, max(15, -(-duration // parts_needed)))

    start_minutes = _to_minutes(task.suggestedTime)
    if start_minutes < 0:
        # Malformed time → can't safely compute Part 2's start. Hard-cap
        # the original instead of risking misaligned follow-ups.
        return [task.model_copy(update={"durationMinutes": effective_max})]

    parts: list[PlanTask] = []
    cursor = start_minutes
    for i in range(parts_needed):
        parts.append(
            task.model_copy(
                update={
                    "title": f"{task.title} — الجزء {i + 1}",
                    "durationMinutes": per_part,
                    "suggestedTime": _to_hhmm(cursor),
                }
            )
        )
        cursor += per_part + short_break
    return parts


def _sanitize_plan(
    plan: StudyPlan,
    prefs: PlanPreferencesInput,
) -> tuple[StudyPlan, dict[str, int]]:
    """Apply the title-blacklist + duration-cap safety net to every task.

    Returns the sanitized plan and a counters dict for observability.
    Always returns a valid StudyPlan — the sanitizer never raises.
    """
    effective_max = min(prefs.pomodoroFocus, MAX_TASK_MINUTES)
    short_break = prefs.pomodoroShortBreak

    counters = {
        "titles_scrubbed": 0,
        "tasks_split": 0,
        "tasks_capped": 0,
    }

    new_tasks: list[PlanTask] = []
    for task in plan.tasks:
        # ── A. Title blacklist scrub ──────────────────────────────
        if _title_has_forbidden_word(task.title):
            old_title = task.title
            task = task.model_copy(update={"title": _fallback_title(task)})
            counters["titles_scrubbed"] += 1
            logger.warning(
                "[plan_ai sanitizer] forbidden word in title — scrubbed: %r → %r (course=%s)",
                old_title,
                task.title,
                task.courseCode,
            )

        # ── B. Pomodoro duration enforcement ──────────────────────
        if task.durationMinutes > effective_max:
            original_duration = task.durationMinutes
            split = _split_overlong_task(task, effective_max, short_break)
            if len(split) > 1:
                counters["tasks_split"] += 1
                logger.warning(
                    "[plan_ai sanitizer] %d-min task split into %d × ≤%d-min parts "
                    "(course=%s, title=%r)",
                    original_duration,
                    len(split),
                    effective_max,
                    task.courseCode,
                    task.title,
                )
            else:
                # _split_overlong_task fell back to hard-cap (bad time).
                counters["tasks_capped"] += 1
                logger.warning(
                    "[plan_ai sanitizer] %d-min task hard-capped at %d "
                    "(course=%s, suggestedTime=%r — could not split safely)",
                    original_duration,
                    effective_max,
                    task.courseCode,
                    task.suggestedTime,
                )
            new_tasks.extend(split)
        else:
            new_tasks.append(task)

    sanitized = plan.model_copy(update={"tasks": new_tasks})
    return sanitized, counters


# ──────────────────────────────────────────────────────────────────
# Prompt construction
# ──────────────────────────────────────────────────────────────────


# A literal copy of the schema we want the model to emit. Keeping it
# as a string (not introspected from Pydantic) keeps the prompt small
# and avoids leaking Python types into the model's mental model.
_RESPONSE_SCHEMA_DOC = """{
  "overview": "string (Arabic, 2 sentences max — what the week focuses on)",
  "tasks": [
    {
      "title": "string (Arabic, action verb + concrete target)",
      "courseCode": "string (must match a code from courses[])",
      "courseName": "string (Arabic, from courses[])",
      "durationMinutes": number (must equal pomodoroFocus, or 2x/3x of it for deep sessions),
      "suggestedDay": "string (one of: الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت)",
      "suggestedTime": "string (HH:MM 24-hour, inside an available_windows entry for that day)",
      "priority": "high" | "medium" | "low",
      "reason": "string (Arabic, ONE sentence: why this day/time was picked, referencing the student's preferences)"
    }
  ],
  "dailySummary": [
    {
      "day": "string (Arabic day name)",
      "summary": "string (Arabic, ONE sentence: what the day focuses on)",
      "totalMinutes": number (sum of durationMinutes for that day's tasks)
    }
  ]
}"""


def _build_system_prompt(req: GeneratePlanRequest) -> str:
    prefs = req.preferences
    day_off_ar = DAY_EN_TO_AR.get(prefs.dayOff, "")
    day_off_clause = (
        f"لا تجدول أي مهمة يوم {day_off_ar} — إنه يوم الراحة المفضل للطالب."
        if prefs.dayOff != "none"
        else "الطالب لم يحدد يوم راحة — وزّع المهام على الأسبوع بحكمة."
    )

    # Effective per-task ceiling. Never let pomodoroFocus push a single
    # task above the hard 50-minute Pomodoro discipline ceiling — if the
    # student configured 60-min focus, the model still splits work into
    # ≤50-min chunks ("الجزء 1" / "الجزء 2") rather than emitting one
    # 60-min block.
    effective_max = min(prefs.pomodoroFocus, MAX_TASK_MINUTES)
    forbidden_list_ar = "، ".join(f'"{w}"' for w in FORBIDDEN_TITLE_WORDS_AR)

    # Sprint-5 Bug #14 — Smart Task Rollover.
    # Build a backlog block if the request includes uncompleted tasks
    # from the previous week. Each entry is rendered as a short bullet
    # the model can quote in the strategic note. We surface the courses
    # by name so the note reads naturally — "تم ترحيل مراجعة الجبر..."
    # and not "...مهمة #3".
    backlog_block = ""
    backlog_courses_clause = ""
    if req.backlog:
        bullets = "\n".join(
            f"- «{b.title}» (مادة {b.courseName or b.courseCode or '—'}, "
            f"{b.durationMinutes} دقيقة, كانت مجدولة {b.suggestedDay} {b.suggestedTime}, "
            f"أولوية {b.priority})"
            for b in req.backlog
        )
        # Distinct, ordered list of course display names for the note.
        seen: list[str] = []
        for b in req.backlog:
            label = (b.courseName or b.courseCode or "").strip()
            if label and label not in seen:
                seen.append(label)
        courses_phrase = "، ".join(seen) if seen else "المواد السابقة"
        backlog_courses_clause = courses_phrase
        backlog_block = (
            "\n📥 متأخرات الأسبوع الماضي (BACKLOG FROM PAST WEEK):\n"
            f"{bullets}\n"
            "تعليمات صارمة:\n"
            "1. أعد توزيع هذه المهام داخل أسبوع الخطة الجديد كمهام جديدة "
            "(لا تنسخها بنفس اليوم/الوقت القديم).\n"
            "2. أعطها أولوية high افتراضياً ما لم تكن أولويتها الأصلية أقل بشكل واضح.\n"
            "3. اخصم وقتها من ساعات الفراغ المتاحة لهذا الأسبوع (قد يصبح "
            "الجدول أكثف قليلاً — هذا متعمَّد).\n"
            "4. في حقل `overview` يجب أن تضيف جملة بهذا المعنى بالضبط: "
            f'"تم ترحيل مراجعة {courses_phrase} من الأسبوع الماضي، جدولك '
            'هذا الأسبوع سيكون أكثف قليلاً لتعويض الفجوة." '
            "(يمكنك إعادة صياغتها بمرونة لكن يجب أن تذكر صراحةً اسم المواد المرحَّلة "
            "وأن الجدول أكثف.)\n"
        )

    return f"""أنت مستشار أكاديمي خبير لطلاب جامعة أم القرى (UQU)، متخصص في تصميم خطط مذاكرة أسبوعية مخصصة.

🎯 مهمتك:
بناء خطة مذاكرة لأسبوع كامل (الأحد إلى السبت) لطالب جامعي بناءً على المواد، الجدول، والتفضيلات الشخصية المرفقة في رسالة المستخدم.

⚙️ التفضيلات الشخصية للطالب:
- نمط التعلم: {LEARNING_STYLE_AR.get(prefs.learningStyle, prefs.learningStyle)}
- وقت ذروة الطاقة: {ENERGY_PEAK_AR.get(prefs.energyPeak, prefs.energyPeak)}
- استراتيجية المهام: {TASK_STRATEGY_AR.get(prefs.taskStrategy, prefs.taskStrategy)}
- مدة جلسة التركيز (بومودورو): {prefs.pomodoroFocus} دقيقة
- استراحة قصيرة: {prefs.pomodoroShortBreak} دقيقة، استراحة طويلة: {prefs.pomodoroLongBreak} دقيقة

🛑 قواعد صارمة (مخالفة أي منها = فشل):
1. أخرج JSON صالحاً تماماً، يطابق المخطط أدناه فقط — بدون أي نص قبل أو بعد، بدون markdown، بدون code fences.
2. {day_off_clause}
3. ضع المهام عالية الأولوية (priority="high") داخل نافذة وقت ذروة الطاقة للطالب.
4. استراتيجية ترتيب اليوم: {TASK_STRATEGY_AR.get(prefs.taskStrategy, prefs.taskStrategy)}.
5. كل مهمة يجب أن تكون داخل نافذة من available_windows لنفس اليوم — لا تجدول داخل أوقات الجدول المشغولة.

6. ⏱️ حدود البومودورو الصارمة:
   - durationMinutes لكل مهمة ≤ {effective_max} دقيقة. ممنوع تماماً تجاوز الـ50 دقيقة في مهمة واحدة.
   - لا تستخدم 60 ولا 75 ولا 90 دقيقة أبداً — هذه أرقام مرفوضة قطعياً.
   - إذا احتاجت المادة إلى وقت أطول من {effective_max} دقيقة في يوم واحد، قسّمها إلى مهمتين أو أكثر بأسماء مختلفة وأوقات بداية متتالية تفصلها استراحة (مثال: مهمة "تطبيق عملي على REST APIs — الجزء 1" الساعة 19:00 لمدة {effective_max} دقيقة، ثم "تطبيق عملي على REST APIs — الجزء 2" الساعة {(_to_minutes('19:00') + effective_max + prefs.pomodoroShortBreak) // 60:02d}:{(_to_minutes('19:00') + effective_max + prefs.pomodoroShortBreak) % 60:02d} لمدة {effective_max} دقيقة).
   - القيمة الافتراضية الموصى بها = {effective_max} دقيقة. يمكنك استخدام قيم أقل (مثل 25 أو 30) إذا كانت المهمة بسيطة.

7. غطّ كل مادة من courses[] بـ 2–3 جلسات على الأقل خلال الأسبوع. لا تتجاهل أي مادة.
8. كل courseCode في tasks[] يجب أن يطابق رمزاً موجوداً في courses[] (تطابق نصي حرفي).
9. عبارة "reason" يجب أن تذكر صراحةً سبب اختيار اليوم/الوقت بربطه بتفضيلات الطالب (الذروة الذهنية، يوم الراحة، نمط التعلم، أو مستوى الصعوبة).

10. ✍️ جودة العنوان (title):
    - عربية فصحى مبسطة، ودودة لكن مهنية. عناوين قصيرة محفّزة بفعل أمر واضح.
    - أمثلة جيدة: "تلخيص المفاهيم الأساسية باستخدام الاسترجاع النشط"، "حل تمارين تطبيقية على المخططات الانسيابية"، "بناء خريطة ذهنية للمصطلحات الجديدة"، "تطبيق عملي مع كتابة الكود خطوة بخطوة".

11. 🚫 قائمة المحظورات الصارمة (Blacklist):
    - ممنوع منعاً باتاً استخدام أي من هذه الكلمات في حقل title: {forbidden_list_ar}.
    - ممنوع اختراع أرقام تسلسلية للمنهج (لا "الأول"، "الثاني"، "الثالث"، ولا أرقام عددية مثل "1" أو "2" تدل على ترقيم منهجي).
    - السبب: لا تعرف فعلياً ما هي فصول/وحدات الكتاب؛ التظاهر بمعرفتها هلوسة. ركّز على الأفعال والمفاهيم بدل الترقيم.
    - عناوين خاطئة يجب تجنبها: "مراجعة الفصل الأول"، "حل تمارين الفصل 3"، "خريطة ذهنية للوحدة 2"، "ملخص الباب الخامس".

12. 🧠 الوعي بطبيعة المادة (Course-Type Awareness):
    حلّل اسم المادة قبل توليد المهام، ثم اختر مفردات المهام وفقاً للنوع:

    أ) مادة مشروع/تطبيقية (يحتوي اسمها على: "مشروع"، "تخرج"، "تدريب"، "Project"، "Graduation"، "Capstone"، "Internship"):
       • المهام عملية بطبيعتها. أمثلة مقبولة:
         - "برمجة وتطوير ميزة تسجيل الدخول في النظام"
         - "كتابة قسم منهجية البحث في التوثيق (Documentation)"
         - "تحضير شرائح العرض التقديمي (Pitch Deck)"
         - "البحث عن مراجع علمية حديثة وتلخيصها"
         - "اختبار النظام وتسجيل ملاحظات الـQA"
       • ممنوع تماماً صياغة مهام نظرية مثل "مراجعة المفاهيم" لمادة مشروع.

    ب) مادة نظرية/علوم حاسب (مثل: الحوسبة السحابية، قواعد البيانات، الذكاء الاصطناعي، هياكل البيانات):
       • أمثلة مقبولة:
         - "مراجعة المفاهيم المعمارية الأساسية"
         - "تطبيق عملي على الكود مع كتابة الأمثلة بنفسك"
         - "تلخيص المحاضرات السابقة عبر الخرائط الذهنية"
         - "حل تمارين نمطية مع تتبع الخطوات صوتياً"
         - "شرح المفهوم بصوتك كأنك تُدرّس زميلاً (Feynman)"

    ج) مادة إنسانية/لغوية (إذا واضح من الاسم): استخدم أفعالاً مثل "قراءة نقدية"، "كتابة فقرة تحليلية"، "مناقشة حالة دراسية"، بدون أي ترقيم منهجي.

📋 المخطط المطلوب (JSON Schema):
{_RESPONSE_SCHEMA_DOC}

✨ مثال مرجعي لمهمة مثالية (التزم بهذه الجودة):
{{
  "title": "تلخيص المفاهيم الأساسية باستخدام الاسترجاع النشط",
  "duration_minutes": 30,
  "reason": "لأن مادة الحوسبة السحابية تتطلب حفظاً وفهماً عميقاً للمصطلحات، وتناسب طاقتك العالية."
}}

ملاحظة: المثال أعلاه يوضّح فقط جودة العنوان والمدة والسبب — في إخراجك الفعلي استخدم الحقول الكاملة من المخطط (durationMinutes بهذا التهجي بالضبط، مع courseCode و courseName و suggestedDay و suggestedTime و priority).
{backlog_block}
⚠️ ملاحظة نهائية لنماذج Llama: أعد كائن JSON خام فقط، يبدأ بـ {{ وينتهي بـ }}. لا تضع ```json ولا أي شرح قبل أو بعد. أي نص خارج JSON يُعتبر إخفاقاً. أي عنوان يحتوي إحدى الكلمات المحظورة = إخفاق. أي durationMinutes > 50 = إخفاق.
"""


def _build_user_content(req: GeneratePlanRequest, free_windows: dict) -> str:
    """Compact JSON payload the model reads as the user turn. Keeping it
    JSON (not prose) reduces the chance of the model getting clever
    with paraphrased preferences."""

    user_payload = {
        "student": {
            "name": req.studentName,
            "currentGpa": req.currentGpa,
            "targetGpa": req.targetGpa,
        },
        "courses": [c.model_dump() for c in req.courses],
        "busy_schedule": [
            {
                "day": s.day,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "course_code": s.course_code,
                "type": s.type,
            }
            for s in req.schedule
        ],
        "available_windows": free_windows,
        "preferences": req.preferences.model_dump(),
        "constraints": {
            "earliest_time": STUDY_DAY_START,
            "latest_time": STUDY_DAY_END,
            "valid_days": WEEK_DAYS_AR,
        },
    }
    return (
        "هذه بيانات الطالب لهذا الأسبوع. ابنِ الخطة وفق القواعد، وأعد JSON خاماً فقط:\n\n"
        + json.dumps(user_payload, ensure_ascii=False, indent=2)
    )


# ──────────────────────────────────────────────────────────────────
# LLM execution layer (Llama via OpenAI-compatible endpoint)
# ──────────────────────────────────────────────────────────────────


def _extract_json_object(text: str) -> Any:
    """Parse a model response into a dict, tolerating a few common
    deviations from strict JSON output:

      • leading/trailing whitespace
      • ```json … ``` or plain ``` fences (some Llama tunes still emit them)
      • a short preamble like "Sure, here is the JSON:" before the object

    Raises ValueError if no JSON object/array can be recovered.
    """
    s = (text or "").strip()
    if not s:
        raise ValueError("empty response from model")

    # Strip markdown code fences if present.
    if "```json" in s:
        s = s.split("```json", 1)[1].split("```", 1)[0].strip()
    elif s.startswith("```"):
        s = s.strip("`").lstrip().lstrip("json").lstrip()
        if "```" in s:
            s = s.split("```", 1)[0].strip()

    # Fast path — the response is a clean JSON value.
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    # Slice from the first '{' to the last '}' to skip preambles.
    start_obj = s.find("{")
    end_obj = s.rfind("}")
    if start_obj != -1 and end_obj > start_obj:
        try:
            return json.loads(s[start_obj : end_obj + 1])
        except json.JSONDecodeError:
            pass

    # Last resort — accept a bare array if the model emitted one.
    start_arr = s.find("[")
    end_arr = s.rfind("]")
    if start_arr != -1 and end_arr > start_arr:
        return json.loads(s[start_arr : end_arr + 1])

    raise ValueError(f"could not extract JSON from response: {s[:200]}")


async def _call_openai_plan(system_prompt: str, user_content: str) -> Any:
    """OpenAI fallback when LLAMA_API_KEY is unset (POST /api/plan/generate-ai only)."""
    settings = get_settings()
    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        timeout=90.0,
        max_retries=1,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    async def _do_call(use_json_mode: bool) -> str:
        kwargs: dict[str, Any] = {
            "model": settings.OPENAI_MODEL,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 6144,
        }
        if use_json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        completion = await client.chat.completions.create(**kwargs)  # type: ignore[arg-type]
        if not completion.choices:
            raise HTTPException(
                status_code=502,
                detail="OpenAI returned no choices.",
            )
        msg = completion.choices[0].message
        text = (msg.content or "").strip()
        if not text:
            raise HTTPException(
                status_code=502,
                detail="OpenAI returned an empty message.",
            )
        return text

    try:
        try:
            raw_text = await _do_call(use_json_mode=True)
        except BadRequestError as exc:
            err_msg = (str(exc) or "").lower()
            if "response_format" in err_msg or "json_object" in err_msg:
                logger.info(
                    "OpenAI rejected response_format — retrying without JSON mode."
                )
                raw_text = await _do_call(use_json_mode=False)
            else:
                raise
    except APITimeoutError as exc:
        logger.warning("OpenAI upstream timeout: %s", exc)
        raise HTTPException(status_code=502, detail="انتهت مهلة الاتصال بمزود الذكاء الاصطناعي.") from exc
    except APIConnectionError as exc:
        logger.warning("OpenAI upstream connection error: %s", exc)
        raise HTTPException(status_code=502, detail="تعذّر الاتصال بمزود الذكاء الاصطناعي.") from exc
    except APIStatusError as exc:
        detail = f"OpenAI upstream error: {exc.status_code} {getattr(exc, 'message', '')}".strip()
        logger.warning(detail)
        status = 429 if exc.status_code == 429 else 502
        raise HTTPException(status_code=status, detail=detail) from exc
    except APIError as exc:
        logger.error("OpenAI API error: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"خطأ من مزود الذكاء الاصطناعي: {exc}") from exc
    finally:
        try:
            await client.close()
        except Exception:
            pass

    try:
        return _extract_json_object(raw_text)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.warning("OpenAI returned malformed JSON: %s | text=%s", exc, raw_text[:600])
        raise HTTPException(
            status_code=502,
            detail="استجابة الذكاء الاصطناعي ليست JSON صالحاً.",
        ) from exc


async def _call_llama(system_prompt: str, user_content: str) -> Any:
    """Plan LLM call — Llama-compatible API, or OpenAI when Llama key is missing.

    Tries JSON mode first (`response_format={"type": "json_object"}`) for Llama.
    A handful of OpenAI-compatible providers (or older Ollama builds)
    reject that field with a 400 — in that case we transparently retry
    without it. The prompt already strictly forbids non-JSON output,
    so quality is acceptable either way.

    Returns the parsed JSON object/array. Raises HTTPException on
    upstream failure so the router can surface a clean status code.
    """
    settings = get_settings()
    if not settings.LLAMA_API_KEY:
        if settings.OPENAI_API_KEY:
            logger.info(
                "[plan_ai] LLAMA_API_KEY missing — using OPENAI_API_KEY fallback."
            )
            return await _call_openai_plan(system_prompt, user_content)
        raise HTTPException(
            status_code=503,
            detail=(
                "Plan generation requires LLAMA_API_KEY or OPENAI_API_KEY on the server."
            ),
        )

    # The OpenAI SDK enforces that the API key not be an empty string;
    # Ollama (which ignores auth) is happy with any placeholder.
    client = AsyncOpenAI(
        api_key=settings.LLAMA_API_KEY,
        base_url=settings.LLAMA_BASE_URL,
        timeout=90.0,
        max_retries=1,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    async def _do_call(use_json_mode: bool) -> str:
        kwargs: dict[str, Any] = {
            "model": settings.LLAMA_MODEL,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 6144,
        }
        if use_json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        completion = await client.chat.completions.create(**kwargs)  # type: ignore[arg-type]
        if not completion.choices:
            raise HTTPException(
                status_code=502,
                detail="Llama returned no choices.",
            )
        msg = completion.choices[0].message
        text = (msg.content or "").strip()
        if not text:
            raise HTTPException(
                status_code=502,
                detail="Llama returned an empty message.",
            )
        return text

    try:
        try:
            raw_text = await _do_call(use_json_mode=True)
        except BadRequestError as exc:
            # Some providers (older Ollama, certain OpenRouter models)
            # reject response_format with a 400. Retry plainly — the
            # prompt itself enforces JSON-only output.
            err_msg = (str(exc) or "").lower()
            if "response_format" in err_msg or "json_object" in err_msg:
                logger.info("Llama provider rejected response_format — retrying without JSON mode.")
                raw_text = await _do_call(use_json_mode=False)
            else:
                raise
    except APITimeoutError as exc:
        logger.warning("Llama upstream timeout: %s", exc)
        raise HTTPException(status_code=502, detail="انتهت مهلة الاتصال بمزود الذكاء الاصطناعي.") from exc
    except APIConnectionError as exc:
        logger.warning("Llama upstream connection error: %s", exc)
        raise HTTPException(status_code=502, detail="تعذّر الاتصال بمزود الذكاء الاصطناعي.") from exc
    except APIStatusError as exc:
        detail = f"Llama upstream error: {exc.status_code} {getattr(exc, 'message', '')}".strip()
        logger.warning(detail)
        # Map 429 / quota errors back to 429 so the frontend can show
        # a "rate-limited" UX; everything else surfaces as 502.
        status = 429 if exc.status_code == 429 else 502
        raise HTTPException(status_code=status, detail=detail) from exc
    except APIError as exc:
        logger.error("Llama API error: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"خطأ من مزود الذكاء الاصطناعي: {exc}") from exc
    finally:
        # AsyncOpenAI keeps an httpx client open under the hood;
        # close it explicitly so we don't leak sockets across requests.
        try:
            await client.close()
        except Exception:
            pass

    try:
        return _extract_json_object(raw_text)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.warning("Llama returned malformed JSON: %s | text=%s", exc, raw_text[:600])
        raise HTTPException(
            status_code=502,
            detail="استجابة الذكاء الاصطناعي ليست JSON صالحاً.",
        ) from exc


# ──────────────────────────────────────────────────────────────────
# Public entrypoint
# ──────────────────────────────────────────────────────────────────


async def generate_ai_study_plan(req: GeneratePlanRequest) -> dict[str, Any]:
    """Orchestrate the Llama call and validate the response.

    Raises HTTPException on:
        400 — empty courses list (caller should pre-validate too)
        429 — upstream rate limit (Llama provider)
        502 — Llama failure / invalid JSON / schema mismatch
        503 — neither LLAMA_API_KEY nor OPENAI_API_KEY configured
    """
    if not req.courses:
        raise HTTPException(
            status_code=400,
            detail="لا توجد مواد مسجّلة لتوليد الخطة. ارفع سجلك الأكاديمي أولاً.",
        )

    # The smallest free window we care about = one pomodoro session.
    # Anything shorter is too cramped for a useful study block.
    free_windows = _free_windows_by_day(
        req.schedule,
        min_chunk_minutes=req.preferences.pomodoroFocus,
    )

    system_prompt = _build_system_prompt(req)
    user_content = _build_user_content(req, free_windows)

    logger.info(
        "AI plan generate: courses=%d busy_slots=%d prefs=%s",
        len(req.courses),
        len(req.schedule),
        req.preferences.model_dump(),
    )

    raw = await _call_llama(system_prompt, user_content)

    # The model occasionally wraps the schema in `{ "plan": {...} }` or
    # emits a bare list — unwrap defensively.
    if isinstance(raw, dict) and "plan" in raw and isinstance(raw["plan"], dict):
        raw = raw["plan"]

    try:
        plan = StudyPlan.model_validate(raw)
    except ValidationError as exc:
        logger.warning("AI plan schema validation failed: %s | raw=%s", exc, str(raw)[:600])
        raise HTTPException(
            status_code=502,
            detail="استجابة الذكاء الاصطناعي لم تطابق الصيغة المتوقعة. حاول مرة أخرى.",
        ) from exc

    # ── Defense-in-depth: sanitize before recomputing daily totals ──
    # The prompt is the primary guard, but Llama still drifts. The
    # sanitizer rewrites blacklisted titles in place and splits any
    # task exceeding the Pomodoro cap into contiguous parts. We log
    # every intervention so we can monitor drift rates, but never
    # retry the LLM (saves time + API quota — the fixes are safe).
    plan, sanitize_counters = _sanitize_plan(plan, req.preferences)
    total_fixes = sum(sanitize_counters.values())
    if total_fixes > 0:
        logger.warning(
            "[plan_ai] sanitizer applied %d fix(es): scrubbed=%d split=%d capped=%d",
            total_fixes,
            sanitize_counters["titles_scrubbed"],
            sanitize_counters["tasks_split"],
            sanitize_counters["tasks_capped"],
        )

    # Post-validate: recompute totalMinutes per day from the SANITIZED
    # task list (split tasks change the per-day sum).
    sums: dict[str, int] = {}
    for t in plan.tasks:
        sums[t.suggestedDay] = sums.get(t.suggestedDay, 0) + t.durationMinutes
    for d in plan.dailySummary:
        d.totalMinutes = sums.get(d.day, 0)

    settings = get_settings()
    model_id = (
        settings.LLAMA_MODEL
        if settings.LLAMA_API_KEY
        else settings.OPENAI_MODEL
    )
    return {
        "plan": plan.model_dump(),
        "model": model_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
