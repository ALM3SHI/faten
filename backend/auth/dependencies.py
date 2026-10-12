"""
================================================================
UQU Academic Assistant — Authentication Dependencies
================================================================
Firebase ID Token verification as a FastAPI dependency.
Every endpoint requires a valid token — there is no anonymous fallback.

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

