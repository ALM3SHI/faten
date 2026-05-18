"""
================================================================
UQU Schedule Vision Extractor — Gemini Multimodal
================================================================
After 12 failed attempts at local pdf.js geometric parsing, we
admit defeat on the UQU schedule PDF format. Arabic glyph
encoding in those exports is mangled (presentation forms,
hidden bidi controls, merged cells, hamza inconsistencies), so
no amount of regex/coordinate gymnastics extracts every course.

This module flips the strategy:
  • Hand the raw PDF bytes to Gemini multimodal (v1beta).
  • The model "sees" the visual table — exactly what a human
    would when they open the PDF — and emits structured JSON.

The chat agent (NVIDIA NIM) and the transcript Geometric parser
(pdfjs) are unchanged. Vision is used ONLY here, ONLY for the
schedule's complex Arabic table.

Failure modes raise typed exceptions so the router maps cleanly:
    ScheduleVisionReadError → 400 (file is corrupt / not a PDF)
    ScheduleVisionAIError   → 502 (Gemini failure or bad JSON)
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from services.gemini import call_gemini

logger = logging.getLogger(__name__)


# ── User-supplied system prompt (verbatim + a few strict guardrails) ──
SYSTEM_PROMPT = """You are an Arabic university schedule extractor. Look at this schedule image/PDF.
Extract all courses and return EXACTLY this strict JSON format:
{
  "schedule": [
    {
      "course_code": "CS4216",
      "course_name": "الطرق العلمية",
      "day": "الثلاثاء",
      "start_time": "08:00",
      "end_time": "08:50",
      "type": "نظري"
    }
  ]
}

Do not include any markdown formatting outside the JSON.

Strict formatting rules — output is rejected unless these hold:
  • `day` MUST be exactly one of these five Arabic strings (no synonyms,
    no Latin transliteration, no diacritics):
        "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"
  • `start_time` and `end_time` MUST be 24-hour "HH:MM" zero-padded
    (e.g. "08:00", "13:50"). UQU lectures typically start on the hour
    and end at :50 — use that as a sanity check when the visual
    boundaries are ambiguous.
  • `type` MUST be exactly "نظري" (lecture) or "عملي" (lab/practical).
  • Keep `course_name` in Arabic exactly as it appears on the schedule.
    Do not translate or romanize.
  • A course with both a lecture AND a lab gets TWO separate entries
    with their own day/time/type.
  • Skip headers, prayer breaks ("صلاة"), recess rows ("استراحة"),
    and any cell that is not an actual class meeting.
  • Do NOT invent classes that aren't visible in the document.

You may also include optional `room` and `building` fields per slot if
they're clearly visible. Omit them otherwise.
"""

# Real UQU schedules are < 500 KB. Anything bigger is almost certainly
# the wrong file or a scanned-image PDF we'd rather reject up front.
MAX_PDF_BYTES = 10 * 1024 * 1024

# Vision-mode Gemini calls can be slow on large PDFs and rich tables.
GEMINI_TIMEOUT_SECONDS = 90.0
GEMINI_MAX_OUTPUT_TOKENS = 4096  # ~30 slots fits comfortably

# Whitelist for output sanitization.
VALID_DAYS = {"الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"}

# Common spelling variants → canonical form (the prompt asks for the
# canonical forms but real models drift, so we coerce defensively).
DAY_ALIASES = {
    "الأحد":    "الأحد",
    "الاحد":    "الأحد",
    "الإثنين": "الإثنين",
    "الاثنين":  "الإثنين",
    "الثلاثاء": "الثلاثاء",
    "الأربعاء": "الأربعاء",
    "الاربعاء": "الأربعاء",
    "الخميس":   "الخميس",
    "Sunday":    "الأحد",
    "Monday":    "الإثنين",
    "Tuesday":   "الثلاثاء",
    "Wednesday": "الأربعاء",
    "Thursday":  "الخميس",
}

TYPE_ALIASES = {
    "نظري":      "نظري",
    "محاضرة":   "نظري",
    "lecture":   "نظري",
    "theory":    "نظري",
    "عملي":      "عملي",
    "تطبيقي":  "عملي",
    "lab":       "عملي",
    "laboratory":"عملي",
    "practical": "عملي",
}


# ── Typed exceptions (router maps these to HTTP codes) ──────────────────
class ScheduleVisionReadError(Exception):
    """File is unreadable / not a PDF."""


class ScheduleVisionAIError(Exception):
    """Gemini multimodal call failed or response unparseable."""


# ── Public entrypoint ──────────────────────────────────────────────────
async def analyze_schedule_vision(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Send a schedule PDF (raw bytes) to Gemini multimodal and return:
        { "schedule": [ {course_code, course_name, day, start_time, end_time, type, ...}, ... ] }

    Raises:
        ScheduleVisionReadError — corrupt / non-PDF / oversized
        ScheduleVisionAIError   — downstream LLM failure / non-JSON
    """
    _validate_pdf_bytes(pdf_bytes)

    logger.info(
        "Sending schedule to Gemini Vision: %d bytes, max_output_tokens=%d",
        len(pdf_bytes), GEMINI_MAX_OUTPUT_TOKENS,
    )

    try:
        result = await call_gemini(
            system_prompt=SYSTEM_PROMPT,
            user_content=(
                "Analyze the attached UQU schedule PDF and return the JSON "
                "object described in the system instructions. Include EVERY "
                "visible class meeting. Day strings MUST be the canonical "
                "Arabic forms listed in the rules above."
            ),
            temperature=0.1,
            response_mime_type="application/json",
            file_data=pdf_bytes,
            mime_type="application/pdf",
            max_output_tokens=GEMINI_MAX_OUTPUT_TOKENS,
            timeout_seconds=GEMINI_TIMEOUT_SECONDS,
        )
    except HTTPException as exc:
        # `call_gemini` raises HTTPException on quota / payload / parse failures.
        # Bubble the underlying message up — the frontend's error-surfacing
        # already shows it to the user (e.g. "Gemini RESOURCE_EXHAUSTED: ...").
        logger.error("Gemini schedule vision call failed (HTTP %s): %s",
                     exc.status_code, exc.detail)
        raise ScheduleVisionAIError(
            f"تعذّر تحليل الجدول بواسطة محرّك الذكاء البصري. السبب: {exc.detail}"
        )
    except Exception as exc:
        logger.error("Unexpected Gemini schedule vision error: %s", exc, exc_info=True)
        raise ScheduleVisionAIError(
            f"حدث خطأ غير متوقع أثناء تحليل الجدول. السبب: {type(exc).__name__}: {exc}"
        )

    # Gemini occasionally returns a bare array (it ignores the wrapper key)
    # when the prompt heavily emphasizes the list; tolerate both shapes.
    if isinstance(result, list):
        result = {"schedule": result}
    if not isinstance(result, dict):
        logger.error("Schedule vision returned non-object payload: %r", type(result))
        raise ScheduleVisionAIError("استجابة المحرّك ليست بالتنسيق المتوقع.")

    return _normalize(result)


# ── Internal helpers ──────────────────────────────────────────────────
def _validate_pdf_bytes(data: bytes) -> None:
    if not data:
        raise ScheduleVisionReadError("الملف المرفوع فارغ.")
    if len(data) > MAX_PDF_BYTES:
        raise ScheduleVisionReadError(
            f"حجم الملف يتجاوز الحد الأقصى {MAX_PDF_BYTES // (1024 * 1024)} ميجابايت."
        )
    if not data.lstrip().startswith(b"%PDF-"):
        raise ScheduleVisionReadError(
            "الملف ليس بصيغة PDF صالحة. الرجاء رفع جدول محاضرات من بوابة الجامعة."
        )


_TIME_RE = re.compile(r"^([0-1]?\d|2[0-3]):([0-5]\d)$")


def _normalize(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce whatever the model produced into our strict snake_case shape."""
    raw_list = (
        parsed.get("schedule")
        or parsed.get("classes")
        or parsed.get("slots")
        or []
    )
    if not isinstance(raw_list, list):
        return {"schedule": []}

    cleaned: List[Dict[str, Any]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        norm = _normalize_slot(item)
        if norm is not None:
            cleaned.append(norm)
    return {"schedule": cleaned}


def _normalize_slot(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    course_code = _str(item.get("course_code") or item.get("courseCode"))
    course_name = _str(item.get("course_name") or item.get("courseName"))
    day = _normalize_day(_str(item.get("day")))
    start_time = _normalize_time(_str(item.get("start_time") or item.get("startTime")))
    end_time = _normalize_time(_str(item.get("end_time") or item.get("endTime")))
    activity = _normalize_type(
        _str(item.get("type") or item.get("activityType") or item.get("activity_type"))
    )
    room = _str(item.get("room"))
    building = _str(item.get("building"))

    if not course_name and not course_code:
        return None
    if not day or not start_time:
        return None  # without a day + at least a start time the slot isn't placeable

    return {
        "course_code": course_code,
        "course_name": course_name,
        "day": day,
        "start_time": start_time,
        "end_time": end_time,
        "type": activity,
        "room": room,
        "building": building,
    }


def _str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _normalize_day(day: str) -> str:
    if not day:
        return ""
    if day in VALID_DAYS:
        return day
    if day in DAY_ALIASES:
        return DAY_ALIASES[day]
    title = day.title()
    if title in DAY_ALIASES:
        return DAY_ALIASES[title]
    return ""


def _normalize_time(t: str) -> str:
    if not t:
        return ""
    if t.count(":") == 2:
        t = ":".join(t.split(":")[:2])
    m = _TIME_RE.match(t)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return ""


def _normalize_type(t: str) -> str:
    if not t:
        return "نظري"
    if t in TYPE_ALIASES:
        return TYPE_ALIASES[t]
    key = t.strip().lower()
    if key in TYPE_ALIASES:
        return TYPE_ALIASES[key]
    return "نظري"
