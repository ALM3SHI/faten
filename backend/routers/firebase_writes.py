"""
================================================================
UQU Academic Assistant — Firebase Writes Router
================================================================
Legacy direct Firestore write ports from assets/firebase-db.js — all
deprecated Phase 4C.1 (HTTP 410). Canonical writes use PATCH /api/workspace/*.
"""

from fastapi import APIRouter, Body, Depends

from auth.bearer import verify_firebase_token
from schemas.firebase_writes import (
    PushPlanRequest,
    PushTranscriptRequest,
    SyncSemestersRequest,
    FirebaseWriteResponse,
)
from common.deprecation import raise_deprecated_endpoint

router = APIRouter(prefix="/api/firebase", tags=["Firebase Writes"])


@router.post("/push-plan", response_model=FirebaseWriteResponse)
async def push_plan(
    body: PushPlanRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Deprecated Phase 4C.1 — use PATCH /api/workspace/plan."""
    raise_deprecated_endpoint(
        method="POST",
        path="/api/firebase/push-plan",
        replacement="PATCH /api/workspace/plan",
        legacy_firestore_paths=["users/{uid}/study_plans/*"],
        user_id=user_id,
    )


@router.post("/push-chat", response_model=FirebaseWriteResponse)
async def push_chat(
    user_id: str = Depends(verify_firebase_token),
    body: dict | None = Body(default=None),
) -> FirebaseWriteResponse:
    """Deprecated Phase 4C.1 — use PATCH /api/workspace/chats/{thread_id} and POST /api/chat."""
    raise_deprecated_endpoint(
        method="POST",
        path="/api/firebase/push-chat",
        replacement="PATCH /api/workspace/chats/{thread_id} (UI); POST /api/chat (agent)",
        legacy_firestore_paths=["users/{uid}/chat_history/*"],
        user_id=user_id,
    )


@router.post("/push-transcript", response_model=FirebaseWriteResponse)
async def push_transcript(
    body: PushTranscriptRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Deprecated Phase 4C.1 — use PATCH /api/workspace/transcript."""
    raise_deprecated_endpoint(
        method="POST",
        path="/api/firebase/push-transcript",
        replacement="PATCH /api/workspace/transcript",
        legacy_firestore_paths=["users/{uid}/academic_records/*"],
        user_id=user_id,
    )


@router.post("/sync-semesters", response_model=FirebaseWriteResponse)
async def sync_semesters(
    body: SyncSemestersRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Deprecated Phase 4C.1 — use PATCH /api/workspace/transcript."""
    raise_deprecated_endpoint(
        method="POST",
        path="/api/firebase/sync-semesters",
        replacement="PATCH /api/workspace/transcript",
        legacy_firestore_paths=["users/{uid}/academic_records/*"],
        user_id=user_id,
    )
