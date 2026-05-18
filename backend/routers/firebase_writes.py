"""
================================================================
UQU Academic Assistant — Firebase Writes Router
================================================================
1:1 server-side ports of the direct Firestore writes from
assets/firebase-db.js:
  - pushPlanToFirestore       → POST /api/firebase/push-plan
  - pushChatToFirestore       → POST /api/firebase/push-chat
  - pushTranscriptToFirestore → POST /api/firebase/push-transcript
  - syncSemestersToFirestore  → POST /api/firebase/sync-semesters

Each endpoint preserves the EXACT Firestore path and document shape
written by the JS so the realtime onSnapshot listeners (which still
run in the frontend per the architecture rule) keep producing the
same data structures consumed by every UI page.

Note: pushProfileToFirestore is NOT migrated here because firebase-db.js
already routes it through the existing /syncProfile endpoint.
logCompletedSession is handled by /api/pomodoro/log-session (Module 4).
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from auth.bearer import verify_firebase_token
from db.firestore import get_db
from schemas.firebase_writes import (
    PushPlanRequest,
    PushChatRequest,
    PushTranscriptRequest,
    SyncSemestersRequest,
    FirebaseWriteResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/firebase", tags=["Firebase Writes"])


def _now_iso() -> str:
    """ISO timestamp matching JS new Date().toISOString()."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ──────────────────────────────────────────────
# 1. PUSH STUDY PLAN
# ──────────────────────────────────────────────

@router.post("/push-plan", response_model=FirebaseWriteResponse)
async def push_plan(
    body: PushPlanRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Mirror of pushPlanToFirestore(planData):
        users/{uid}/study_plans → add({ ...planData, createdAt })
    """
    db = get_db()
    try:
        doc_payload = {**body.plan, "createdAt": _now_iso()}
        ref = (
            db.collection("users").document(user_id)
            .collection("study_plans").add(doc_payload)
        )
        doc_ref = ref[1] if isinstance(ref, tuple) else ref
        return FirebaseWriteResponse(success=True, id=doc_ref.id)
    except Exception as e:
        logger.error(f"push_plan failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل حفظ الخطة الدراسية",
        )


# ──────────────────────────────────────────────
# 2. PUSH CHAT (full conversation document, merge)
# ──────────────────────────────────────────────

@router.post("/push-chat", response_model=FirebaseWriteResponse)
async def push_chat(
    body: PushChatRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Mirror of pushChatToFirestore(conversationId, messages, title):
        users/{uid}/chat_history/{conversationId}.set(
          { title, messages, updatedAt }, merge=True
        )
    """
    db = get_db()
    try:
        doc_payload = {
            "title": body.title or "محادثة جديدة",
            "messages": body.messages,
            "updatedAt": _now_iso(),
        }
        ref = (
            db.collection("users").document(user_id)
            .collection("chat_history").document(str(body.conversationId))
        )
        ref.set(doc_payload, merge=True)
        return FirebaseWriteResponse(success=True, id=str(body.conversationId))
    except Exception as e:
        logger.error(f"push_chat failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل حفظ سجل المحادثة",
        )


# ──────────────────────────────────────────────
# 3. PUSH TRANSCRIPT (academic_records collection, type='transcript')
# ──────────────────────────────────────────────

@router.post("/push-transcript", response_model=FirebaseWriteResponse)
async def push_transcript(
    body: PushTranscriptRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Mirror of pushTranscriptToFirestore(courses, cgpa, totalHours, semesters):
        users/{uid}/academic_records.add({
          type: 'transcript', courses, semesters, cgpa, totalHours, createdAt
        })

    NOTE: this writes to academic_records (matching the JS behavior).
    The existing /syncTranscript endpoint writes to a different collection
    (transcripts) and runs AI analysis — both are preserved per 1:1.
    """
    db = get_db()
    try:
        now = _now_iso()
        doc_payload = {
            "type": "transcript",
            "courses": body.courses or [],
            "semesters": body.semesters or [],
            "cgpa": body.cgpa,
            "totalHours": body.totalHours,
            "createdAt": now,
        }
        ref = (
            db.collection("users").document(user_id)
            .collection("academic_records").add(doc_payload)
        )
        doc_ref = ref[1] if isinstance(ref, tuple) else ref

        # Also sync semesters to dedicated docs (mirrors JS behavior — the
        # JS calls syncSemestersToFirestore inline after pushTranscript).
        semester_ids: list[str] = []
        if body.semesters:
            for sem in body.semesters:
                sem_payload = {
                    "type": "semester",
                    **sem,
                    "createdAt": sem.get("createdAt") or now,
                }
                sem_ref = (
                    db.collection("users").document(user_id)
                    .collection("academic_records").add(sem_payload)
                )
                sem_doc = sem_ref[1] if isinstance(sem_ref, tuple) else sem_ref
                semester_ids.append(sem_doc.id)

        return FirebaseWriteResponse(
            success=True,
            id=doc_ref.id,
            ids=semester_ids if semester_ids else None,
        )
    except Exception as e:
        logger.error(f"push_transcript failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل حفظ السجل الأكاديمي",
        )


# ──────────────────────────────────────────────
# 4. SYNC SEMESTERS (academic_records, type='semester' per doc)
# ──────────────────────────────────────────────

@router.post("/sync-semesters", response_model=FirebaseWriteResponse)
async def sync_semesters(
    body: SyncSemestersRequest,
    user_id: str = Depends(verify_firebase_token),
) -> FirebaseWriteResponse:
    """Mirror of syncSemestersToFirestore(semesters):
        for each sem:
          users/{uid}/academic_records.add({
            type: 'semester', ...sem, createdAt: sem.createdAt or now
          })
    """
    if not body.semesters:
        return FirebaseWriteResponse(success=True, ids=[])

    db = get_db()
    try:
        now = _now_iso()
        ids: list[str] = []
        for sem in body.semesters:
            payload = {
                "type": "semester",
                **sem,
                "createdAt": sem.get("createdAt") or now,
            }
            ref = (
                db.collection("users").document(user_id)
                .collection("academic_records").add(payload)
            )
            doc_ref = ref[1] if isinstance(ref, tuple) else ref
            ids.append(doc_ref.id)
        return FirebaseWriteResponse(success=True, ids=ids)
    except Exception as e:
        logger.error(f"sync_semesters failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل مزامنة الفصول",
        )
