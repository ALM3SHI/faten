"""
Shared HTTP 410 responses for deprecated legacy write endpoints (Phase 4C.1).

Placed under common/ (not http/) to avoid shadowing the stdlib http package.
"""

from __future__ import annotations

import logging
from typing import Sequence

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

PHASE = "4C.1"
CODE = "ENDPOINT_DEPRECATED"


def raise_deprecated_endpoint(
    *,
    method: str,
    path: str,
    replacement: str,
    legacy_firestore_paths: Sequence[str],
    user_id: str | None = None,
) -> None:
    """Raise HTTP 410 Gone with a structured body; never writes to Firestore."""
    endpoint = f"{method.upper()} {path}"
    logger.warning(
        "[deprecated] %s uid=%s replacement=%s",
        endpoint,
        user_id or "(unknown)",
        replacement,
    )
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={
            "success": False,
            "deprecated": True,
            "code": CODE,
            "endpoint": endpoint,
            "message": "This endpoint is deprecated and no longer writes to Firestore.",
            "replacement": replacement,
            "legacyFirestorePaths": list(legacy_firestore_paths),
            "phase": PHASE,
        },
    )
