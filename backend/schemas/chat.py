"""
================================================================
UQU Academic Assistant — Chat Schemas
================================================================
"""

from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A single message in the conversation."""
    role: Literal["user", "assistant", "system"]
    content: str


class ClientContext(BaseModel):
    """Live snapshot pushed from the frontend stores so the agent's view
    is never stale (Firestore can lag the user's in-session edits).

    All fields optional — the agent gracefully degrades when any block
    is missing. Numbers are on the UQU 4.00 GPA scale.
    """

    profile: dict[str, Any] | None = Field(
        default=None,
        description="Snapshot of useProfileStore (name, major, studentId, totalPlanHours, goals).",
    )
    transcript: dict[str, Any] | None = Field(
        default=None,
        description="Snapshot of useTranscriptStore (gpa, earnedHours, completedCourses, currentCourses).",
    )
    plan: dict[str, Any] | None = Field(
        default=None,
        description="Snapshot of usePlanStore (tasks for today, pomodoro defaults).",
    )


class ChatRequest(BaseModel):
    """Request body for POST /api/chat."""
    messages: list[ChatMessage]
    conversationId: str | None = None
    client_context: ClientContext | None = None


class ActionLog(BaseModel):
    """A logged tool action performed by the agent (server-side execution)."""
    tool: str
    args: dict | None = None
    result: dict | None = None


class ClientAction(BaseModel):
    """A structured directive for the frontend to mutate a Zustand store.

    Emitted by the agent via the `emit_client_action` tool. Each action
    has a discriminator `type` (e.g. ADD_TASK, UPDATE_TARGET_GPA, NAVIGATE)
    and an opaque `payload` validated by the frontend dispatcher.
    """
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    """Response body for POST /api/chat."""
    success: bool = True
    message: str
    actions: list[dict] = Field(
        default_factory=list,
        description="Server-side tool-execution log (for debugging / chat-history audit).",
    )
    client_actions: list[ClientAction] = Field(
        default_factory=list,
        description="Structured directives the frontend dispatcher applies to Zustand stores.",
    )
    conversationId: str
    error_type: str | None = Field(
        default=None,
        description=(
            "Classified failure category when the agent couldn't produce a "
            "real answer. The frontend uses this to render a warning-styled "
            "system message instead of a normal bot reply. Values: "
            "`api_limit` (NIM 429 / quota), `api_auth` (401 invalid key), "
            "`api_unavailable` (404 / 5xx / network), `api_timeout`, "
            "`agent_error` (generic). `null` on success."
        ),
    )
