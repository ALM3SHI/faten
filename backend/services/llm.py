"""
================================================================
UQU Academic Assistant — LLM client factory
================================================================
Single place that decides which AI provider powers the chat agent,
intent classifier, transcript advisor, daily notifications and the
plan-generator fallback.

Every provider is reached through the OpenAI Chat Completions API:
  • AI_PROVIDER=gemini (default) → Google's OpenAI-compatible endpoint,
    authenticated with GEMINI_API_KEY (free tier available).
  • AI_PROVIDER=openai → api.openai.com with OPENAI_API_KEY.

Callers keep using `client.chat.completions.create(...)` exactly as
before; the wrapper below adjusts request parameters for the active
provider so no caller needs provider-specific code.
================================================================
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from openai import AsyncOpenAI

from config import get_settings

GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _tune_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    """Adapt Chat Completions kwargs to the active provider."""
    settings = get_settings()
    if settings.ai_provider == "gemini":
        # Gemini counts its internal reasoning against max_tokens, so the
        # tiny limits used for JSON intent classification (20–80 tokens)
        # would leave no room for the actual answer.
        if "max_tokens" in kwargs:
            kwargs["max_tokens"] = max(int(kwargs["max_tokens"]), 2048)
        # Keep latency low — the agent already reasons through tool calls.
        kwargs.setdefault("reasoning_effort", settings.GEMINI_REASONING_EFFORT)
    return kwargs


class _TunedCompletions:
    def __init__(self, inner: Any) -> None:
        self._inner = inner

    async def create(self, **kwargs: Any) -> Any:
        return await self._inner.create(**_tune_kwargs(kwargs))


class LLMClient:
    """Thin wrapper around AsyncOpenAI that tunes every completion call."""

    def __init__(self, client: AsyncOpenAI) -> None:
        self._client = client
        self.chat = SimpleNamespace(completions=_TunedCompletions(client.chat.completions))

    async def close(self) -> None:
        await self._client.close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def make_llm_client(**client_kwargs: Any) -> LLMClient:
    """Create a client for the configured provider."""
    settings = get_settings()
    base_url = GEMINI_OPENAI_BASE_URL if settings.ai_provider == "gemini" else None
    client = AsyncOpenAI(
        # The SDK refuses an empty key at construction time; a placeholder
        # lets the server boot and the call fail later with a clear 401.
        api_key=settings.llm_api_key or "missing-api-key",
        base_url=base_url,
        **client_kwargs,
    )
    return LLMClient(client)
