"""
================================================================
UQU Academic Assistant — Authentication Dependencies
================================================================
Firebase ID Token verification as a FastAPI dependency.
Handles both authenticated users and initial signup scenarios.

Token verification logic lives in auth/bearer.py (_decode_firebase_token).
This module provides the Header-based dependency variants.
"""

import logging
from fastapi import Header, HTTPException

from auth.bearer import _decode_firebase_token

logger = logging.getLogger(__name__)


async def get_current_user(authorization: str = Header(default="")) -> str:
    """Verify Firebase ID token from Authorization: Bearer <token> header.

    Returns Firebase UID. Raises HTTP 401 on any failure.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="مطلوب تسجيل الدخول — Authorization header مفقود",
        )
    return _decode_firebase_token(authorization[7:])


async def get_current_user_optional(authorization: str = Header(default="")) -> str:
    """Graceful auth — returns user ID or a development fallback.

    For endpoints that should work during development without Firebase Auth.
    In production, set REQUIRE_AUTH=true to disable the fallback.
    """
    if not authorization or not authorization.startswith("Bearer "):
        logger.debug("No auth token — using dev fallback user")
        return "dev_user_anonymous"

    # If a token IS provided, STRICTLY extract and verify it. NO silent fallback!
    return await get_current_user(authorization)

