"""
================================================================
UQU Academic Assistant — Workspace Router
================================================================
GET /api/workspace — load full user workspace via backend (Phase 1).
PATCH /api/workspace/profile — save canonical profile fields (Phase 2A).
PATCH /api/workspace/transcript — save canonical academic record (Phase 2B).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from auth.dependencies import get_current_user
from db.firestore import get_db
from schemas.workspace import (
    ProfileSaveRequest,
    ProfileSaveResponse,
    TranscriptSaveRequest,
    TranscriptSaveResponse,
    WorkspaceResponse,
)
from services.workspace import load_workspace, save_profile, save_transcript

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Workspace"])


@router.get("/api/workspace", response_model=WorkspaceResponse)
async def get_workspace(user_id: str = Depends(get_current_user)) -> WorkspaceResponse:
    """Load profile, transcript, schedule, plan, chats, achievements, and notifications."""
    try:
        db = get_db()
        data = await load_workspace(user_id, db)
        return WorkspaceResponse(**data)
    except Exception as err:
        logger.error("[workspace] GET /api/workspace failed: %s", err, exc_info=True)
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.patch("/api/workspace/profile", response_model=ProfileSaveResponse)
async def patch_workspace_profile(
    payload: ProfileSaveRequest,
    user_id: str = Depends(get_current_user),
) -> ProfileSaveResponse:
    """Persist basic, goals, preferences, and lastUpdated to users/{uid} (merge)."""
    try:
        db = get_db()
        data = await save_profile(user_id, db, payload.model_dump())
        return ProfileSaveResponse(**data)
    except Exception as err:
        logger.error("[workspace] PATCH /api/workspace/profile failed: %s", err, exc_info=True)
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.patch("/api/workspace/transcript", response_model=TranscriptSaveResponse)
async def patch_workspace_transcript(
    payload: TranscriptSaveRequest,
    user_id: str = Depends(get_current_user),
) -> TranscriptSaveResponse:
    """Persist transcript fields to users/{uid}/academic_record/main (merge)."""
    try:
        db = get_db()
        data = await save_transcript(user_id, db, payload.model_dump())
        return TranscriptSaveResponse(**data)
    except Exception as err:
        logger.error("[workspace] PATCH /api/workspace/transcript failed: %s", err, exc_info=True)
        raise HTTPException(status_code=500, detail=str(err)) from err
