"""
Admin-only endpoints: the signed-in account's verified email must be in
settings.ADMIN_EMAILS (set on the server, never in the repo).
"""

from __future__ import annotations

import logging

from fastapi import Header, HTTPException
from firebase_admin import auth

from config import get_settings

logger = logging.getLogger(__name__)

NOT_ADMIN = "هذي الصفحة لمشرف فطن فقط."


def admin_emails() -> set[str]:
    raw = get_settings().ADMIN_EMAILS or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin_claims(claims: dict) -> bool:
    email = str(claims.get("email") or "").strip().lower()
    return bool(email) and claims.get("email_verified") is True and email in admin_emails()


async def require_admin(authorization: str = Header(default="")) -> str:
    """FastAPI dependency — returns the admin's uid, or 401/403 in Arabic."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="سجّل دخولك أولاً — لم يصل رمز الدخول مع الطلب.")
    try:
        claims = auth.verify_id_token(authorization[7:])
    except Exception as exc:  # expired / invalid / network
        logger.info("[admin] token rejected: %s", type(exc).__name__)
        raise HTTPException(status_code=401, detail="انتهت جلستك أو رمز الدخول غير صالح — سجّل دخولك من جديد.")
    if not is_admin_claims(claims):
        raise HTTPException(status_code=403, detail=NOT_ADMIN)
    return claims["uid"]
