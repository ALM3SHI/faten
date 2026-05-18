"""
================================================================
UQU Academic Assistant — Speech-to-Text Router
================================================================
Powers the chat microphone button. Accepts an audio blob (any format
ffmpeg/Whisper can decode — webm/opus from MediaRecorder is the
common case) and returns the transcribed text in Arabic.

Backed by Groq's Whisper Large v3 endpoint (free tier, very fast).
If `GROQ_API_KEY` is not configured the endpoint returns HTTP 503,
which the frontend treats as the signal to fall back to the
browser's built-in Web Speech API instead.
================================================================
"""

import logging

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from auth.bearer import verify_firebase_token
from config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stt", tags=["Speech-to-Text"])

GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# 25 MB — same ceiling Groq enforces; reject earlier with a friendlier error.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(..., description="Recorded audio blob (webm/opus, mp3, wav, m4a, …)"),
    language: str = Form(default="ar", description="ISO 639-1 language hint — defaults to Arabic."),
    user_id: str = Depends(verify_firebase_token),
) -> dict:
    """Transcribe a short audio clip via Groq Whisper."""
    settings = get_settings()
    if not settings.GROQ_API_KEY:
        # Surfacing a distinct 503 lets the frontend fall back to the
        # browser's SpeechRecognition without showing an alarming error.
        raise HTTPException(
            status_code=503,
            detail="ميزة التحويل الصوتي غير مفعّلة على السيرفر (GROQ_API_KEY غير مُعرَّف).",
        )

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="ملف الصوت فارغ.")
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"الملف أكبر من الحد المسموح ({MAX_AUDIO_BYTES // (1024 * 1024)} ميجابايت).",
        )

    filename = audio.filename or "speech.webm"
    content_type = audio.content_type or "application/octet-stream"

    files = {"file": (filename, raw, content_type)}
    data = {
        "model": settings.GROQ_STT_MODEL,
        "language": language or "ar",
        "response_format": "json",
        "temperature": "0",
    }
    headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}"}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                GROQ_TRANSCRIPTIONS_URL,
                headers=headers,
                files=files,
                data=data,
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="انتهت مهلة التحويل الصوتي — حاول مرة أخرى بمقطع أقصر.")
    except httpx.HTTPError as exc:
        logger.exception("[stt] network error: %s", exc)
        raise HTTPException(status_code=502, detail="تعذّر الاتصال بمزود التحويل الصوتي.")

    if resp.status_code >= 400:
        # Pass the upstream message through (trimmed) so devs can debug.
        snippet = resp.text[:240]
        logger.warning("[stt] upstream %s: %s", resp.status_code, snippet)
        raise HTTPException(
            status_code=502,
            detail=f"رفض مزود التحويل الصوتي الطلب ({resp.status_code}): {snippet}",
        )

    try:
        payload = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="استجابة غير صالحة من مزود التحويل الصوتي.")

    text = (payload.get("text") or "").strip()
    logger.info("[stt] uid=%s bytes=%d → %d chars", user_id, len(raw), len(text))

    return {
        "success": True,
        "text": text,
        "language": payload.get("language") or language,
        "model": settings.GROQ_STT_MODEL,
    }
