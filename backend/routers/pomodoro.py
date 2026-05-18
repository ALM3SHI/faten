"""
================================================================
UQU Academic Assistant — Pomodoro Router
================================================================
Complete Pomodoro backend: session logging, statistics calculation,
and session fetching. Replaces the Firebase direct-writes and
client-side stat computation from assets/pomodoro.js.

Endpoints:
  POST   /api/pomodoro/log-session      — Log a completed session
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import firestore as fb_firestore

from auth.bearer import verify_firebase_token
from db.firestore import get_db
from schemas.pomodoro import PomodoroSessionLog, PomodoroLogResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pomodoro", tags=["Pomodoro"])


@router.post("/log", response_model=PomodoroLogResponse)
@router.post("/log-session", response_model=PomodoroLogResponse, include_in_schema=False)
async def log_completed_session(
    body: PomodoroSessionLog,
    user_id: str = Depends(verify_firebase_token),
) -> PomodoroLogResponse:
    """Record a completed Pomodoro session to Firestore."""
    db = get_db()
    try:
        doc_payload = {
            "courseCode": body.courseCode or "عام",
            "courseName": body.courseName or "مذاكرة عامة",
            "duration": int(body.duration),
            "type": body.type or "focus",
            "date": body.date or datetime.now().strftime("%Y-%m-%d"),
            "completedAt": body.completedAt or datetime.now().isoformat(),
            "loggedAt": fb_firestore.SERVER_TIMESTAMP,
        }
        ref = (
            db.collection("users")
            .document(user_id)
            .collection("completed_sessions")
            .add(doc_payload)
        )
        doc_ref = ref[1] if isinstance(ref, tuple) else ref
        return PomodoroLogResponse(success=True, id=doc_ref.id)
    except Exception as e:
        logger.error(f"Failed to log pomodoro session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل تسجيل جلسة البومودورو",
        )


