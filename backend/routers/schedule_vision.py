"""
================================================================
UQU Schedule Vision Router
================================================================
Accepts a schedule PDF upload, hands it to the Gemini multimodal
extractor, and returns the parsed class slots.

This is the SOLE endpoint for schedule extraction now. The
previous text-based / geometric local parsers have been removed.

HTTP status codes:
    400  bad / empty / non-PDF / oversized file
    502  Gemini Vision failure (quota, model unavailable, bad JSON)
    500  truly unexpected internal error
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from auth.dependencies import get_current_user
from services.quota import COST_SCHEDULE_VISION, require_ai_credits
from services.schedule_vision import (
    ScheduleVisionAIError,
    ScheduleVisionReadError,
    analyze_schedule_vision,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/schedule", tags=["Schedule Vision"])


@router.post("/analyze-vision")
async def analyze_schedule_vision_endpoint(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
) -> JSONResponse:
    """
    Parse a weekly timetable PDF via Gemini multimodal (Vision).

    Returns:
        {
          "schedule": [
            {
              "course_code": "CS4216",
              "course_name": "الطرق العلمية",
              "day": "الثلاثاء",
              "start_time": "08:00",
              "end_time": "08:50",
              "type": "نظري",
              "room": "1.042",   # optional
              "building": "25"    # optional
            },
            ...
          ]
        }
    """
    require_ai_credits(user_id, COST_SCHEDULE_VISION)
    logger.info(
        "Schedule vision analyze: user=%s filename=%s content_type=%s",
        user_id, file.filename, file.content_type,
    )

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="يجب رفع ملف بصيغة PDF.")

    try:
        # Schedules are tiny (< 500 KB in practice); reading the entire
        # upload into memory is fine and what Gemini needs anyway.
        pdf_bytes = await file.read()
    except Exception as exc:
        logger.error("Failed to read schedule upload: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail="تعذّر قراءة محتوى الملف.")

    try:
        result = await analyze_schedule_vision(pdf_bytes)
    except ScheduleVisionReadError as exc:
        logger.info("Schedule vision read rejected: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except ScheduleVisionAIError as exc:
        logger.warning("Schedule vision AI failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Unexpected error in /schedule/analyze-vision: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ غير متوقع: {type(exc).__name__}",
        )

    return JSONResponse(content=result)
