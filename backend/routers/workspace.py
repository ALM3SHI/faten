"""
================================================================
UQU Academic Assistant — Workspace Router
================================================================
GET /api/workspace — load full user workspace via backend (Phase 1).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from auth.dependencies import get_current_user
from db.firestore import get_db
from schemas.workspace import WorkspaceResponse
from services.workspace import load_workspace

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
