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


def summarize_feedback(rows: list[dict], limit: int = 20) -> dict:
    """Aggregate feedback docs for the owner's report (no uids exposed)."""
    up = sum(1 for r in rows if r.get("rating") == "up")
    down = [r for r in rows if r.get("rating") == "down"]
    by_tool: dict[str, dict[str, int]] = {}
    for r in rows:
        for t in r.get("tools") or ["(بدون أداة)"]:
            s = by_tool.setdefault(t, {"up": 0, "down": 0})
            if r.get("rating") in s:
                s[r["rating"]] += 1
    down.sort(key=lambda r: r.get("createdAt") or "", reverse=True)
    total = up + len(down)
    return {
        "total": total,
        "up": up,
        "down": len(down),
        "satisfaction": round(up / total * 100) if total else None,
        "by_tool": dict(sorted(by_tool.items(), key=lambda kv: -kv[1]["down"])),
        "recent_down": [
            {k: r.get(k) for k in ("createdAt", "question", "answer", "comment", "tools")}
            for r in down[:limit]
        ],
    }
