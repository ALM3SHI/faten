"""
================================================================
UQU Academic Assistant — Student Context Router
================================================================
Converts: exports.getStudentContext from index.js lines 342-364
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from auth.dependencies import get_current_user
from db.firestore import get_db
from services.student import load_student_context

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Student"])


async def _get_student_context_logic(user_id: str):
    """Core logic shared by both route aliases."""
    try:
        db = get_db()

        ctx = await load_student_context(user_id, db)

        return {
            "success": True,
            **ctx,
        }

    except Exception as err:
        logger.error(f"[getStudentContext] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))


@router.get("/api/student-context")
async def get_student_context(
    user_id: str = Depends(get_current_user),
):
    return await _get_student_context_logic(user_id)

