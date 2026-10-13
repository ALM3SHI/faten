"""
Numbers for the admin dashboard (/admin). Reads only aggregate data and the
anonymous 👍/👎 feedback — no names, emails or uids leave this module.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from fastapi import HTTPException

from services.feedback import summarize_feedback

FEEDBACK_DAYS = 30


def _since(today: dt.date, days: int) -> str:
    return (today - dt.timedelta(days=days - 1)).isoformat()


def user_stats(db, today: dt.date) -> dict[str, int]:
    created = [str((s.to_dict() or {}).get("createdAt") or "") for s in db.collection("users").stream()]
    return {
        "total": len(created),
        "new_7d": sum(1 for c in created if c[:10] >= _since(today, 7)),
        "new_30d": sum(1 for c in created if c[:10] >= _since(today, 30)),
    }


def usage_stats(db, today: dt.date) -> dict[str, int]:
    """ai_usage/{uid} keeps the last day a student used the assistant and how much."""
    rows = [s.to_dict() or {} for s in db.collection("ai_usage").stream()]
    day = today.isoformat()
    return {
        "active_today": sum(1 for r in rows if r.get("date") == day),
        "active_7d": sum(1 for r in rows if str(r.get("date") or "") >= _since(today, 7)),
        "requests_today": sum(int(r.get("used") or 0) for r in rows if r.get("date") == day),
    }


def feedback_stats(db, today: dt.date, limit: int = 15) -> dict[str, Any]:
    since = _since(today, FEEDBACK_DAYS)
    rows = [s.to_dict() or {} for s in db.collection("feedback").stream()]
    recent = [r for r in rows if str(r.get("createdAt") or "")[:10] >= since]
    return {"days": FEEDBACK_DAYS, **summarize_feedback(recent, limit)}


def reported_reviews(db) -> list[dict[str, Any]]:
    out = []
    for course in db.collection("course_reviews").stream():
        agg = course.to_dict() or {}
        for rev in db.collection("course_reviews").document(course.id).collection("reviews").stream():
            r = rev.to_dict() or {}
            if not r.get("reports"):
                continue
            out.append({
                "code": course.id,
                "course": agg.get("name") or course.id,
                "id": rev.id,
                "tip": r.get("tip", ""),
                "reports": len(r.get("reports") or []),
                "hidden": bool(r.get("hidden")),
                "updatedAt": r.get("updatedAt"),
            })
    # Most-reported first, newest first among equals.
    out.sort(key=lambda x: (x["reports"], str(x["updatedAt"] or "")), reverse=True)
    return out


def overview(db, today: dt.date) -> dict[str, Any]:
    from services.push import users_with_devices

    return {
        "users": user_stats(db, today),
        "usage": usage_stats(db, today),
        "devices": len(users_with_devices(db)),
        "feedback": feedback_stats(db, today),
        "reported_reviews": reported_reviews(db),
    }


def moderate_review(db, code: str, rid: str, action: str) -> dict[str, Any]:
    """'restore' shows the review again and clears its reports; 'hide' keeps it hidden."""
    from services.community import normalize_code

    if action not in ("restore", "hide"):
        raise HTTPException(status_code=400, detail="إجراء غير معروف.")
    if not re.fullmatch(r"[0-9a-f]{20}", rid or ""):
        raise HTTPException(status_code=400, detail="معرّف غير صالح")
    ref = db.collection("course_reviews").document(normalize_code(code)).collection("reviews").document(rid)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="التقييم غير موجود.")
    ref.update({"hidden": False, "reports": []} if action == "restore" else {"hidden": True})
    return {"success": True}
