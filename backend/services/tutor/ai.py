"""
The only place the study mode reaches the model.

Every call asks for JSON with:
  • a JSON Schema (structured output) when one is given, so the reply cannot
    be malformed — shell commands with quotes and backslashes used to break it;
  • low thinking: the tutor's decisions are made in code, the model writes
    content. Gemini 3 counts thinking against the output limit, so less of it
    also means fewer cut-off replies.

If the API refuses either option (HTTP 400 — e.g. a model configured in .env
that does not support it), the call is repeated once without it and the
option stays off for this process, so a configuration mismatch costs one
extra request, not a broken feature.

Then the existing policy: main model, and on overload / unreadable reply the
fast model. Every failure is logged with its reason.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from common.errors import AI_BAD_REPLY_MESSAGE, AI_EMPTY_REPLY_MESSAGE, RETRYABLE_UPSTREAM
from config import get_settings
from services import gemini

logger = logging.getLogger(__name__)

THINKING_LEVEL = "low"

# Options the API refused in this process (see module docstring).
_disabled: set[str] = set()


def _retryable(exc: HTTPException) -> bool:
    # An unreadable / empty reply (e.g. JSON cut off at the token limit) is
    # worth one more try on the other model.
    if exc.detail in (AI_BAD_REPLY_MESSAGE, AI_EMPTY_REPLY_MESSAGE):
        return True
    upstream = getattr(exc, "upstream_status", None)
    if upstream is not None:
        return upstream in RETRYABLE_UPSTREAM
    d = str(exc.detail)
    return any(k in d for k in ("RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "429", "503", "500"))


def _refused_options(exc: HTTPException, sent: set[str]) -> set[str]:
    """Which of the options we sent a 400 is about (all of them if unclear)."""
    if getattr(exc, "upstream_status", None) != 400 or not sent:
        return set()
    msg = str(getattr(exc, "upstream_message", "")).lower()
    named = {o for o, keys in (("thinking", ("thinking",)), ("schema", ("schema", "response_json", "responsejson"))) if any(k in msg for k in keys)}
    return (named & sent) or set(sent)


async def ask_json(
    prompt: str,
    user: str,
    *,
    pdf: bytes | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    timeout: float = 120.0,
    schema: dict | None = None,
    kind: str = "tutor",
) -> Any:
    s = get_settings()
    last: HTTPException | None = None
    for model in dict.fromkeys([s.GEMINI_MODEL, s.GEMINI_FAST_MODEL]):
        for _ in range(3):  # at most: with options → without the refused one(s) → plain
            sent = {o for o, on in (("schema", schema is not None), ("thinking", True)) if on and o not in _disabled}
            try:
                return await gemini.call_gemini(
                    system_prompt=prompt,
                    user_content=user,
                    temperature=temperature,
                    response_mime_type="application/json",
                    file_data=pdf,
                    mime_type="application/pdf" if pdf else None,
                    timeout_seconds=timeout,
                    max_output_tokens=max_tokens,
                    model=model,
                    response_json_schema=schema if "schema" in sent else None,
                    thinking_level=THINKING_LEVEL if "thinking" in sent else None,
                )
            except HTTPException as exc:
                refused = _refused_options(exc, sent)
                if refused:
                    _disabled.update(refused)
                    logger.warning("[tutor.ai] %s refused %s (%s) — retrying without", model, sorted(refused), getattr(exc, "upstream_message", "")[:160])
                    continue
                last = exc
                logger.warning("[tutor.ai] %s failed for %s: %s (upstream=%s)", model, kind, str(exc.detail)[:120], getattr(exc, "upstream_status", None))
                if not _retryable(exc):
                    raise
                break
    assert last is not None
    raise last
