"""
================================================================
UQU AGENT — Agentic Loop with Reasoning Support
================================================================
Iterative tool-calling loop. The exact model is
configured via OPENAI_MODEL in .env — defaults to gpt-4o.

Robust error handling:
  • Network / API errors are logged with full detail (status code,
    response body, retry attempt).
  • If the first call fails, we retry once WITHOUT tools so the user
    still gets a response instead of a generic "engine struggling"
    message.
  • If the primary model returns a deflection/apology without calling
    any tools, we automatically fall back to Gemini for a plain-text
    answer.
  • Tool-call argument JSON failures don't crash the loop.
"""

import json
import logging
from datetime import date, datetime
from openai import AsyncOpenAI, APIError, APIStatusError, APIConnectionError, APITimeoutError

from config import get_settings
from agent.tools_schema import TOOLS_SCHEMA
from agent.tools_executor import execute_tool

logger = logging.getLogger(__name__)


def _json_default(o):
    """JSON fallback serializer for objects that come back from
    Firestore reads inside tool results.

    The Firebase Admin SDK returns timestamps as
    `google.api_core.datetime_helpers.DatetimeWithNanoseconds`, which
    subclasses `datetime` but isn't recognized by stdlib `json.dumps`.
    Same for `date`. We also handle a couple of common stragglers
    (bytes, set) defensively so a single odd field can never crash the
    whole tool→model roundtrip again.
    """
    if isinstance(o, (datetime, date)):
        # `isoformat()` works for `DatetimeWithNanoseconds` too — it
        # inherits from `datetime`.
        return o.isoformat()
    if hasattr(o, "isoformat"):  # any duck-typed datetime-ish object
        try:
            return o.isoformat()
        except Exception:
            pass
    if isinstance(o, bytes):
        try:
            return o.decode("utf-8")
        except UnicodeDecodeError:
            return o.hex()
    if isinstance(o, set):
        return list(o)
    # Last resort — stringify so the model sees *something* instead of
    # the whole iteration failing.
    return str(o)

MAX_ITERATIONS = 6

# ── Patterns that indicate kimi deflected rather than actually helping ──
# We detect these on the first iteration only (before any tools were called)
# and trigger a Gemini fallback automatically.
_DEFLECTION_PATTERNS = [
    "يواجه ضغطاً",
    "المحرك الذكي يواجه",
    "واجه المحرك",
    "خارج قدراتي",
    "لا أستطيع الوصول",
    "لا أملك صلاحية",
    "غير قادر على الوصول",
    "لا يمكنني الوصول إلى البيانات",
    "لا أستطيع تنفيذ",
    "لا أستطيع مساعدتك",
    "I cannot access",
    "I don't have access",
    "I'm unable to",
]


def _is_deflection(text: str, actions_were_taken: bool) -> tuple[bool, str | None]:
    """
    Return (True, matched_pattern) when the model responded with an
    apology/deflection and did NOT execute any tools.
    """
    if not text or actions_were_taken:
        return False, None
    t = text.strip()
    for p in _DEFLECTION_PATTERNS:
        if p in t:
            return True, p
    return False, None


def _is_tools_schema_error(err: Exception) -> bool:
    """
    True only when the error is a 4xx that names the tools/function schema
    as the cause. Used to gate the "retry without tools" fallback so that
    auth / network / 5xx failures propagate up instead of silently stripping
    tool capability.
    """
    if not isinstance(err, APIStatusError):
        return False
    if getattr(err, "status_code", None) != 400:
        return False
    body = ""
    response = getattr(err, "response", None)
    if response is not None:
        body = (getattr(response, "text", "") or "").lower()
    if not body:
        body = str(err).lower()
    return any(kw in body for kw in ("tool", "function", "schema"))


def get_openai_client() -> AsyncOpenAI:
    """Create an AsyncOpenAI client.

    Returns a fresh client each call. For the hot-path (chat), the caller
    should use the long-lived client stored in app.state (created in main.py
    lifespan) to avoid binding to a dead event loop across Uvicorn reloads.
    This factory is kept for cold-path callers (e.g. transcript analysis).
    """
    settings = get_settings()
    return AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
    )


async def _call_model(client, model_name, messages, with_tools: bool):
    """Single completion call. Logs the exact error on failure."""
    try:
        kwargs = dict(
            model=model_name,
            messages=messages,
            temperature=0.6,
            top_p=0.9,
            max_tokens=8192,
        )
        if with_tools:
            kwargs["tools"] = TOOLS_SCHEMA
            kwargs["tool_choice"] = "auto"
        return await client.chat.completions.create(**kwargs)
    except APIStatusError as e:
        logger.error(
            "[AGENT] NVIDIA returned HTTP %s — body=%s",
            e.status_code, getattr(e, "response", None) and e.response.text[:500],
        )
        raise
    except APIConnectionError as e:
        logger.error("[AGENT] NVIDIA connection error: %s", e)
        raise
    except APITimeoutError as e:
        logger.error("[AGENT] NVIDIA request timed out: %s", e)
        raise
    except APIError as e:
        logger.error("[AGENT] NVIDIA API error: %s", e)
        raise


async def _gemini_fallback(messages: list[dict], system_prompt: str) -> str | None:
    """
    Call Gemini as a plain-text fallback.
    Imported lazily to avoid circular imports and keep startup fast.
    """
    try:
        from services.gemini import call_gemini_chat_text
        # Only pass last 6 messages to Gemini to stay within limits
        recent = [m for m in messages if m.get("role") in ("user", "assistant")][-6:]
        result = await call_gemini_chat_text(
            messages=recent,
            system_prompt=system_prompt,
            temperature=0.7,
        )
        if result:
            logger.info("[AGENT] Gemini fallback succeeded (%d chars)", len(result))
        return result
    except Exception as exc:
        logger.error("[AGENT] Gemini fallback error: %s", exc)
        return None


async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    db,
    client: AsyncOpenAI | None = None,
) -> dict:
    """Run the agentic loop with tool calling.

    `client` should be the long-lived AsyncOpenAI instance from app.state
    (passed in by the chat router). If omitted, a fresh client is created
    per-call — safe but slightly less efficient.

    Returns dict { content, actions_log, reasoning }.
    Caller should treat exceptions as fatal — the chat router catches
    them and returns a user-friendly message.
    """
    settings = get_settings()
    if client is None:
        client = get_openai_client()
    all_messages = list(messages)  # shallow copy
    actions_log: list[dict] = []
    model_name = settings.OPENAI_MODEL

    # Extract the system prompt for the Gemini fallback (first message if role=system)
    system_prompt_for_fallback = ""
    for m in messages:
        if m.get("role") == "system":
            system_prompt_for_fallback = m.get("content", "")
            break

    logger.info(
        "[AGENT] Starting loop — model=%s msgs=%d user=%s",
        model_name, len(all_messages), user_id,
    )

    for i in range(MAX_ITERATIONS):
        # ── Call the model ──
        try:
            completion = await _call_model(client, model_name, all_messages, with_tools=True)
        except Exception as first_err:
            # Only retry without tools when the failure was specifically the
            # tools schema being rejected. For auth / network / 5xx we want
            # the error to propagate so the chat router can surface a real
            # message instead of silently stripping tool capability.
            if not _is_tools_schema_error(first_err):
                logger.error(
                    "[AGENT] Model call failed and is not a tools-schema error (%s) — propagating",
                    type(first_err).__name__,
                )
                raise
            logger.warning(
                "[AGENT] Tools-schema rejected by NIM (%s) — retrying without tools",
                type(first_err).__name__,
            )
            try:
                completion = await _call_model(client, model_name, all_messages, with_tools=False)
            except Exception as second_err:
                logger.error("[AGENT] Retry without tools also failed: %s", second_err)
                # Both NVIDIA calls failed — try Gemini as last resort
                fallback = await _gemini_fallback(all_messages, system_prompt_for_fallback)
                if fallback:
                    return {"content": fallback, "actions_log": [], "reasoning": None}
                raise

        choice = completion.choices[0]
        message = choice.message

        logger.info(
            "[AGENT] iter=%d finish=%s tool_calls=%d content_len=%d",
            i, choice.finish_reason,
            len(message.tool_calls) if message.tool_calls else 0,
            len(message.content or ""),
        )

        # ── Preserve assistant turn for next iteration ──
        assistant_message = {
            "role": "assistant",
            "content": message.content or "",
        }
        if message.tool_calls:
            assistant_message["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in message.tool_calls
            ]
        all_messages.append(assistant_message)

        # ── If the model finished without requesting tools ──
        if choice.finish_reason != "tool_calls" or not message.tool_calls:
            content = message.content or ""

            # ── Deflection detection (first iteration, no tools called yet) ──
            if i == 0:
                is_deflection, matched_pattern = _is_deflection(
                    content, actions_were_taken=bool(actions_log)
                )
                if is_deflection:
                    logger.warning(
                        "[AGENT] Deflection on iter 0 — pattern=%r finish=%s tool_calls=%d. "
                        "Switching to Gemini (TOOL CAPABILITY WILL BE LOST). Primary text: %s",
                        matched_pattern,
                        choice.finish_reason,
                        len(message.tool_calls) if message.tool_calls else 0,
                        content[:200],
                    )
                    fallback = await _gemini_fallback(all_messages, system_prompt_for_fallback)
                    if fallback:
                        return {"content": fallback, "actions_log": [], "reasoning": None}
                    # If Gemini also fails, return the primary model's deflection rather than nothing
                    logger.warning("[AGENT] Gemini fallback also returned nothing — returning primary model text")

            return {
                "content": content,
                "actions_log": actions_log,
                "reasoning": None,
            }

        # ── Execute requested tools ──
        for tool_call in message.tool_calls:
            tool_name = tool_call.function.name
            args: dict = {}
            json_err: str | None = None
            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError as je:
                json_err = f"invalid json args: {je}"
                logger.warning("[AGENT] tool %s had invalid JSON args: %s", tool_name, je)

            if json_err is not None:
                # Surface the parse failure in actions_log instead of silently
                # invoking the tool with empty args — that path produces a
                # tool that "did nothing" with no visible reason.
                result = {
                    "success": False,
                    "error": json_err,
                    "instruction_for_model": (
                        f"The arguments you sent to `{tool_name}` were not "
                        "valid JSON. Re-emit the call with a syntactically "
                        "correct JSON object. If you cannot, reply in plain "
                        "text instead of calling this tool again."
                    ),
                }
            else:
                try:
                    result = await execute_tool(tool_name, args, user_id, db)
                except Exception as tool_err:
                    err_str = str(tool_err)
                    logger.error("[AGENT] tool %s execution error: %s", tool_name, err_str, exc_info=True)
                    # Send an actionable error back to the model so it can
                    # self-correct on the next iteration. Without the
                    # `instruction_for_model` field, the LLM tends to just
                    # re-call the same broken arguments until we hit
                    # MAX_ITERATIONS and the user sees nothing.
                    result = {
                        "success": False,
                        "error": err_str,
                        "instruction_for_model": (
                            f"Tool `{tool_name}` failed with: {err_str}. "
                            "Inspect the error, fix the offending argument "
                            "(check types — numbers must be numbers, arrays "
                            "must be arrays of objects, not JSON strings), "
                            "and try ONCE more. If the second attempt also "
                            "fails, abandon the tool and reply to the user "
                            "in plain text explaining what you tried."
                        ),
                    }

            actions_log.append({
                "tool": tool_name,
                "args": args,
                "result": result,
            })

            all_messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                # `default=_json_default` handles Firestore's
                # DatetimeWithNanoseconds, plain datetime/date, bytes, and
                # sets so a tool that returned any of those can't crash
                # the tool→model serialization.
                "content": json.dumps(result, ensure_ascii=False, default=_json_default),
            })

        # ── Repeated-failure circuit-breaker ──
        # If the same tool has failed ≥ 2 times in this loop, stop letting
        # the model retry it. Inject a system nudge and let the next
        # iteration produce a plain-text reply instead of another
        # round of "let me try again" that ends at MAX_ITERATIONS.
        failure_counts: dict[str, int] = {}
        for entry in actions_log:
            r = entry.get("result") or {}
            if isinstance(r, dict) and r.get("success") is False:
                t = entry.get("tool", "")
                failure_counts[t] = failure_counts.get(t, 0) + 1
        repeat_failed = [t for t, n in failure_counts.items() if n >= 2]
        if repeat_failed:
            logger.warning(
                "[AGENT] tool(s) failed repeatedly: %s — instructing model to "
                "stop retrying and answer in text.",
                repeat_failed,
            )
            all_messages.append({
                "role": "system",
                "content": (
                    "STOP retrying these tools — they have already failed "
                    f"twice this turn: {', '.join(repeat_failed)}. "
                    "Do NOT call them again. Reply to the user in plain "
                    "Arabic text describing what you were trying to do "
                    "and ask them to retry or rephrase."
                ),
            })

    # If we exhausted iterations, return whatever the last assistant message held.
    last_assistant_text = ""
    for m in reversed(all_messages):
        if m.get("role") == "assistant" and m.get("content"):
            last_assistant_text = m["content"]
            break
    logger.warning("[AGENT] Hit MAX_ITERATIONS=%d — returning last assistant turn", MAX_ITERATIONS)
    return {
        "content": last_assistant_text or "تم استنفاد عدد محاولات المحرك. حاول إعادة صياغة طلبك بشكل أبسط.",
        "actions_log": actions_log,
        "reasoning": None,
    }
