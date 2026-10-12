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
    PlanScheduleSlotInput,
    StudyPlan,
)
from services.plan_task_placement import (
    AI_SESSION_DEFAULT,
    AI_SESSION_MAX,
    AI_SESSION_MIN,
    DAY_EN_TO_AR,
    STUDY_DAY_END,
    STUDY_DAY_START,
    WEEK_DAYS_AR,
    recompute_daily_summaries,
    repair_ai_task_placements,
    sanitize_ai_plan_tasks,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────

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
    "morning": "صباحاً (06:00–12:00)",
    "afternoon": "مساءً (12:00–18:00)",
    "night": "ليلاً (21:00–02:00)",
}

TASK_STRATEGY_AR = {
    "eat_frog": "ابدأ بالمهام الصعبة أولاً (أكل الضفدع)",
    "snowball": "ابدأ بالمهام السهلة أولاً لبناء الزخم (كرة الثلج)",
}


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
    energy_peak: str = "morning",
) -> dict[str, list[dict[str, str]]]:
    """For each weekday, return a list of {start, end} windows during
    which the student has at least `min_chunk_minutes` of contiguous
    free time inside [STUDY_DAY_START, STUDY_DAY_END].
    """
    day_start = _to_minutes(STUDY_DAY_START)
    day_end = (
        _to_minutes("23:59")
        if energy_peak == "night"
        else _to_minutes(STUDY_DAY_END)
    )

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

        # Night preference: 21:00–23:59 plus 00:00–02:00 review slots.
        if energy_peak == "night":
            evening_start = 21 * 60
            spans_evening = False
            for w in windows:
                s = _to_minutes(w.get("start", ""))
                e = _to_minutes(w.get("end", ""))
                if (
                    s >= 0
                    and e > s
                    and s <= evening_start
                    and e >= evening_start + min_chunk_minutes
                ):
                    spans_evening = True
                    break
            if not spans_evening:
                windows.append(
                    {"start": _to_hhmm(evening_start), "end": _to_hhmm(day_end)}
                )

            early_end = _to_minutes("02:00")
            if early_end - 0 >= min_chunk_minutes:
                early_blocked = [
                    (s, e)
                    for s, e in merged
                    if s < early_end and e > 0
                ]
                early_cursor = 0
                for s, e in sorted(early_blocked):
                    if s - early_cursor >= min_chunk_minutes:
                        windows.append(
                            {
                                "start": _to_hhmm(early_cursor),
                                "end": _to_hhmm(min(s, early_end)),
                            }
                        )
                    early_cursor = max(early_cursor, e)
                if early_end - early_cursor >= min_chunk_minutes:
                    windows.append(
                        {"start": _to_hhmm(early_cursor), "end": _to_hhmm(early_end)}
                    )

        out[day] = windows
    return out


def _energy_peak_windows_for_prompt(energy_peak: str) -> list[dict[str, str]]:
    """Human-readable peak bands for the LLM user payload."""
    labels = {
        "morning": [{"start": "06:00", "end": "12:00", "overflow": False}],
        "afternoon": [{"start": "12:00", "end": "18:00", "overflow": False}],
        "night": [
            {"start": "21:00", "end": "23:59", "overflow": False},
            {"start": "00:00", "end": "02:00", "overflow": False},
        ],
    }
    return labels.get(energy_peak, labels["morning"])


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
      "title": "string (Arabic REVIEW session only — must include «مراجعة» or «حل أسئلة ومراجعة»)",
      "courseCode": "string (must match a code from courses[])",
      "courseName": "string (Arabic, from courses[])",
      "durationMinutes": number (45–90, default 60),
      "suggestedDay": "string (one of: الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت)",
      "suggestedTime": "string (HH:MM 24-hour, inside preferred_study_window and available_windows)",
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

    peak_windows = _energy_peak_windows_for_prompt(prefs.energyPeak)

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
- نافذة الذروة المفضلة (preferred_study_window في رسالة المستخدم): {json.dumps(peak_windows, ensure_ascii=False)}

🛑 قواعد صارمة (مخالفة أي منها = فشل):
1. أخرج JSON صالحاً تماماً، يطابق المخطط أدناه فقط — بدون أي نص قبل أو بعد، بدون markdown، بدون code fences.
2. {day_off_clause}
3. كل مهمة = جلسة **مراجعة/مذاكرة** فقط. العنوان يجب أن يتضمن «مراجعة» أو «حل أسئلة ومراجعة».
4. ممنوع في العنوان: مشروع، واجب، اختبار، تدريب، pitch deck، برمجة ميزة، أو أي مهمة غير مراجعة.
5. ممنوع ترقيم المنهج (الفصل، الوحدة، الباب، شابتر، درس 1/2/3).
6. ضع المهام عالية الأولوية (priority="high") داخل preferred_study_window.
7. استراتيجية ترتيب اليوم: {TASK_STRATEGY_AR.get(prefs.taskStrategy, prefs.taskStrategy)}.
8. كل مهمة داخل available_windows لنفس اليوم — لا تداخل مع busy_schedule، ويفضّل ترك 60 دقيقة قبل/بعد كل محاضرة.
9. نوّع suggestedTime عبر الأيام — لا تضع كل الجلسات في نفس الساعة (مثلاً ليس كلها 08:00).
10. durationMinutes بين {AI_SESSION_MIN} و{AI_SESSION_MAX} (الافتراضي {AI_SESSION_DEFAULT}).
11. غطّ كل مادة من courses[] بجلستي مراجعة على الأقل (3 للمواد الصعبة difficulty=hard أو creditHours≥4).
12. لا تضع أكثر من 4 جلسات في يوم واحد. وزّع المواد على أيام مختلفة وتجنب تكرار نفس المادة متتالياً في نفس اليوم.
13. كل courseCode يطابق courses[] حرفياً. reason تربط الوقت بالذروة الذهنية أو الصعوبة.

✍️ أمثلة عناوين صحيحة:
- "مراجعة أساسيات الحوسبة السحابية"
- "مراجعة محاضرة الرسومات بالحاسب"
- "حل أسئلة ومراجعة مواضيع مختارة"

📋 المخطط المطلوب (JSON Schema):
{_RESPONSE_SCHEMA_DOC}

✨ مثال مرجعي:
{{
  "title": "مراجعة أساسيات الحوسبة السحابية",
  "durationMinutes": 60,
  "reason": "جلسة مراجعة في ذروة طاقتك الصباحية بعيداً عن محاضراتك."
}}

ملاحظة: استخدم الحقول الكاملة من المخطط (durationMinutes، courseCode، courseName، suggestedDay، suggestedTime، priority).
{backlog_block}
⚠️ أعد JSON خام فقط. أي عنوان بلا «مراجعة» = فشل. أي durationMinutes خارج {AI_SESSION_MIN}-{AI_SESSION_MAX} = فشل.
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
        "preferred_study_window": _energy_peak_windows_for_prompt(
            req.preferences.energyPeak
        ),
        "preferences": req.preferences.model_dump(),
        "constraints": {
            "earliest_time": STUDY_DAY_START,
            "latest_time": STUDY_DAY_END,
            "valid_days": WEEK_DAYS_AR,
            "session_duration_min": AI_SESSION_MIN,
            "session_duration_max": AI_SESSION_MAX,
            "session_duration_default": AI_SESSION_DEFAULT,
            "lecture_buffer_minutes": 60,
            "max_sessions_per_day": 4,
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
    """Main-provider fallback when LLAMA_API_KEY is unset (POST /api/plan/generate-ai only)."""
    from services.llm import make_llm_client

    settings = get_settings()
    client = make_llm_client(
        timeout=90.0,
        max_retries=1,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    async def _do_call(use_json_mode: bool) -> str:
        kwargs: dict[str, Any] = {
            "model": settings.llm_model,
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

        usage = getattr(completion, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
        completion_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
        total_tokens = getattr(usage, "total_tokens", 0) if usage else 0

        logger.info(
            "[plan_ai] cost_log | provider=openai | model=%s | prompt_tokens=%d | completion_tokens=%d | total_tokens=%d",
            settings.llm_model,
            prompt_tokens,
            completion_tokens,
            total_tokens,
        )

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


async def _call_plan_llm(system_prompt: str, user_content: str) -> Any:
    """Provider entrypoint for AI plan generation (Llama-compatible or OpenAI fallback)."""
    return await _call_llama(system_prompt, user_content)


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
        if settings.llm_api_key:
            logger.info(
                "[plan_ai] LLAMA_API_KEY missing — using %s fallback.", settings.ai_provider
            )
            return await _call_openai_plan(system_prompt, user_content)
        raise HTTPException(
            status_code=503,
            detail=(
                "Plan generation requires LLAMA_API_KEY or an AI_PROVIDER key on the server."
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

        usage = getattr(completion, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
        completion_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
        total_tokens = getattr(usage, "total_tokens", 0) if usage else 0

        logger.info(
            "[plan_ai] cost_log | provider=llama | model=%s | prompt_tokens=%d | completion_tokens=%d | total_tokens=%d",
            settings.LLAMA_MODEL,
            prompt_tokens,
            completion_tokens,
            total_tokens,
        )

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

    free_windows = _free_windows_by_day(
        req.schedule,
        min_chunk_minutes=AI_SESSION_MIN,
        energy_peak=req.preferences.energyPeak,
    )

    system_prompt = _build_system_prompt(req)
    user_content = _build_user_content(req, free_windows)

    logger.info(
        "AI plan generate: courses=%d busy_slots=%d prefs=%s",
        len(req.courses),
        len(req.schedule),
        req.preferences.model_dump(),
    )

    raw = await _call_plan_llm(system_prompt, user_content)

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

    courses_by_code = {c.code: c for c in req.courses}
    plan, sanitize_counters = sanitize_ai_plan_tasks(plan, courses_by_code)
    if sum(sanitize_counters.values()) > 0:
        logger.warning(
            "[plan_ai] AI sanitizer: titles_rewritten=%d durations_adjusted=%d",
            sanitize_counters["titles_rewritten"],
            sanitize_counters["durations_adjusted"],
        )

    plan, placement_counters = repair_ai_task_placements(plan, req, free_windows)
    if sum(placement_counters.values()) > 0:
        logger.info(
            "[plan_ai] placement repair: moved=%d unplaced_kept=%d",
            placement_counters["tasks_moved"],
            placement_counters["tasks_unplaced_kept"],
        )

    plan = recompute_daily_summaries(plan)

    settings = get_settings()
    model_id = (
        settings.LLAMA_MODEL
        if settings.LLAMA_API_KEY
        else settings.llm_model
    )
    return {
        "plan": plan.model_dump(),
        "model": model_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
