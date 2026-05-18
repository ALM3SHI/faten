"""
================================================================
UQU Academic Assistant — AI Study Plan Router
================================================================
Exposes the Gemini-powered weekly study plan generator at
    POST /api/plan/generate-ai

Why not /api/plan/generate?
That path is already mounted by the legacy rule-based planner
(`routers/plan_generator.py`) which other client code still calls
through `PlanService.generateDailyPlan`. Mounting the new AI flow
at a distinct path lets both coexist while the rest of the app
migrates.

HTTP status codes:
    400  empty courses (frontend should pre-validate)
    401  missing / invalid Firebase token
    502  Gemini upstream failure / invalid JSON / schema mismatch
    503  GEMINI_API_KEY not configured on the server
================================================================
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from auth.bearer import verify_firebase_token
from schemas.plan_ai import GeneratePlanRequest, GeneratePlanResponse
from services.plan_ai import generate_ai_study_plan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/plan", tags=["AI Study Plan"])


@router.post("/generate-ai", response_model=GeneratePlanResponse)
async def generate_ai_plan_endpoint(
    body: GeneratePlanRequest,
    user_id: str = Depends(verify_firebase_token),
) -> GeneratePlanResponse:
    """
    Generate a weekly study plan tailored to the student's:
        • registered courses (from useTranscriptStore.currentCourses)
        • weekly timetable (from useScheduleStore.schedule)
        • Smart Preferences Hub selections (from useProfileStore.preferences)

    The plan respects:
        - dayOff (no tasks scheduled on the chosen rest day)
        - energyPeak (high-priority tasks placed in the peak window)
        - taskStrategy (eat-the-frog vs snowball ordering)
        - pomodoroFocus (each task is one focus session, or a multiple)
        - all busy slots from the schedule (tasks slotted into free gaps only)

    Returns the structured plan + the model id + an ISO timestamp.
    """
    logger.info(
        "AI plan request: user=%s courses=%d slots=%d",
        user_id,
        len(body.courses),
        len(body.schedule),
    )

    try:
        result = await generate_ai_study_plan(body)
    except HTTPException:
        # Already a structured FastAPI error (400/502/503) — pass through.
        raise
    except Exception as exc:  # noqa: BLE001 — last-resort guard
        logger.error("AI plan unexpected failure: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ غير متوقع: {type(exc).__name__}",
        ) from exc

    return GeneratePlanResponse(**result)
