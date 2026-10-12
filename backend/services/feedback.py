"""👍/👎 ratings on assistant replies — stored server-side for quality review."""

from __future__ import annotations

import datetime as dt
import hashlib


def save_feedback(db, uid: str, payload: dict) -> dict:
    rating = payload.get("rating")
    if rating not in ("up", "down", None):
        raise ValueError("rating must be up, down or null")
    answer = str(payload.get("answer") or "")[:4000]
    question = str(payload.get("question") or "")[:2000]
    conv = str(payload.get("conversationId") or "")[:100]
    fid = hashlib.sha256(f"{uid}|{conv}|{answer}".encode()).hexdigest()[:24]
    ref = db.collection("feedback").document(fid)
    if rating is None:  # un-rate
        ref.delete()
        return {"success": True, "id": fid, "rating": None}
    ref.set({
        "uid": uid,
        "rating": rating,
        "comment": str(payload.get("comment") or "")[:1000],
        "question": question,
        "answer": answer,
        "tools": [str(t)[:60] for t in (payload.get("tools") or [])][:10],
        "conversationId": conv,
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    })
    return {"success": True, "id": fid, "rating": rating}
