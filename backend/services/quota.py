"""
================================================================
UQU Academic Assistant — Daily AI usage quota
================================================================
Every AI-backed endpoint spends "credits" from a per-user daily
budget, so one account cannot exhaust the shared Gemini/OpenAI quota
(or, later, run up a bill).

Storage: top-level collection `ai_usage/{uid}` → {date, used}.
It lives outside users/{uid} on purpose: firestore.rules deny all
client access to it, so a user cannot reset their own counter.
The day rolls over at midnight Riyadh time.
================================================================
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from google.cloud import firestore

from config import get_settings
from db.firestore import get_db

logger = logging.getLogger(__name__)

_RIYADH = timezone(timedelta(hours=3))

# Relative cost of each feature (≈ how many model calls / how heavy).
COST_CHAT = 1
COST_STT = 1
COST_TRANSCRIPT_ANALYSIS = 3
COST_SCHEDULE_VISION = 5
COST_PLAN_GENERATION = 5
COST_STUDY_PDF = 5

QUOTA_EXCEEDED_MESSAGE = (
    "⏳ وصلت للحد اليومي لاستخدام المساعد الذكي. "
    "يتجدد رصيدك تلقائيًا الساعة 12 منتصف الليل."
)


class QuotaExceeded(Exception):
    """Raised when a user has no credits left for today."""

    def __init__(self, used: int, limit: int) -> None:
        super().__init__(f"AI quota exceeded ({used}/{limit})")
        self.used = used
        self.limit = limit


def _today() -> str:
    return datetime.now(_RIYADH).date().isoformat()


def consume_ai_credits(user_id: str, cost: int = 1) -> int:
    """Atomically spend `cost` credits; return credits left today.

    Raises QuotaExceeded when the spend would go over the daily limit.
    A limit of 0 or less disables the quota (useful for local testing).
    """
    limit = get_settings().DAILY_AI_CREDITS
    if limit <= 0:
        return -1

    db = get_db()
    ref = db.collection("ai_usage").document(user_id)
    today = _today()

    @firestore.transactional
    def _spend(transaction: firestore.Transaction) -> int:
        snap = ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        used = int(data.get("used", 0)) if data.get("date") == today else 0
        if used + cost > limit:
            raise QuotaExceeded(used, limit)
        transaction.set(ref, {
            "date": today,
            "used": used + cost,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        return limit - used - cost

    return _spend(db.transaction())


def require_ai_credits(user_id: str, cost: int) -> None:
    """Endpoint helper: spend credits or raise HTTP 429 with an Arabic message."""
    try:
        consume_ai_credits(user_id, cost)
    except QuotaExceeded as exc:
        logger.info("[quota] user=%s blocked (%d/%d)", user_id, exc.used, exc.limit)
        raise HTTPException(status_code=429, detail=QUOTA_EXCEEDED_MESSAGE)
