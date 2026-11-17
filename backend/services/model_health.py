"""
Which AI models are answering right now — shared by every tool.

Measured on real lectures (evals/course_eval.py, Nov 2026): the main Gemini
model can answer "high demand" (503) or "quota" (429) for long stretches
while the fast model still works. Before, every request — a chat message, a
lesson, a schedule photo — first waited for the busy model to fail.

Now a model that answers 503/429 is remembered as busy for a short while,
and requests for it go straight to the fast model until then.
"""

from __future__ import annotations

import time

BUSY_SECONDS = 120.0
BUSY_STATUSES = frozenset({429, 503})

_busy_until: dict[str, float] = {}


def mark_busy(model: str | None, seconds: float = BUSY_SECONDS) -> None:
    if model:
        _busy_until[model] = time.monotonic() + seconds


def is_busy(model: str | None) -> bool:
    return bool(model) and _busy_until.get(model, 0.0) > time.monotonic()


def prefer(model: str, fallback: str | None) -> str:
    """`model`, unless it is busy and `fallback` is not."""
    if fallback and fallback != model and is_busy(model) and not is_busy(fallback):
        return fallback
    return model


def reset() -> None:
    _busy_until.clear()
