"""
================================================================
UQU Academic Assistant — Chat Router
================================================================
Converts: exports.chat from index.js lines 164-230
"""

import time
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from google.cloud.firestore_v1 import Increment
from openai import AsyncOpenAI

from schemas.chat import ChatRequest, ChatResponse
from auth.dependencies import get_current_user_optional
from db.firestore import get_db
from agent.prompts import build_system_prompt
from agent.loop import run_agent_loop
from services.student import load_student_context

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user_optional),
):
    return await _chat_logic(body, user_id, http_request.app.state.openai_client)


async def _chat_logic(request: ChatRequest, user_id: str, openai_client: AsyncOpenAI):
    """Main AI Agent logic — shared by both routes.

    Mirrors: exports.chat from index.js lines 164-230
    """
    try:
        db = get_db()

        # ── Load context ──
        ctx = await load_student_context(user_id, db)

        # Log how much grounding data the agent will actually see, so we can
        # diagnose "lazy" responses caused by an empty record vs. caused by
        # the model being lazy with a full record present.
        ar = ctx.get("academic_record") or {}
        completed_n = len((ar.get("completedCourses") or []))
        current_n = len((ar.get("currentCourses") or []))
        logger.info(
            "[chat] context — uid=%s profile=%s academic_record=%s "
            "completed=%d current=%d transcript=%s exams=%d plan=%s",
            user_id,
            bool(ctx.get("user_data")),
            bool(ar),
            completed_n,
            current_n,
            bool(ctx.get("transcript")),
            len(ctx.get("upcoming_exams", [])),
            bool(ctx.get("active_plan")),
        )

        # ── Validate messages ──
        if not request.messages:
            raise HTTPException(status_code=400, detail="messages required")

        # ── Step 2: Build messages & Run Agent ──
        # Live frontend snapshot (if pushed) goes into the system prompt so
        # the agent's view always matches the user's in-session edits.
        # `academic_record` carries the raw v3 transcript (every completed
        # course with grade + gradePoints) so the Advice CoT block can
        # quote from a full ledger rather than just the top-3 weakest.
        client_ctx_dict = request.client_context.model_dump() if request.client_context else None
        system_prompt = build_system_prompt(
            ctx["user_data"],
            ctx["transcript"],
            ctx["upcoming_exams"],
            ctx["active_plan"],
            client_context=client_ctx_dict,
            academic_record=ctx.get("academic_record"),
        )
        logger.debug("[chat] system_prompt length = %d chars", len(system_prompt))

        # ── Trim conversation history to prevent context overflow ──
        # System prompt is already large. Sending 13-17 messages on top causes
        # kimi to hit its effective limit and return a deflection/apology.
        # Keep only the last 8 messages (≈ 4 user↔assistant exchanges).
        MAX_HISTORY = 8
        trimmed = (
            request.messages[-MAX_HISTORY:]
            if len(request.messages) > MAX_HISTORY
            else request.messages
        )
        logger.info(
            "[chat] history: %d msgs → trimmed to %d",
            len(request.messages), len(trimmed),
        )

        full_messages = [
            {"role": "system", "content": system_prompt},
            *[{"role": m.role, "content": m.content} for m in trimmed],
        ]

        # ── Run agent ──
        try:
            result = await run_agent_loop(full_messages, user_id, db, openai_client)
            content = result["content"]
            actions_log = result["actions_log"]
        except Exception as agent_err:
            err_str = str(agent_err)
            logger.error(f"[chat] Agent loop failed: {err_str}", exc_info=True)

            # Classify the failure so the frontend can render a
            # warning-styled bubble (and so we don't melt under load).
            # Default category is `agent_error`; the buckets below
            # override it when the error string clearly identifies the
            # cause.
            error_type = "agent_error"
            error_msg = (
                "عذراً، أواجه ضغطاً في المحرك الذكي حالياً. "
                "حاول مرة أخرى بعد قليل."
            )
            low = err_str.lower()
            if "401" in err_str or "unauthorized" in low or ("invalid" in low and "key" in low):
                error_type = "api_auth"
                error_msg = (
                    "⚠️ مفتاح مزود الذكاء غير صالح أو منتهي. "
                    "تواصل مع الإدارة الفنية."
                )
            elif "429" in err_str or "rate" in low or "quota" in low:
                error_type = "api_limit"
                error_msg = (
                    "عذراً، أواجه ضغطاً عالياً في السيرفر حالياً. "
                    "يرجى المحاولة بعد قليل."
                )
            elif "timeout" in low or "timed out" in low:
                error_type = "api_timeout"
                error_msg = (
                    "⏳ المحرك تأخر في الرد. حاول مرة أخرى — "
                    "ربما الطلب طويل، جرّب صياغة أقصر."
                )
            elif (
                "404" in err_str
                or "not found" in low
                or "model" in low
                or "503" in err_str
                or "502" in err_str
                or "500" in err_str
            ):
                error_type = "api_unavailable"
                error_msg = (
                    "⚠️ مزود الذكاء غير متاح حالياً. "
                    "جرّب بعد دقيقة أو راجع الإدارة الفنية."
                )
            elif "connection" in low or "network" in low:
                error_type = "api_unavailable"
                error_msg = (
                    "⚠️ تعذّر الاتصال بمزود الذكاء. "
                    "تحقق من اتصال السيرفر بالإنترنت."
                )
            else:
                # Unknown — surface the error tail in the message for
                # debugging, but keep `agent_error` as the type so the
                # frontend still styles it as a warning.
                error_msg = f"⚠️ خطأ في المحرك الذكي: {err_str[:120]}"

            return ChatResponse(
                success=True,
                message=error_msg,
                actions=[],
                client_actions=[],
                conversationId=request.conversationId or f"conv_{int(time.time() * 1000)}",
                error_type=error_type,
            )

        # ── Persist chat history ──
        conv_id = request.conversationId or f"conv_{int(time.time() * 1000)}"
        user_ref = db.collection("users").document(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        # Save user message
        last_user_msg = None
        for m in reversed(request.messages):
            if m.role == "user":
                last_user_msg = m
                break

        if last_user_msg:
            user_ref.collection("chat_history").document(conv_id) \
                .collection("messages").add({
                    "role": "user",
                    "content": last_user_msg.content,
                    "timestamp": now_iso,
                })

        # Save assistant message
        if content:
            user_ref.collection("chat_history").document(conv_id) \
                .collection("messages").add({
                    "role": "assistant",
                    "content": content,
                    "actions": actions_log,
                    "timestamp": now_iso,
                })

            # Update conversation metadata
            user_ref.collection("chat_history").document(conv_id).set({
                "lastMessage": content[:120],
                "updatedAt": now_iso,
                "messageCount": Increment(2),
            }, merge=True)

        # ── Extract client-side actions emitted via emit_client_action ──
        # The frontend dispatcher (lib/chat-client-actions.ts) only needs the
        # structured directives; the full actions_log (with raw tool args /
        # results) stays available for debugging and history audit.
        client_actions: list[dict] = []
        for log_entry in actions_log:
            try:
                if log_entry.get("tool") != "emit_client_action":
                    continue
                result = log_entry.get("result") or {}
                if not result.get("success"):
                    continue
                ca = result.get("client_action")
                if isinstance(ca, dict) and ca.get("type"):
                    client_actions.append(ca)
            except Exception:  # noqa: BLE001 — never let a malformed log row fail the response
                continue

        return ChatResponse(
            success=True,
            message=content,
            actions=actions_log,
            client_actions=client_actions,
            conversationId=conv_id,
        )

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"[chat] {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(err))

