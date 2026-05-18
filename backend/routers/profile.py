"""
================================================================
UQU Academic Assistant — Profile Router
================================================================
Converts: exports.syncProfile from index.js lines 236-276
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from schemas.profile import ProfilePayload, ProfileResponse
from auth.dependencies import get_current_user
from db.firestore import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Profile"])


def _build_update_dict(payload: ProfilePayload) -> dict:
    """Map a ProfilePayload onto the Firestore document structure.

    Supports both the nested (basic/goals/learning) shape and the legacy
    flat shape — whichever fields are present win.
    """
    b = payload.basic
    g = payload.goals
    l = payload.learning
    return {
        "profile": {
            "name":        (b.name if b else None) or payload.name or "",
            "university":  (b.university if b else None) or payload.university or "",
            "major":       (b.major if b else None) or payload.major or "",
            "level":       (b.level if b else None) or payload.level or "",
            "currentGpa":  g.currentGpa if g else None,
            "targetGpa":   g.targetGpa if g else None,
            "earnedHours": g.earnedHours if g else None,
            "courses":     payload.courses or [],
        },
        "study_preferences": {
            "best_time":    (l.bestTime or "") if l else "",
            "study_hours":  (l.studyHours or 0) if l else 0,
            "method":       (l.studyStyle or "") if l else "",
            "focus_length": (l.focusLength or 25) if l else 25,
        },
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


async def _sync_profile_logic(payload: ProfilePayload, user_id: str):
    """Core logic shared by both route aliases."""
    try:
        db = get_db()
        user_ref = db.collection("users").document(user_id)
        user_ref.set(_build_update_dict(payload), merge=True)
        return ProfileResponse(success=True)

    except Exception as err:
        logger.error(f"[syncProfile] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/api/sync-profile", response_model=ProfileResponse)
async def sync_profile(
    payload: ProfilePayload,
    user_id: str = Depends(get_current_user),
):
    return await _sync_profile_logic(payload, user_id)

