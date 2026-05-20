"""
================================================================
UQU Academic Assistant — Student Context Service
================================================================
Single source of truth for loading a student's full academic
context from Firestore.

Each Firestore call runs in a thread-pool executor via
asyncio.get_running_loop().run_in_executor() so the event loop
is never blocked. Calls are SEQUENTIAL (not concurrent) to avoid
sharing the synchronous Firebase Admin gRPC channel across
multiple threads simultaneously, which is not thread-safe.

Consumers:
  - routers/chat.py   (system prompt construction)
  - routers/student.py (GET /api/student-context)

Workspace slices (profile, transcript, plan) are loaded via
services.workspace.load_workspace to avoid duplicating canonical
paths and legacy fallbacks.
"""

import asyncio
import logging
from datetime import datetime

from google.cloud.firestore_v1.base_query import FieldFilter

from services.workspace import (
    load_workspace,
    transcript_has_data,
    workspace_plan_to_active_plan,
)

logger = logging.getLogger(__name__)


def load_academic_record(user_ref) -> dict:
    """Read the v3 canonical academic record at users/{uid}/academic_record/main.

    This is the path the frontend writes to via `syncTranscript()` in
    `frontend/src/lib/firebase/sync.ts`. It replaces the legacy flat fields
    that used to live on `users/{uid}` (e.g. `profile.courses`,
    `profile.earnedHours`). Returns `{}` for new accounts so callers can
    use `.get(...)` safely without an existence check.

    Synchronous on purpose — the Firebase Admin SDK is blocking; async
    callers should wrap this in `run_in_executor` (see `load_student_context`).
    """
    snap = user_ref.collection("academic_record").document("main").get()
    return snap.to_dict() if snap.exists else {}


def academic_record_current_courses(record: dict) -> list[dict]:
    """Normalize the current-semester course list out of an academic_record
    document. The frontend's parser produces `registeredCourses`, the
    transcript store rebrands them as `currentCourses` before sync — accept
    either so older docs keep working."""
    if not record:
        return []
    return record.get("currentCourses") or record.get("registeredCourses") or []


def academic_record_completed_courses(record: dict) -> list[dict]:
    """Completed-courses list out of an academic_record document."""
    if not record:
        return []
    return record.get("completedCourses") or []


async def load_student_context(user_id: str, db) -> dict:
    """Load full student context from Firestore without blocking the event loop.

    Runs each Firestore SDK call in the default thread-pool executor
    (one at a time) so the synchronous gRPC channel is never shared
    across concurrent threads.
    """
    loop = asyncio.get_running_loop()
    user_ref = db.collection("users").document(user_id)
    today = datetime.now().strftime("%Y-%m-%d")

    # Shared workspace loader (canonical paths + legacy fallbacks).
    ws = await load_workspace(user_id, db)

    def _fetch_user():
        snap = user_ref.get()
        return snap.to_dict() if snap.exists else {}

    def _fetch_transcript():
        snaps = (
            user_ref.collection("transcripts")
            .order_by("createdAt", direction="DESCENDING")
            .limit(1)
            .get()
        )
        docs = list(snaps)
        return docs[0].to_dict() if docs else None

    def _fetch_semesters():
        snaps = (
            user_ref.collection("semesters")
            .order_by("createdAt", direction="ASCENDING")
            .limit(20)
            .get()
        )
        return [d.to_dict() for d in snaps]

    def _fetch_exams():
        snaps = (
            user_ref.collection("exams")
            .where(filter=FieldFilter("done", "==", False))
            .where(filter=FieldFilter("date", ">=", today))
            .order_by("date")
            .limit(10)
            .get()
        )
        return [d.to_dict() for d in snaps]

    user_data = await loop.run_in_executor(None, _fetch_user)
    transcript = await loop.run_in_executor(None, _fetch_transcript)
    semesters = await loop.run_in_executor(None, _fetch_semesters)
    upcoming_exams = await loop.run_in_executor(None, _fetch_exams)

    academic_record = (
        ws["transcript"] if transcript_has_data(ws.get("transcript")) else {}
    )
    active_plan = workspace_plan_to_active_plan(ws.get("plan"))

    # ── v3 schema merge ────────────────────────────────────────────────
    # The frontend now stores the parsed transcript + current courses at
    # users/{uid}/academic_record/main. Project those fields into the
    # legacy shapes (`user_data.profile.courses`, transcript.courses) so
    # the system prompt and any tool still reading the old keys keep
    # working without a deeper refactor.
    # Canonical profile name (Profile page / workspace basic) — not transcript name.
    ws_basic = (ws.get("profile") or {}).get("basic") or {}
    profile = user_data.setdefault("profile", {})
    canonical_name = (ws_basic.get("name") or "").strip()
    if not canonical_name:
        root_basic = user_data.get("basic") or {}
        canonical_name = (root_basic.get("name") or "").strip()
    if canonical_name:
        profile["name"] = canonical_name

    if academic_record:
        current_courses = academic_record_current_courses(academic_record)
        if current_courses and not profile.get("courses"):
            profile["courses"] = current_courses

        # Promote top-level stats so prompt blocks that read profile.gpa
        # / earnedHours still find a value. Name stays profile/basic only.
        for key in ("gpa", "earnedHours", "planHours", "major", "studentId"):
            val = academic_record.get(key)
            if val is not None and not profile.get(key):
                if key == "gpa":
                    profile["currentGpa"] = val
                else:
                    profile[key] = val

        # If there's no transcripts-collection doc yet, synthesize one
        # from academic_record so downstream code that iterates
        # `transcript["courses"]` (e.g. analyze_transcript fallback) has
        # something to work with.
        completed = academic_record_completed_courses(academic_record)
        if transcript is None and completed:
            transcript = {
                "courses": completed,
                "semesters": semesters,
                "source": "academic_record",
            }
        elif transcript is not None and not transcript.get("courses") and completed:
            transcript["courses"] = completed

    # ── Merge semesters into transcript ──
    if transcript and not transcript.get("semesters") and semesters:
        transcript["semesters"] = semesters
    elif not transcript and semesters:
        transcript = {"courses": [], "semesters": semesters}

    logger.debug(
        "[student_ctx] uid=%s profile=%s academic_record=%s transcript=%s semesters=%d exams=%d plan=%s",
        user_id, bool(user_data), bool(academic_record), bool(transcript),
        len(semesters), len(upcoming_exams), bool(active_plan),
    )

    return {
        "user_data": user_data,
        "academic_record": academic_record,
        "transcript": transcript,
        "upcoming_exams": upcoming_exams,
        "active_plan": active_plan,
        "notifications": ws.get("notifications") or [],
    }
