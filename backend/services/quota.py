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
# Dynamic study mode (services/tutor): reading + structuring a lecture once;
# a topic lesson with its question bank; one grading / re-explanation / answer.
COST_TUTOR_INGEST = 5
COST_TUTOR_LESSON = 2
COST_TUTOR_SMALL = 1

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
            # credits given back today for failed requests (refund_ai_credits)
            "refunded": int(data.get("refunded", 0)) if data.get("date") == today else 0,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        return limit - used - cost

    return _spend(db.transaction())


def require_ai_credits(user_id: str, cost: int) -> str | None:
    """Endpoint helper: spend credits or raise HTTP 429 with an Arabic message.

    Returns the Riyadh day the credits were taken from (None when the quota is
    disabled), which refund_ai_credits needs to give them back safely.
    """
    try:
        left = consume_ai_credits(user_id, cost)
    except QuotaExceeded as exc:
        logger.info("[quota] user=%s blocked (%d/%d)", user_id, exc.used, exc.limit)
        raise HTTPException(status_code=429, detail=QUOTA_EXCEEDED_MESSAGE)
    return None if left < 0 else _today()


def refund_ai_credits(user_id: str, cost: int, day: str | None) -> bool:
    """Give back credits spent on `day` for a request that produced nothing.

    Safe by construction:
      • only the same day's counter is touched — after midnight the student
        already has a fresh budget, so nothing is taken from the new day;
      • `used` never goes below zero;
      • `refunded` keeps a running total, so the usage numbers stay honest.
    Callers keep their own list of charges and refund each one once.
    """
    if not day or cost <= 0:
        return False
    db = get_db()
    ref = db.collection("ai_usage").document(user_id)

    @firestore.transactional
    def _give_back(transaction: firestore.Transaction) -> bool:
        snap = ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        if data.get("date") != day:
            return False
        used = int(data.get("used", 0))
        transaction.set(ref, {
            "date": day,
            "used": max(0, used - cost),
            "refunded": int(data.get("refunded", 0)) + min(cost, used),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        return True

    try:
        done = _give_back(db.transaction())
    except Exception as exc:  # a refund must never turn a handled error into a crash
        logger.warning("[quota] refund failed user=%s cost=%d: %s", user_id, cost, exc)
        return False
    if done:
        logger.info("[quota] refunded %d credit(s) to user=%s", cost, user_id)
    return done


class CreditLedger:
    """Charges made while serving one request, so a failure can refund them.

        ledger = CreditLedger(uid)
        ledger.charge(2)          # raises HTTP 429 when the budget is spent
        ...                       # the work
        ledger.refund_all()       # on failure: each charge returned exactly once
    """

    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        self._charges: list[tuple[int, str | None]] = []

    def charge(self, cost: int) -> None:
        day = require_ai_credits(self.user_id, cost)
        self._charges.append((cost, day))

    @property
    def total(self) -> int:
        return sum(c for c, _ in self._charges)

    def refund_all(self) -> int:
        charges, self._charges = self._charges, []
        return sum(cost for cost, day in charges if refund_ai_credits(self.user_id, cost, day))
