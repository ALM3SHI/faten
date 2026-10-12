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
from auth.dependencies import get_current_user
from db.firestore import get_db
from agent.prompts import build_system_prompt
from agent.loop import run_agent_loop
from services.student import load_student_context
from agent.intent import classify_intent
from config import get_settings
from services.quota import COST_CHAT, QUOTA_EXCEEDED_MESSAGE, QuotaExceeded, consume_ai_credits

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Chat"])


@router.post("/api/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user),
):
    try:
        consume_ai_credits(user_id, COST_CHAT)
    except QuotaExceeded:
        # Returned as a normal reply so the chat renders a warning bubble.
        return ChatResponse(
            success=True,
            message=QUOTA_EXCEEDED_MESSAGE,
            actions=[],
            client_actions=[],
            conversationId=body.conversationId or f"conv_{int(time.time() * 1000)}",
            error_type="quota_exceeded",
        )
    return await _chat_logic(body, user_id, http_request.app.state.openai_client)


async def _chat_logic(request: ChatRequest, user_id: str, openai_client: AsyncOpenAI):
    """Main AI Agent logic — shared by both routes.

    Mirrors: exports.chat from index.js lines 164-230
    """
    try:
        db = get_db()

        # ── Validate messages ──
        if not request.messages:
            raise HTTPException(status_code=400, detail="messages required")

        last_user_msg = None
        for m in reversed(request.messages):
            if m.role == "user":
                last_user_msg = m
                break
        
        last_user_text = last_user_msg.content if last_user_msg else ""
        intent_info = await classify_intent(request.messages, openai_client)
        
        logger.info(
            "[chat] Intent classified: %s | source=%s | continuation=%s | required_blocks: %s | direct: %s",
            intent_info["intent"], intent_info.get("source", "unknown"),
            intent_info.get("is_continuation", False),
            intent_info["required_blocks"], bool(intent_info["direct_response"])
        )

        client_actions = []
        content = ""
        actions_log = []
        
        conv_id = request.conversationId or f"conv_{int(time.time() * 1000)}"
        now_iso = datetime.now(timezone.utc).isoformat()
        
        # ── Handle Navigation Fast Path ──
        if intent_info["intent"] == "NAVIGATION":
            if intent_info.get("route"):
                route = intent_info["route"]
                label = intent_info.get("label", "")
                content = f"تفضل، فتحت لك {label}." if label else f"تفضل، تم فتح الصفحة."
                
                client_actions.append({
                    "type": "NAVIGATE",
                    "payload": {"path": route}
                })
                
                source = intent_info.get("source", "unknown")
                logger.info(f"[chat] Direct navigation response | source={source} | route={route} | cost=0")
                
                # Persist directly and return early
                user_ref = db.collection("users").document(user_id)
                if last_user_msg:
                    user_ref.collection("chat_history").document(conv_id).collection("messages").add({
                        "role": "user", "content": last_user_msg.content, "timestamp": now_iso
                    })
                user_ref.collection("chat_history").document(conv_id).collection("messages").add({
                    "role": "assistant", "content": content, "actions": [], "timestamp": now_iso
                })
                user_ref.collection("chat_history").document(conv_id).set({
                    "lastMessage": content[:120], "updatedAt": now_iso, "messageCount": Increment(2)
                }, merge=True)
                
                return ChatResponse(
                    success=True, message=content, actions=[], client_actions=client_actions, conversationId=conv_id
                )
                
            elif intent_info.get("source") == "heuristic_ambiguous":
                # Do not load context, use a tiny prompt
                from agent.prompts import NAVIGATION_AMBIGUOUS_PROMPT
                system_prompt = NAVIGATION_AMBIGUOUS_PROMPT
                
                logger.info("[chat] Calling fast model for ambiguous navigation | cost=tiny")
                result = await run_agent_loop(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": last_user_text}
                    ], 
                    user_id, 
                    db, 
                    openai_client, 
                    with_tools_enabled=False,
                    override_model=get_settings().llm_fast_model
                )
                content = result["content"]
                
                # Assume the LLM might return a route (if it figures it out), but usually it asks a question.
                # If it's a question, there's no tool call, so no client_actions.
                # Just proceed to saving the message.
                
                user_ref = db.collection("users").document(user_id)
                if last_user_msg:
                    user_ref.collection("chat_history").document(conv_id).collection("messages").add({
                        "role": "user", "content": last_user_msg.content, "timestamp": now_iso
                    })
                user_ref.collection("chat_history").document(conv_id).collection("messages").add({
                    "role": "assistant", "content": content, "actions": [], "timestamp": now_iso
                })
                user_ref.collection("chat_history").document(conv_id).set({
                    "lastMessage": content[:120], "updatedAt": now_iso, "messageCount": Increment(2)
                }, merge=True)
                
                return ChatResponse(
                    success=True, message=content, actions=[], client_actions=[], conversationId=conv_id
                )

        if intent_info["direct_response"] and isinstance(intent_info["direct_response"], str):
            # Direct response (e.g. GREETING), bypass context loading and OpenAI
            content = intent_info["direct_response"]
            logger.info("[chat] Using direct backend response for intent=%s", intent_info["intent"])
        else:
            # ── Load context ──
            if intent_info["intent"] in ("GREETING", "GENERAL_QA") and not intent_info["required_blocks"]:
                ctx = {}
            else:
                ctx = await load_student_context(user_id, db, required_blocks=intent_info["required_blocks"])

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

        # ── Step 2: Build messages & Run Agent ──
        # Live frontend snapshot (if pushed) goes into the system prompt so
        # the agent's view always matches the user's in-session edits.
        # `academic_record` carries the raw v3 transcript (every completed
        # course with grade + gradePoints) so the Advice CoT block can
        # quote from a full ledger rather than just the top-3 weakest.
            client_ctx_dict = request.client_context.model_dump() if request.client_context else None
            system_prompt = build_system_prompt(
                ctx.get("user_data"),
                ctx.get("transcript"),
                ctx.get("upcoming_exams"),
                ctx.get("active_plan"),
                client_context=client_ctx_dict,
                academic_record=ctx.get("academic_record"),
                schedule=ctx.get("schedule"),
                required_blocks=intent_info["required_blocks"],
                intent=intent_info["intent"]
            )
            logger.debug("[chat] system_prompt length = %d chars", len(system_prompt))

            # ── Trim conversation history to prevent context overflow ──
            # System prompt is already large. We dynamically limit history 
            # based on intent to save cost on simple queries while preserving 
            # context for deep academic analysis.
            intent_name = intent_info["intent"]
            if intent_name == "GENERAL_QA":
                MAX_HISTORY = 2
            elif intent_name in ("PROFILE_QUERY", "GPA_QUERY", "ACADEMIC_CALENDAR", "REGULATIONS", "UNIVERSITY_NEWS"):
                MAX_HISTORY = 4
            elif intent_name in ("GPA_IMPROVEMENT", "PLAN_OR_STUDY_ADVICE", "SCHEDULE_TASK", "SEMESTER_QUERY"):
                MAX_HISTORY = 6
            elif intent_name == "FULL_ACADEMIC_ANALYSIS":
                MAX_HISTORY = 8
            else:
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
                # Update loop call to disable tools if intent doesn't need them
                with_tools = intent_info["needs_tools"]
                override_model = get_settings().llm_fast_model if intent_info["intent"] in ("GENERAL_QA", "COURSE_INFO", "ACADEMIC_CALENDAR", "UNIVERSITY_NEWS") else None
                
                tools_override = None
                if intent_info["intent"] == "COURSE_INFO":
                    from agent.tools_schema import TOOLS_SCHEMA
                    tools_override = [
                        t for t in TOOLS_SCHEMA
                        if t.get("function", {}).get("name") in ("get_course_info", "get_course_reviews")
                    ] or None
                elif intent_info["intent"] == "ACADEMIC_CALENDAR":
                    from agent.tools_schema import TOOLS_SCHEMA
                    calendar_info_tool = next((t for t in TOOLS_SCHEMA if t.get("function", {}).get("name") == "get_calendar_info"), None)
                    if calendar_info_tool:
                        tools_override = [calendar_info_tool]
                elif intent_info["intent"] == "UNIVERSITY_NEWS":
                    from agent.tools_schema import TOOLS_SCHEMA
                    tools_override = [
                        t for t in TOOLS_SCHEMA
                        if t.get("function", {}).get("name") == "get_university_news"
                    ]
                elif intent_info["intent"] == "REGULATIONS":
                    from agent.tools_schema import TOOLS_SCHEMA
                    tools_override = [
                        t for t in TOOLS_SCHEMA
                        if t.get("function", {}).get("name") in ("search_regulations", "get_calendar_info")
                    ]

                if tools_override:
                    tool_names = [t.get("function", {}).get("name") for t in tools_override]
                elif with_tools:
                    from agent.tools_schema import TOOLS_SCHEMA
                    tool_names = [t.get("function", {}).get("name") for t in TOOLS_SCHEMA]
                else:
                    tool_names = []

                logger.info(
                    "[chat] PRE-FLIGHT: intent=%s | model=%s | tools=%s | prompt_len=%d | history_msgs=%d",
                    intent_info["intent"], 
                    override_model or "default (main model)", 
                    tool_names,
                    len(system_prompt), 
                    len(trimmed)
                )

                result = await run_agent_loop(
                    full_messages, 
                    user_id, 
                    db, 
                    openai_client, 
                    with_tools_enabled=with_tools,
                    override_model=override_model,
                    tools_override=tools_override
                )
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

        # ── Persist chat history (standard path) ──
        conv_id = request.conversationId or f"conv_{int(time.time() * 1000)}"
        user_ref = db.collection("users").document(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        # Save user message (reusing the one we already extracted)
        # We handle this lower down because we need `last_user_msg`
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

