"""
================================================================
UQU Academic Assistant — Admin dashboard API (/admin)
================================================================
"""

import datetime as dt

from fastapi import APIRouter, Depends

from auth.admin import require_admin
import db.firestore as dbmod
from services import admin
from services.quota import _today

router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.get("/me")
async def whoami(uid: str = Depends(require_admin)) -> dict:
    return {"admin": True}


@router.get("/overview")
async def overview(uid: str = Depends(require_admin)) -> dict:
    return admin.overview(dbmod.get_db(), dt.date.fromisoformat(_today()))


@router.get("/tutor-insights")
async def tutor_insights(uid: str = Depends(require_admin)) -> dict:
    """Anonymous, aggregate learning statistics of the dynamic study mode."""
    from services.tutor.analytics import insights

    return insights(dbmod.get_db())


@router.post("/reviews/{code}/{rid}/{action}")
async def moderate(code: str, rid: str, action: str, uid: str = Depends(require_admin)) -> dict:
    return admin.moderate_review(dbmod.get_db(), code, rid, action)
