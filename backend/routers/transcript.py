"""
================================================================
UQU Academic Assistant — Transcript Router
================================================================
Legacy POST /api/sync-transcript — deprecated Phase 4C.1 (410 Gone).
Use PATCH /api/workspace/transcript for canonical transcript writes.
Transcript AI analysis lives in routers/transcript_parser.py.
"""

from fastapi import APIRouter, Depends

from schemas.transcript import TranscriptPayload, TranscriptResponse
from auth.dependencies import get_current_user
from common.deprecation import raise_deprecated_endpoint

router = APIRouter(tags=["Transcript"])


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
