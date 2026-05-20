"""
================================================================
UQU Academic Assistant — Transcript Router
================================================================
Converts: exports.syncTranscript from index.js lines 281-337
"""

import json
import re
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from schemas.transcript import TranscriptPayload, TranscriptResponse
from auth.dependencies import get_current_user
from db.firestore import get_db
from common.deprecation import raise_deprecated_endpoint
from agent.loop import get_openai_client
from config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Transcript"])


async def _sync_transcript_logic(payload: TranscriptPayload, user_id: str):
    """Core logic shared by both route aliases."""
    try:
        db = get_db()
        settings = get_settings()
        user_ref = db.collection("users").document(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        # ── Save transcript ──
        courses_dicts = [c.model_dump() for c in payload.courses]
        user_ref.collection("transcripts").add({
            "courses":    courses_dicts,
            "cgpa":       payload.cgpa,
            "totalHours": payload.totalHours,
            "createdAt":  now_iso,
        })

        return TranscriptResponse(success=True)

    except Exception as err:
        logger.error(f"[syncTranscript] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/api/sync-transcript", response_model=TranscriptResponse)
async def sync_transcript(
    payload: TranscriptPayload,
    user_id: str = Depends(get_current_user),
):
    """Deprecated Phase 4C.1 — use PATCH /api/workspace/transcript."""
    raise_deprecated_endpoint(
        method="POST",
        path="/api/sync-transcript",
        replacement="PATCH /api/workspace/transcript",
        legacy_firestore_paths=["users/{uid}/transcripts/*"],
        user_id=user_id,
    )
    return await _sync_transcript_logic(payload, user_id)

