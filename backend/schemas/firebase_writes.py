"""
================================================================
UQU Academic Assistant — Firebase Writes Schemas
================================================================
1:1 ports of the request shapes for the firebase-db.js write
functions being migrated to the backend:
  - pushPlanToFirestore(planData)
  - pushChatToFirestore(conversationId, messages, title)
  - pushTranscriptToFirestore(courses, cgpa, totalHours, semesters)
  - syncSemestersToFirestore(semesters)

Field names match the JS exactly so existing callers stay valid.
"""

from typing import Any
from pydantic import BaseModel, Field


class PushPlanRequest(BaseModel):
    """Mirror of pushPlanToFirestore(planData) — entire plan is forwarded."""
    plan: dict[str, Any] = Field(default_factory=dict)


class PushChatRequest(BaseModel):
    """Mirror of pushChatToFirestore(conversationId, messages, title)."""
    conversationId: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
    title: str | None = None


class PushTranscriptRequest(BaseModel):
    """Mirror of pushTranscriptToFirestore(courses, cgpa, totalHours, semesters).

    Note: this writes to users/{uid}/academic_records with type='transcript'
    — DIFFERENT from the existing /syncTranscript endpoint which writes to
    users/{uid}/transcripts. Both are preserved per the 1:1 rule."""
    courses: list[dict[str, Any]] = Field(default_factory=list)
    semesters: list[dict[str, Any]] = Field(default_factory=list)
    cgpa: float | None = None
    totalHours: int | None = None


class SyncSemestersRequest(BaseModel):
    """Mirror of syncSemestersToFirestore(semesters) — each semester
    becomes its own academic_records doc with type='semester'."""
    semesters: list[dict[str, Any]] = Field(default_factory=list)


class FirebaseWriteResponse(BaseModel):
    success: bool = True
    id: str | None = None
    ids: list[str] | None = None
