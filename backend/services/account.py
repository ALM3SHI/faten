"""
Full account deletion (PDPL right to erasure).

Removes, in order:
  1. the student's course reviews (through delete_review so averages stay right)
  2. everything under users/{uid} (profile, record, schedule, plan, chats,
     attendance, memory, notifications, …)
  3. ai_usage/{uid} and the student's reply ratings in `feedback`
  4. the Firebase Auth user (last, so a failure above can be retried)
"""

from __future__ import annotations

import logging
from typing import Callable

from db.firestore import get_db

logger = logging.getLogger(__name__)


def _delete_tree(db, ref) -> int:
    """Delete a document and all its subcollections. Returns docs deleted."""
    recursive = getattr(db, "recursive_delete", None)
    if recursive is not None:
        return recursive(ref) or 0
    count = 0
    for col in ref.collections():
        for doc in col.stream():
            count += _delete_tree(db, doc.reference)
    ref.delete()
    return count + 1


def delete_account(uid: str, delete_auth_user: Callable[[str], None] | None = None) -> dict:
    from services.community import delete_review, review_id

    db = get_db()
    reviews = 0
    for agg in db.collection("course_reviews").stream():
        code = agg.id
        if agg.reference.collection("reviews").document(review_id(uid, code)).get().exists:
            delete_review(uid, code)
            reviews += 1

    docs = _delete_tree(db, db.collection("users").document(uid))
    db.collection("ai_usage").document(uid).delete()
    feedback = 0
    for snap in db.collection("feedback").where("uid", "==", uid).stream():
        snap.reference.delete()
        feedback += 1

    if delete_auth_user is None:
        from firebase_admin import auth as fb_auth
        delete_auth_user = fb_auth.delete_user
    try:
        delete_auth_user(uid)
    except Exception as exc:  # user already gone is fine
        if "not found" not in str(exc).lower() and "USER_NOT_FOUND" not in str(exc):
            raise
    logger.info("[account] deleted uid=%s docs=%d reviews=%d feedback=%d", uid, docs, reviews, feedback)
    return {"success": True, "reviews_deleted": reviews, "feedback_deleted": feedback}
