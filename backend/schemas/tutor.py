"""Request bodies of the dynamic study mode (/api/tutor)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class StepRequest(BaseModel):
    action: str = Field(..., max_length=32)
    payload: dict[str, Any] = Field(default_factory=dict)
    # progress.version the browser last saw — a mismatch means another tab or
    # device moved the session on, so the request is refused before any cost.
    version: int = Field(..., ge=0)


class FocusState(BaseModel):
    """Pomodoro inside a study session. Times are absolute (ISO), so the
    remaining time is right even if the page was closed in between."""

    mode: Literal["idle", "focus", "break"] = "idle"
    startedAt: str | None = Field(default=None, max_length=40)
    durationSec: int = Field(default=0, ge=0, le=4 * 3600)
    pausedAt: str | None = Field(default=None, max_length=40)
    pausedTotalSec: int = Field(default=0, ge=0, le=24 * 3600)
    focusMin: int = Field(default=25, ge=5, le=120)
    breakMin: int = Field(default=5, ge=1, le=60)
    completedFocus: int = Field(default=0, ge=0, le=1000)
