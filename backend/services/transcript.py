"""
================================================================
UQU Transcript Advisor — NVIDIA NIM (Llama 3.3) edition
================================================================
Hybrid architecture:
  • Extraction happens 100% client-side via `frontend/src/lib/transcript-parser.ts`
    (coordinate-aware PDF table parsing with pdfjs). The backend never
    sees the PDF bytes.
  • This service receives the already-clean structured transcript JSON
    and asks the AI to produce an academic advisory: strengths,
    areas needing focus, and concrete recommendations.

We use NVIDIA NIM (Llama 3.3) for the advisory — the chat agent already
runs there with tool calling, so we keep model + provider parity.

The PDF-multimodal Gemini path that previously lived in this file is
gone. There is no PDF text in this service anymore; everything that
arrives here is already accurate.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from openai import APIError
from pydantic import BaseModel, Field

from agent.loop import get_openai_client
from config import get_settings

logger = logging.getLogger(__name__)

# ── Strict-JSON system prompt ────────────────────────────────────────────
SYSTEM_PROMPT = """You are a UQU academic advisor. The student's transcript has already been
parsed deterministically from the PDF — every course, grade, and credit hour
is exact. You DO NOT need to extract anything; you only analyze.

Given the structured JSON I provide, produce three short, *specific* bullet
lists in Arabic. Ground every point in the student's actual data (mention
course names or grade patterns where it makes the advice concrete).

Return ONLY a valid JSON object — no markdown fences, no prose around it —
in this EXACT shape:
{
  "strengths":       ["نقطة قوة 1", "نقطة قوة 2", "نقطة قوة 3"],
  "needs_focus":     ["نقطة ضعف 1", "نقطة ضعف 2"],
  "recommendations": ["توصية عملية 1", "توصية عملية 2", "توصية عملية 3"]
}

Rules:
  • Each list contains 2-4 short bullets (max ~120 Arabic characters each).
  • `strengths` cites concrete wins: high-GPA semesters, courses with A/A+,
    consistency, recovery from low grades, etc.
  • `needs_focus` flags concrete risks: courses with F/D, sharp GPA drops,
    repeated low grades in a subject area, etc.
  • `recommendations` are ACTIONABLE next steps the student can take this
    semester (study group, retake, office hours for a specific course, etc.).
  • Use the same course names from the data — don't invent or translate them.
  • Do not include any field other than `strengths`, `needs_focus`,
    `recommendations`. No summary, no metadata, no markdown.
"""


# ── Request model (router uses this) ────────────────────────────────────
class TranscriptCourse(BaseModel):
    """A single course from the client-side parser. All fields optional
    because not every field is always present (e.g. registered-but-not-
    graded courses)."""

    code: Optional[str] = None
    name: Optional[str] = None
    nameAr: Optional[str] = None
    nameEn: Optional[str] = None
    creditHours: Optional[int] = None
    grade: Optional[str] = None
    points: Optional[float] = None
    gradePoints: Optional[float] = None
    semester: Optional[str] = None
    semesterStatus: Optional[str] = None
    status: Optional[str] = None


class TranscriptAnalysisRequest(BaseModel):
    """Payload accepted by POST /api/transcript/analyze."""

    # Identity
    name: Optional[str] = None
    nameEn: Optional[str] = None
    studentId: Optional[str] = None
    university: Optional[str] = None
    major: Optional[str] = None
    majorEn: Optional[str] = None
    faculty: Optional[str] = None
    degree: Optional[str] = None

    # Academic stats
    gpa: Optional[float] = None
    earnedHours: Optional[int] = None
    planHours: Optional[int] = None
    totalPoints: Optional[float] = None
    confidence: Optional[int] = None

    # Course lists (we accept the full enriched list from the client)
    completedCourses: List[TranscriptCourse] = Field(default_factory=list)
    registeredCourses: List[TranscriptCourse] = Field(default_factory=list)

    # Semesters (optional richer context — the model uses it if present)
    semesters: List[Dict[str, Any]] = Field(default_factory=list)


# ── Typed exceptions (router maps these to HTTP codes) ──────────────────
class TranscriptAIError(Exception):
    """The downstream LLM call or its JSON output was not usable."""


# ── Public entrypoint ───────────────────────────────────────────────────
async def analyze_transcript(payload: TranscriptAnalysisRequest) -> Dict[str, Any]:
    """
    Send the pre-parsed transcript to NVIDIA NIM and ask for an analysis.

    Returns: { "strengths": [...], "needs_focus": [...], "recommendations": [...] }

    Raises TranscriptAIError on any failure — the router converts to HTTP 502.
    """
    completed = payload.completedCourses or []
    if not completed and not payload.registeredCourses:
        # Nothing to advise on — return empty analysis without paying for a call.
        logger.info("Transcript advisor skipped: no courses in payload.")
        return {"strengths": [], "needs_focus": [], "recommendations": []}

    settings = get_settings()
    client = get_openai_client()

    # Hand the model a compact, deterministic snapshot. We omit fields
    # that aren't useful for advisory (gradePoints, points) to keep the
    # prompt focused — but the model still sees grade letters & semester
    # context, which is what drives a good analysis.
    snapshot = _build_snapshot(payload)
    snapshot_json = json.dumps(snapshot, ensure_ascii=False, indent=2)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Student's parsed transcript follows as JSON. Analyze and return "
                "the advisory JSON as described in the system instructions.\n\n"
                "----- BEGIN TRANSCRIPT JSON -----\n"
                f"{snapshot_json}\n"
                "----- END TRANSCRIPT JSON -----"
            ),
        },
    ]

    try:
        completion = await client.chat.completions.create(
            model=settings.llm_model,
            messages=messages,
            temperature=0.3,
            top_p=0.9,
            max_tokens=2048,
        )
    except APIError as exc:
        logger.error("NVIDIA advisor call failed (%s): %s", type(exc).__name__, exc)
        raise TranscriptAIError(
            f"تعذّر الاتصال بمحرّك الذكاء الاصطناعي. السبب: {type(exc).__name__}"
        )
    except Exception as exc:
        logger.error("Unexpected error during NVIDIA advisor call: %s", exc, exc_info=True)
        raise TranscriptAIError(
            f"حدث خطأ غير متوقع أثناء التحليل. السبب: {type(exc).__name__}: {exc}"
        )

    text = (completion.choices[0].message.content or "").strip()
    if not text:
        raise TranscriptAIError("لم يُرجع المحرّك أي محتوى لتحليله.")

    parsed = _safe_json_parse(text)
    if parsed is None or not isinstance(parsed, dict):
        logger.error("Advisor returned non-JSON content: %s", text[:300])
        raise TranscriptAIError("استجابة المحرّك ليست JSON صالحاً.")

    return _normalize_analysis(parsed)


# ── Internal helpers ────────────────────────────────────────────────────
def _build_snapshot(payload: TranscriptAnalysisRequest) -> Dict[str, Any]:
    """Project the request into the minimal shape the advisor needs."""

    def course_dict(c: TranscriptCourse) -> Dict[str, Any]:
        return {
            "code": c.code or "",
            "name": c.nameAr or c.name or c.nameEn or "",
            "credits": c.creditHours or 0,
            "grade": c.grade or "",
            "semester": c.semester or "",
        }

    return {
        "student": {
            "name": payload.name or payload.nameEn or "",
            "major": payload.major or payload.majorEn or "",
            "gpa": payload.gpa,
            "earned_credits": payload.earnedHours,
            "plan_credits": payload.planHours,
        },
        "completed_courses": [course_dict(c) for c in payload.completedCourses],
        "registered_courses": [course_dict(c) for c in payload.registeredCourses],
        "semesters_summary": [
            {
                "name": s.get("nameAr") or s.get("nameEn"),
                "sgpa": s.get("sgpa"),
                "cgpa": s.get("cgpa"),
                "course_count": len(s.get("courses") or []),
            }
            for s in payload.semesters
            if isinstance(s, dict)
        ],
    }


def _safe_json_parse(text: str) -> Optional[Dict[str, Any]]:
    """
    Defensive parser — tolerates the three common deviations:
      (a) ```json ... ``` fences
      (b) prose around the JSON object
      (c) leading whitespace / BOM
    """
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fence_match.group(1).strip() if fence_match else text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(candidate[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _normalize_analysis(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce whatever the model produced into the strict 3-key shape."""

    def coerce_list(v: Any) -> List[str]:
        if not v:
            return []
        if isinstance(v, str):
            return [v.strip()] if v.strip() else []
        if isinstance(v, list):
            out: List[str] = []
            for item in v:
                if isinstance(item, str) and item.strip():
                    out.append(item.strip())
                elif isinstance(item, dict):
                    txt = item.get("point") or item.get("text") or ""
                    if isinstance(txt, str) and txt.strip():
                        out.append(txt.strip())
            return out
        return []

    return {
        "strengths": coerce_list(parsed.get("strengths")),
        "needs_focus": coerce_list(
            parsed.get("needs_focus") or parsed.get("weaknesses")
        ),
        "recommendations": coerce_list(parsed.get("recommendations")),
    }
