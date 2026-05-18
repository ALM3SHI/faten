"""
================================================================
UQU Academic Assistant — Gemini API Service (ULTRA COMPATIBLE)
================================================================
Uses the v1 endpoint with a flat structure to avoid any 
compatibility issues with different API key types.
================================================================
"""
import json
import logging
from typing import Any
import httpx
from fastapi import HTTPException, status
from config import get_settings

logger = logging.getLogger(__name__)

# v1beta is required — the stable /v1/ endpoint rejects `responseMimeType`
# and other structured-output controls with INVALID_ARGUMENT. Every feature
# we use (responseMimeType=application/json, maxOutputTokens, system
# instructions, multimodal inline_data, etc.) is supported here.
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

async def call_gemini(
    system_prompt: str,
    user_content: str,
    temperature: float,
    response_mime_type: str | None = None,
    file_data: bytes | None = None,
    mime_type: str | None = None,
    timeout_seconds: float = 60.0,
    max_output_tokens: int | None = None,
) -> Any:
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="API Key missing")

    url = f"{GEMINI_BASE}/{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"

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

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(url, json=payload)
        
    if response.status_code != 200:
        logger.error(f"Gemini API Error (HTTP {response.status_code}): {response.text}")
        # Try to extract a structured error message — Google returns
        # { "error": { "code": 4xx, "message": "...", "status": "..." } }
        try:
            err_body = response.json()
            err = err_body.get("error") or {}
            err_msg = err.get("message") or response.text[:400]
            err_status = err.get("status") or f"HTTP {response.status_code}"
            detail = f"Gemini {err_status}: {err_msg}"
        except Exception:
            detail = f"Gemini HTTP {response.status_code}: {response.text[:400]}"
        raise HTTPException(status_code=502, detail=detail)

    data = response.json()
    
    try:
        candidates = data.get('candidates', [])
        if not candidates:
            # Check for safety filter blocks
            if 'promptFeedback' in data and data['promptFeedback'].get('blockReason'):
                reason = data['promptFeedback']['blockReason']
                logger.error(f"Gemini blocked prompt: {reason}")
                raise HTTPException(status_code=502, detail=f"Gemini blocked the request: {reason}")
            
            logger.error(f"Gemini API Error (No candidates): {data}")
            raise HTTPException(status_code=502, detail="Gemini returned no candidates.")

        candidate = candidates[0]
        if candidate.get('finishReason') == 'SAFETY':
             raise HTTPException(status_code=502, detail="Gemini blocked the response for safety reasons.")

        parts = candidate.get('content', {}).get('parts', [])
        if not parts or 'text' not in parts[0]:
            logger.error(f"Gemini API Error (No text in parts): {data}")
            raise HTTPException(status_code=502, detail="Gemini returned no text content.")

        text_content = parts[0]['text'].strip()
        
        # Clean JSON if it's wrapped in markdown blocks
        if "```json" in text_content:
            text_content = text_content.split("```json")[1].split("```")[0].strip()
        elif "```" in text_content:
            text_content = text_content.split("```")[1].split("```")[0].strip()
            
        try:
            return json.loads(text_content)
        except json.JSONDecodeError:
            # Fallback: find the first { and last }
            start = text_content.find("{")
            end = text_content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(text_content[start:end+1])
            
            # If it's a list (some schedules return lists)
            start_list = text_content.find("[")
            end_list = text_content.rfind("]")
            if start_list != -1 and end_list != -1:
                return json.loads(text_content[start_list:end_list+1])
                
            raise ValueError(f"Invalid JSON response: {text_content[:100]}")
            
    except (KeyError, IndexError, ValueError) as e:
        logger.error(f"Gemini Parsing Error: {str(e)} | Data: {data}")
        raise HTTPException(status_code=502, detail=f"Failed to parse Gemini response: {str(e)}")


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

    url = f"{GEMINI_BASE}/{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"

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
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(url, json=payload)
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

