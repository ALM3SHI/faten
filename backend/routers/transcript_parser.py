"""
================================================================
UQU Transcript Advisor Router
================================================================
The frontend parses the PDF locally with pdfjs (see
`frontend/src/lib/transcript-parser.ts`) and POSTs the already-clean
structured JSON here. This endpoint's only job is to call the AI
advisor and return the analysis block.

HTTP status codes:
    422  request body fails schema validation (FastAPI default)
    502  AI engine failure (downstream)
    500  truly unexpected internal error
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from auth.dependencies import get_current_user
from services.quota import COST_TRANSCRIPT_ANALYSIS, require_ai_credits
from services.transcript import (
    TranscriptAIError,
    TranscriptAnalysisRequest,
    analyze_transcript,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transcript", tags=["Transcript Advisor"])


@router.post("/analyze")
async def analyze_transcript_endpoint(
    payload: TranscriptAnalysisRequest,
    user_id: str = Depends(get_current_user),
) -> JSONResponse:
    """
    Receive a pre-parsed transcript JSON and return an academic advisory:

        {
          "strengths":       ["..."],
          "needs_focus":     ["..."],
          "recommendations": ["..."]
        }

    The shape on the wire mirrors what the UI puts under `parsedData.analysis`.
    """
    require_ai_credits(user_id, COST_TRANSCRIPT_ANALYSIS)
    logger.info(
        "Transcript advisor request: user=%s completed=%d registered=%d gpa=%s",
        user_id,
        len(payload.completedCourses),
        len(payload.registeredCourses),
        payload.gpa,
    )

    try:
        analysis = await analyze_transcript(payload)
    except TranscriptAIError as exc:
        logger.warning("Transcript advisor failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Unexpected error in /transcript/analyze: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ غير متوقع: {type(exc).__name__}",
        )

    return JSONResponse(content={"analysis": analysis})
