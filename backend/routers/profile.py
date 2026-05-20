"""
================================================================
UQU Academic Assistant — Profile Router
================================================================
Legacy POST /api/sync-profile — deprecated Phase 4C.1 (410 Gone).
Use PATCH /api/workspace/profile for canonical profile writes.
"""

from fastapi import APIRouter, Depends

from schemas.profile import ProfilePayload, ProfileResponse
from auth.dependencies import get_current_user
from common.deprecation import raise_deprecated_endpoint

router = APIRouter(tags=["Profile"])


@router.post("/api/sync-profile", response_model=ProfileResponse)
async def sync_profile(
    payload: ProfilePayload,
    user_id: str = Depends(get_current_user),
):
    """Deprecated Phase 4C.1 — use PATCH /api/workspace/profile."""
    raise_deprecated_endpoint(
        method="POST",
        path="/api/sync-profile",
        replacement="PATCH /api/workspace/profile",
        legacy_firestore_paths=[
            "users/{uid}.profile",
            "users/{uid}.study_preferences",
        ],
        user_id=user_id,
    )
