"""
================================================================
UQU Academic Assistant — HTTPBearer Auth Dependency
================================================================
Firebase ID Token verification using fastapi.security.HTTPBearer.
Used by all NEW routers added during the JS-to-FastAPI migration.

Existing routers continue to use auth/dependencies.py to keep
the 1:1 migration contract (no behavior change for legacy endpoints).

_decode_firebase_token() is the single source of truth for token
verification — both this module and auth/dependencies.py delegate to it.
"""

import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


def _decode_firebase_token(token: str) -> str:
    """Verify a raw Firebase ID token string and return the UID.

    Raises HTTP 401 with an Arabic error message on any failure.
    Single source of truth — used by both bearer.py and dependencies.py.
    """
    try:
        decoded = auth.verify_id_token(token)
        return decoded["uid"]
    except auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="انتهت صلاحية رمز المصادقة — أعد تسجيل الدخول",
        )
    except auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="رمز المصادقة غير صالح",
        )
    except Exception as e:
        logger.warning("Auth verification failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="فشل التحقق من المصادقة",
        )


async def verify_firebase_token(
    creds: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    """FastAPI dependency — HTTPBearer variant. Returns Firebase UID."""
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="مطلوب تسجيل الدخول — Authorization header مفقود",
        )
    return _decode_firebase_token(creds.credentials)
