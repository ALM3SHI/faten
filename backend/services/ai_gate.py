"""
One shared budget for every call Faten makes to the AI provider.

Each student has a daily credit allowance (services/quota.py), but the
provider's free tier limits the *project*: requests per minute and per day
for the whole API key. Without a shared gate a busy minute makes Google
answer 429 to everyone, our retries and model fallbacks then spend even
more of that limit, and students see failures they were charged for.

The gate keeps us just under those limits:
  • AI_MAX_PER_MINUTE  sliding 60-second window (0 = off);
  • AI_MAX_CONCURRENT  calls in flight at once (0 = off);
  • AI_MAX_PER_DAY     calls per UTC day (0 = off).
A call that does not fit waits in line for up to AI_QUEUE_WAIT_SECONDS, then
fails fast with a clear Arabic "busy" message (AIBusyError). That error is
deliberately *not* retryable, so callers do not hammer the provider.

The counters live in memory: Render's free plan runs a single process, so
this is the whole server. A restart resets the daily count (Google's own
limit still applies behind it).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from common.errors import AI_BUSY_DAY_MESSAGE, AI_BUSY_MESSAGE, UpstreamAIError
from config import get_settings

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60.0


class AIBusyError(UpstreamAIError):
    """Faten's shared AI budget is full right now (not a provider error)."""

    def __init__(self, detail: str = AI_BUSY_MESSAGE):
        # upstream_status=None → not treated as a retryable provider failure.
        super().__init__(upstream_status=None, status_code=429, detail=detail)


class AIGate:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._cond: asyncio.Condition | None = None
        self._stamps: deque[float] = deque()
        self._inflight = 0
        self._day = ""
        self._day_count = 0
        self.rejected = 0

    # asyncio primitives belong to one event loop; tests start several.
    def _condition(self) -> asyncio.Condition:
        loop = asyncio.get_running_loop()
        if self._cond is None or self._loop is not loop:
            self._loop, self._cond = loop, asyncio.Condition()
            self._inflight = 0
        return self._cond

    def _prune(self, now: float) -> None:
        while self._stamps and now - self._stamps[0] >= WINDOW_SECONDS:
            self._stamps.popleft()

    def _roll_day(self) -> None:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today != self._day:
            self._day, self._day_count = today, 0

    def snapshot(self) -> dict:
        self._prune(time.monotonic())
        self._roll_day()
        s = get_settings()
        return {
            "last_minute": len(self._stamps),
            "per_minute_limit": s.AI_MAX_PER_MINUTE,
            "in_flight": self._inflight,
            "concurrent_limit": s.AI_MAX_CONCURRENT,
            "today": self._day_count,
            "per_day_limit": s.AI_MAX_PER_DAY,
            "rejected": self.rejected,
        }

    async def acquire(self) -> None:
        s = get_settings()
        cond = self._condition()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(0.0, float(s.AI_QUEUE_WAIT_SECONDS))
        async with cond:
            while True:
                now = time.monotonic()
                self._prune(now)
                self._roll_day()
                if s.AI_MAX_PER_DAY > 0 and self._day_count >= s.AI_MAX_PER_DAY:
                    self.rejected += 1
                    logger.warning("[ai-gate] daily budget used up (%d calls)", self._day_count)
                    raise AIBusyError(AI_BUSY_DAY_MESSAGE)
                room_now = s.AI_MAX_CONCURRENT <= 0 or self._inflight < s.AI_MAX_CONCURRENT
                room_minute = s.AI_MAX_PER_MINUTE <= 0 or len(self._stamps) < s.AI_MAX_PER_MINUTE
                if room_now and room_minute:
                    self._inflight += 1
                    self._stamps.append(now)
                    self._day_count += 1
                    return
                left = deadline - loop.time()
                if left <= 0:
                    self.rejected += 1
                    logger.warning(
                        "[ai-gate] busy: %d in flight, %d in the last minute — request turned away",
                        self._inflight, len(self._stamps),
                    )
                    raise AIBusyError()
                pause = left
                if not room_minute and self._stamps:
                    pause = min(pause, self._stamps[0] + WINDOW_SECONDS - now + 0.01)
                try:
                    await asyncio.wait_for(cond.wait(), timeout=max(pause, 0.01))
                except asyncio.TimeoutError:
                    pass

    async def release(self) -> None:
        cond = self._condition()
        async with cond:
            self._inflight = max(0, self._inflight - 1)
            cond.notify_all()

    @asynccontextmanager
    async def slot(self):
        await self.acquire()
        try:
            yield
        finally:
            await self.release()

    def reset(self) -> None:
        self.__init__()


gate = AIGate()
