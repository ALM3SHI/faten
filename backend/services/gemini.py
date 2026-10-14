"""
================================================================
UQU Academic Assistant — Gemini API Service (ULTRA COMPATIBLE)
================================================================
Uses the v1 endpoint with a flat structure to avoid any 
compatibility issues with different API key types.
================================================================
"""
import json
import re
import logging
from typing import Any
import httpx
from fastapi import HTTPException, status
from config import get_settings
from common.errors import (
    AI_BAD_REPLY_MESSAGE,
    AI_BLOCKED_MESSAGE,
    AI_EMPTY_REPLY_MESSAGE,
    AI_KEY_MISSING_MESSAGE,
    AI_TIMEOUT_MESSAGE,
    UpstreamAIError,
)

from services.ai_gate import AIBusyError, gate

logger = logging.getLogger(__name__)

# v1beta is required — the stable /v1/ endpoint rejects `responseMimeType`
# and other structured-output controls with INVALID_ARGUMENT. Every feature
# we use (responseMimeType=application/json, maxOutputTokens, system
# instructions, multimodal inline_data, etc.) is supported here.
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

_VALID_ESCAPES = frozenset('"\\/bfnrtu')
_HEX4 = re.compile(r"[0-9a-fA-F]{4}")


def repair_json_escapes(text: str) -> str:
    r"""Double every backslash that does not start a valid JSON escape.

    Lessons about the command line put regexes and paths (grep '\d+',
    sed 's/\s//', C:\Users) inside JSON strings with a single backslash,
    which strict JSON rejects. Valid escapes (\n, \", \\ …) are kept.
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\\":
            nxt = text[i + 1] if i + 1 < n else ""
            if nxt == "u" and not _HEX4.fullmatch(text[i + 2 : i + 6]):
                nxt = ""  # "\users" is a path, not a \uXXXX escape
            if nxt and nxt in _VALID_ESCAPES:
                out.append(ch + nxt)
                i += 2
                continue
            out.append("\\\\")
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _loads_lenient(text: str) -> Any:
    """Strict JSON, then raw control characters allowed, then repaired escapes."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    try:
        return json.loads(text, strict=False)  # raw tabs/newlines inside strings
    except json.JSONDecodeError:
        pass
    return json.loads(repair_json_escapes(text), strict=False)


def parse_json_text(text_content: str) -> Any:
    """JSON from a model reply. The reply itself is tried first: a JSON answer
    may contain ``` code blocks inside its strings (lessons with code), so
    fences are only stripped when they wrap the whole reply."""
    try:
        return _loads_lenient(text_content)
    except json.JSONDecodeError:
        pass
    stripped = text_content.strip()
    if stripped.startswith("```"):
        first_nl = stripped.find("\n")
        body = stripped[first_nl + 1 :] if first_nl != -1 else ""
        if body.rstrip().endswith("```"):
            body = body.rstrip()[:-3]
        try:
            return _loads_lenient(body)
        except json.JSONDecodeError:
            stripped = body.strip()
    # Fallback: the outermost {...} or [...]
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start, end = stripped.find(open_c), stripped.rfind(close_c)
        if start != -1 and end > start:
            try:
                return _loads_lenient(stripped[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Invalid JSON response: {text_content[:100]}")


async def call_gemini(
    system_prompt: str,
    user_content: str,
    temperature: float,
    response_mime_type: str | None = None,
    file_data: bytes | None = None,
    mime_type: str | None = None,
    timeout_seconds: float = 60.0,
    max_output_tokens: int | None = None,
    model: str | None = None,
    response_json_schema: dict | None = None,
    thinking_level: str | None = None,
) -> Any:
    """One generateContent call whose reply is JSON.

    response_json_schema  constrains the reply to that JSON Schema
                          (structured output), so it cannot come back malformed.
    thinking_level        Gemini 3 reasoning effort ("minimal" | "low" | …).
                          Thinking tokens count against max_output_tokens.
    Timeouts and network failures raise UpstreamAIError (Arabic message,
    `upstream_status` kept) like HTTP errors do, so callers can retry.
    """
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail=AI_KEY_MISSING_MESSAGE)

    url = f"{GEMINI_BASE}/{model or settings.GEMINI_MODEL}:generateContent"

    # Prepare parts
    parts = []
    
    # 1. System Prompt
    parts.append({"text": f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\n"})
    
    # 2. File Data (Multimodal)
    if file_data and mime_type:
        import base64
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(file_data).decode("utf-8")
            }
        })
    
    # 3. User Content
    parts.append({"text": user_content})

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": temperature,
        },
    }
    
    # Map Python snake_case kwargs to the camelCase keys the Gemini REST
    # API expects inside `generationConfig`. The API rejects snake_case
    # with INVALID_ARGUMENT: "Unknown name 'response_mime_type'" so this
    # mapping is load-bearing.
    if response_mime_type:
        payload["generationConfig"]["responseMimeType"] = response_mime_type

    # Lift the output ceiling for large structured documents (e.g. a
    # transcript with 60+ courses can blow past the default ~2k token cap
    # and the JSON gets truncated mid-array).
    if max_output_tokens is not None:
        payload["generationConfig"]["maxOutputTokens"] = max_output_tokens
    if response_json_schema is not None:
        payload["generationConfig"]["responseJsonSchema"] = response_json_schema
    if thinking_level:
        payload["generationConfig"]["thinkingConfig"] = {"thinkingLevel": thinking_level}

    try:
        async with gate.slot(), httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, json=payload, headers={"x-goog-api-key": settings.GEMINI_API_KEY})
    except httpx.TimeoutException as exc:
        logger.error("Gemini timeout after %.0fs (model=%s): %r", timeout_seconds, model or settings.GEMINI_MODEL, exc)
        raise UpstreamAIError(upstream_status=504, status_code=504, detail=AI_TIMEOUT_MESSAGE) from exc
    except httpx.HTTPError as exc:
        logger.error("Gemini network error (model=%s): %r", model or settings.GEMINI_MODEL, exc)
        raise UpstreamAIError(upstream_status=503, status_code=502) from exc

    if response.status_code != 200:
        logger.error(f"Gemini API Error (HTTP {response.status_code}): {response.text}")
        # Try to extract a structured error message — Google returns
        # { "error": { "code": 4xx, "message": "...", "status": "..." } }
        try:
            err_body = response.json()
            err = err_body.get("error") or {}
            err_msg = err.get("message") or response.text[:400]
            err_status = err.get("status") or f"HTTP {response.status_code}"
            logger.error("Gemini %s: %s", err_status, err_msg)
        except Exception:
            err_msg = response.text[:400]
            logger.error("Gemini HTTP %s: %s", response.status_code, err_msg)
        upstream = UpstreamAIError(
            upstream_status=response.status_code,
            status_code=429 if response.status_code == 429 else 502,
        )
        # Kept for callers that react to *why* a request was refused (e.g. a
        # model that does not accept thinkingConfig / responseJsonSchema).
        upstream.upstream_message = str(err_msg)[:500]
        raise upstream

    data = response.json()
    
    try:
        candidates = data.get('candidates', [])
        if not candidates:
            # Check for safety filter blocks
            if 'promptFeedback' in data and data['promptFeedback'].get('blockReason'):
                reason = data['promptFeedback']['blockReason']
                logger.error(f"Gemini blocked prompt: {reason}")
                raise HTTPException(status_code=502, detail=AI_BLOCKED_MESSAGE)
            
            logger.error(f"Gemini API Error (No candidates): {data}")
            raise HTTPException(status_code=502, detail=AI_EMPTY_REPLY_MESSAGE)

        candidate = candidates[0]
        if candidate.get('finishReason') == 'SAFETY':
             raise HTTPException(status_code=502, detail=AI_BLOCKED_MESSAGE)

        parts = candidate.get('content', {}).get('parts', [])
        # Join every text part (a long answer can arrive split); skip thought parts.
        texts = [p['text'] for p in parts if isinstance(p, dict) and 'text' in p and not p.get('thought')]
        if not texts:
            logger.error(f"Gemini API Error (No text in parts): {data}")
            raise HTTPException(status_code=502, detail=AI_EMPTY_REPLY_MESSAGE)
        text = "".join(texts).strip()
        try:
            return parse_json_text(text)
        except ValueError as e:
            # Enough to tell a cut-off reply from malformed JSON, without
            # dumping the whole response (or the prompt) into the log.
            logger.error(
                "Gemini unreadable JSON (model=%s finishReason=%s usage=%s chars=%d): %s | head=%r | tail=%r",
                model or settings.GEMINI_MODEL, candidate.get('finishReason'), data.get('usageMetadata'),
                len(text), e, text[:300], text[-300:],
            )
            raise HTTPException(status_code=502, detail=AI_BAD_REPLY_MESSAGE)

    except (KeyError, IndexError, ValueError) as e:
        logger.error(f"Gemini Parsing Error: {str(e)} | Data: {str(data)[:2000]}")
        raise HTTPException(status_code=502, detail=AI_BAD_REPLY_MESSAGE)


async def call_gemini_chat_text(
    messages: list[dict],
    system_prompt: str,
    temperature: float = 0.7,
    timeout_seconds: float = 60.0,
) -> str | None:
    """
    Multi-turn plain-text chat with Gemini. Used by the agent loop as a
    fallback when the primary NVIDIA NIM endpoint fails.

    Args:
        messages: list of {"role": "user"|"assistant", "content": str}
                  ordered oldest → newest. System messages are ignored
                  (the system_prompt argument is the source of truth).
        system_prompt: instructions injected via `systemInstruction`.
        temperature: sampling temperature.

    Returns:
        The model's reply text, or None if the call/parsing failed.
        This function never raises — failures are logged and converted
        to None so the caller can decide what to show the user.
    """
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        logger.warning("Gemini chat fallback skipped — GEMINI_API_KEY not set")
        return None

    url = f"{GEMINI_BASE}/{settings.GEMINI_MODEL}:generateContent"

    # Translate OpenAI-style messages to Gemini's `contents` shape.
    # Gemini uses role "model" instead of "assistant"; "tool" / "system"
    # entries are dropped (system handled separately, tool turns aren't
    # meaningful without the matching schema).
    contents: list[dict] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if not isinstance(content, str) or not content.strip():
            continue
        if role == "user":
            contents.append({"role": "user", "parts": [{"text": content}]})
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": content}]})
        # system / tool turns are intentionally skipped

    # Gemini rejects empty `contents` arrays — bail out cleanly.
    if not contents:
        logger.warning("Gemini chat fallback skipped — no user/assistant turns to send")
        return None

    payload: dict = {
        "contents": contents,
        "generationConfig": {"temperature": temperature},
    }
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    try:
        async with gate.slot(), httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, json=payload, headers={"x-goog-api-key": settings.GEMINI_API_KEY})
    except AIBusyError:
        logger.warning("Gemini chat fallback skipped — shared AI budget is full")
        return None
    except httpx.HTTPError as exc:
        logger.error("Gemini chat fallback network error: %s", exc)
        return None

    if response.status_code != 200:
        logger.error("Gemini chat fallback HTTP %s — body=%s", response.status_code, response.text[:500])
        return None

    try:
        data = response.json()
        candidates = data.get("candidates") or []
        if not candidates:
            block_reason = (data.get("promptFeedback") or {}).get("blockReason")
            if block_reason:
                logger.error("Gemini chat fallback blocked by safety filter: %s", block_reason)
            else:
                logger.error("Gemini chat fallback returned no candidates: %s", data)
            return None

        candidate = candidates[0]
        if candidate.get("finishReason") == "SAFETY":
            logger.error("Gemini chat fallback finishReason=SAFETY")
            return None

        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()
        return text or None
    except (KeyError, IndexError, ValueError) as exc:
        logger.error("Gemini chat fallback parse error: %s | data=%s", exc, response.text[:300])
        return None

