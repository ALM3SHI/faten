"""
Study from a lecture PDF: Gemini reads the file (text, Arabic, diagrams)
and returns a summary, key terms and a multiple-choice quiz.

Output is validated and normalised here so the frontend can trust it.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from config import get_settings
from services.gemini import call_gemini

logger = logging.getLogger(__name__)

MAX_PDF_BYTES = 10 * 1024 * 1024
QUESTION_CHOICES = (5, 10, 15)

SYSTEM_PROMPT = """You are an expert university tutor at Umm Al-Qura University.
You receive a lecture file (slides or notes). Build study material ONLY from its content.

Return ONE JSON object, no markdown:
{
  "title": "short title of the lecture",
  "summary": ["5–8 concise bullet points covering the main ideas, in order"],
  "key_terms": [{"term": "...", "definition": "one short sentence"}],
  "quiz": [
    {"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "why, citing the lecture"}
  ]
}

Rules:
- Language: {language}. Keep technical terms in their original language in parentheses when helpful.
- Exactly {n} quiz questions, each with exactly 4 options and one correct answer. Vary difficulty
  (recall, understanding, application). Distractors must be plausible. Spread the correct option position.
- Up to 10 key terms.
- Never invent facts that are not in the file. If the file has no readable study content, return
  {"error": "unreadable"}.
"""


class StudyError(Exception):
    pass


def _clip(v: Any, n: int) -> str:
    return str(v or "").strip()[:n]


def normalize(raw: Any, n: int) -> dict:
    if not isinstance(raw, dict):
        raise StudyError("bad response")
    if raw.get("error"):
        raise StudyError("unreadable")
    summary = [_clip(s, 400) for s in (raw.get("summary") or []) if _clip(s, 400)][:10]
    terms = [
        {"term": _clip(t.get("term"), 120), "definition": _clip(t.get("definition"), 400)}
        for t in (raw.get("key_terms") or []) if isinstance(t, dict) and _clip(t.get("term"), 120)
    ][:10]
    quiz = []
    for q in raw.get("quiz") or []:
        if not isinstance(q, dict):
            continue
        opts = [_clip(o, 300) for o in (q.get("options") or []) if _clip(o, 300)]
        try:
            ans = int(q.get("answer_index"))
        except (TypeError, ValueError):
            continue
        if not _clip(q.get("question"), 600) or not (2 <= len(opts) <= 5) or not (0 <= ans < len(opts)):
            continue
        quiz.append({
            "question": _clip(q.get("question"), 600),
            "options": opts,
            "answer_index": ans,
            "explanation": _clip(q.get("explanation"), 600),
        })
    if not summary and not quiz:
        raise StudyError("empty")
    return {"title": _clip(raw.get("title"), 160) or "ملخص المحاضرة", "summary": summary, "key_terms": terms, "quiz": quiz[:n]}


def _retryable(exc: HTTPException) -> bool:
    d = str(exc.detail)
    return any(k in d for k in ("RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "429", "503", "500"))


async def study_from_pdf(pdf: bytes, questions: int = 10, language: str = "ar") -> dict:
    if not pdf or not pdf.startswith(b"%PDF"):
        raise StudyError("not a pdf")
    if len(pdf) > MAX_PDF_BYTES:
        raise StudyError("too large")
    n = questions if questions in QUESTION_CHOICES else 10
    lang = "Arabic (Modern Standard, clear and simple)" if language != "en" else "English"
    prompt = SYSTEM_PROMPT.replace("{language}", lang).replace("{n}", str(n))
    s = get_settings()
    last: Exception | None = None
    for model in dict.fromkeys([s.GEMINI_MODEL, s.GEMINI_FAST_MODEL]):
        try:
            raw = await call_gemini(
                system_prompt=prompt,
                user_content=f"Create the study pack for the attached lecture with exactly {n} questions.",
                temperature=0.3,
                response_mime_type="application/json",
                file_data=pdf,
                mime_type="application/pdf",
                timeout_seconds=120.0,
                max_output_tokens=8192,
                model=model,
            )
            return normalize(raw, n)
        except HTTPException as exc:
            last = exc
            if not _retryable(exc):
                raise
            logger.warning("[study] %s unavailable (%s) — trying next model", model, str(exc.detail)[:120])
    assert last is not None
    raise last
