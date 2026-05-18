import time
import logging

from fastapi import APIRouter, Depends
from typing import Optional
from openai import AsyncOpenAI, APIStatusError, APIConnectionError, APITimeoutError

from schemas.diagnostics import DiagnosticsRequest, GoalCalcRequest
from services.diagnostics import generate_diagnostics, calc_required_sgpa
from auth.dependencies import get_current_user_optional
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/diagnostics", tags=["Diagnostics"])

@router.get("/test-nvidia")
async def test_nvidia_connection():
    """
    Live health-check for the NVIDIA NIM API.
    Sends a minimal 'say hello' request to kimi and returns:
      - ok: bool
      - model: the configured model name
      - reply: first 200 chars of kimi's response (if ok)
      - error: error detail (if not ok)
      - latency_ms: round-trip time in milliseconds
    """
    settings = get_settings()
    client = AsyncOpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=settings.NVIDIA_API_KEY,
    )
    t0 = time.monotonic()
    try:
        completion = await client.chat.completions.create(
            model=settings.NVIDIA_MODEL,
            messages=[{"role": "user", "content": "قل مرحبا باختصار"}],
            temperature=0.5,
            max_tokens=64,
        )
        latency = round((time.monotonic() - t0) * 1000)
        reply = (completion.choices[0].message.content or "").strip()
        logger.info("[test-nvidia] OK — model=%s reply=%s", settings.NVIDIA_MODEL, reply[:80])
        return {
            "ok": True,
            "model": settings.NVIDIA_MODEL,
            "reply": reply[:200],
            "latency_ms": latency,
        }
    except APIStatusError as e:
        latency = round((time.monotonic() - t0) * 1000)
        body = ""
        try:
            body = e.response.text[:400]
        except Exception:
            pass
        logger.error("[test-nvidia] HTTP %s — %s", e.status_code, body)
        return {
            "ok": False,
            "model": settings.NVIDIA_MODEL,
            "error": f"HTTP {e.status_code}: {body}",
            "latency_ms": latency,
        }
    except (APIConnectionError, APITimeoutError) as e:
        latency = round((time.monotonic() - t0) * 1000)
        logger.error("[test-nvidia] Connection/timeout: %s", e)
        return {"ok": False, "model": settings.NVIDIA_MODEL, "error": str(e), "latency_ms": latency}
    except Exception as e:
        latency = round((time.monotonic() - t0) * 1000)
        logger.error("[test-nvidia] Unexpected: %s", e)
        return {"ok": False, "model": settings.NVIDIA_MODEL, "error": str(e), "latency_ms": latency}


@router.post("/analyze")
async def analyze_diagnostics(
    request: DiagnosticsRequest,
    user_id: Optional[str] = Depends(get_current_user_optional)
):
    """
    Perform full academic diagnostics analysis.
    """
    report = generate_diagnostics(
        semesters=request.semesters,
        goals=request.goals
    )
    return report

@router.post("/calculate-goal")
async def calculate_goal(
    request: GoalCalcRequest,
    user_id: Optional[str] = Depends(get_current_user_optional)
):
    """
    Calculate required SGPA for a specific term to reach a target CGPA.
    """
    result = calc_required_sgpa(
        current_gpa=request.currentGpa,
        earned_hours=request.earnedHours,
        total_points=request.totalPoints,
        target_gpa=request.targetGpa,
        term_hours=request.termHours
    )
    return result
