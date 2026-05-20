"""
================================================================
UQU Academic Assistant — Workspace Router
================================================================
GET /api/workspace — load full user workspace via backend (Phase 1).
PATCH /api/workspace/profile — save canonical profile fields (Phase 2A).
PATCH /api/workspace/transcript — save canonical academic record (Phase 2B).
PATCH /api/workspace/schedule — save canonical weekly timetable (Phase 2C).
PATCH /api/workspace/plan — save canonical active study plan (Phase 2D).
PATCH /api/workspace/chats/{thread_id} — save canonical UI chat thread (Phase 2E).
DELETE /api/workspace/chats/{thread_id} — delete canonical UI chat thread (Phase 2E.1).
POST /api/workspace/chats/suppress-legacy-fallback — skip chat_history fallback (Phase 2E.2).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from auth.dependencies import get_current_user
from db.firestore import get_db
from schemas.workspace import (
    ChatThreadDeleteResponse,
    ChatThreadSaveRequest,
    ChatThreadSaveResponse,
    PlanSaveRequest,
    PlanSaveResponse,
    ProfileSaveRequest,
    ProfileSaveResponse,
    ScheduleSaveRequest,
    ScheduleSaveResponse,
    SuppressLegacyFallbackResponse,
    TranscriptSaveRequest,
    TranscriptSaveResponse,
    WorkspaceResponse,
)
from services.workspace import (
    delete_chat_thread,
    load_workspace,
    save_chat_thread,
    suppress_chats_legacy_fallback,
    save_plan,
    save_profile,
    save_schedule,
    save_transcript,
)

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


@router.patch("/api/workspace/schedule", response_model=ScheduleSaveResponse)
async def patch_workspace_schedule(
    payload: ScheduleSaveRequest,
    user_id: str = Depends(get_current_user),
) -> ScheduleSaveResponse:
    """Persist schedule slots to users/{uid}/academic_record/schedule (merge)."""
    try:
        db = get_db()
        data = await save_schedule(user_id, db, payload.model_dump())
        return ScheduleSaveResponse(**data)
    except Exception as err:
        logger.error("[workspace] PATCH /api/workspace/schedule failed: %s", err, exc_info=True)
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.patch("/api/workspace/plan", response_model=PlanSaveResponse)
async def patch_workspace_plan(
    payload: PlanSaveRequest,
    user_id: str = Depends(get_current_user),
) -> PlanSaveResponse:
    """Persist active plan to users/{uid}/plan/current (merge). Does not write study_plans."""
    try:
        db = get_db()
        data = await save_plan(user_id, db, payload.model_dump())
        return PlanSaveResponse(**data)
    except Exception as err:
        logger.error("[workspace] PATCH /api/workspace/plan failed: %s", err, exc_info=True)
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.patch("/api/workspace/chats/{thread_id}", response_model=ChatThreadSaveResponse)
async def patch_workspace_chat_thread(
    thread_id: str,
    payload: ChatThreadSaveRequest,
    user_id: str = Depends(get_current_user),
) -> ChatThreadSaveResponse:
    """Persist UI chat thread to users/{uid}/chats/{thread_id} (merge). No chat_history write."""
    try:
        db = get_db()
        data = await save_chat_thread(user_id, db, thread_id, payload.model_dump())
        return ChatThreadSaveResponse(**data)
    except Exception as err:
        logger.error(
            "[workspace] PATCH /api/workspace/chats/%s failed: %s",
            thread_id,
            err,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.delete(
    "/api/workspace/chats/{thread_id}",
    response_model=ChatThreadDeleteResponse,
)
async def delete_workspace_chat_thread(
    thread_id: str,
    user_id: str = Depends(get_current_user),
) -> ChatThreadDeleteResponse:
    """Delete UI chat thread at users/{uid}/chats/{thread_id}. No chat_history delete."""
    try:
        db = get_db()
        data = await delete_chat_thread(user_id, db, thread_id)
        return ChatThreadDeleteResponse(**data)
    except Exception as err:
        logger.error(
            "[workspace] DELETE /api/workspace/chats/%s failed: %s",
            thread_id,
            err,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.post(
    "/api/workspace/chats/suppress-legacy-fallback",
    response_model=SuppressLegacyFallbackResponse,
)
async def post_suppress_chats_legacy_fallback(
    user_id: str = Depends(get_current_user),
) -> SuppressLegacyFallbackResponse:
    """Set chatsSuppressLegacyFallback on users/{uid}. Idempotent; no chat_history change."""
    try:
        db = get_db()
        data = await suppress_chats_legacy_fallback(user_id, db)
        return SuppressLegacyFallbackResponse(**data)
    except Exception as err:
        logger.error(
            "[workspace] POST /api/workspace/chats/suppress-legacy-fallback failed: %s",
            err,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(err)) from err
