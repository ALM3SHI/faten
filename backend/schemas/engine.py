"""
================================================================
UQU Academic Assistant — Engine Compute Schemas
================================================================
1:1 port of the request/response shapes for assets/engine.js
helpers being moved to the backend:
  - scoreExamPressure
  - getPlanWarnings
  - suggestExtraSessionsForCourse

Field names match the JS exactly.
"""

from typing import Any
from pydantic import BaseModel, Field


# ── Exam Pressure ──

class ExamPressureRequest(BaseModel):
    courses: list[dict[str, Any]] = Field(default_factory=list)
    today: str | None = None  # YYYY-MM-DD; defaults to Asia/Riyadh today


class ExamPressureResponse(BaseModel):
    courses: list[dict[str, Any]] = Field(default_factory=list)


# ── Plan Warnings ──

class PlanWarningsRequest(BaseModel):
    plan: dict[str, Any] | None = None
    profile: dict[str, Any] | None = None
    today: str | None = None


class PlanWarning(BaseModel):
    type: str
    msg: str
    urgent: bool | None = None

    model_config = {"extra": "allow"}


class PlanWarningsResponse(BaseModel):
    warnings: list[dict[str, Any]] = Field(default_factory=list)


# ── Suggest Extra Sessions ──

class SuggestSessionsRequest(BaseModel):
    course: dict[str, Any]
    plan: dict[str, Any] | None = None
    slots: list[dict[str, Any]] = Field(default_factory=list)
    count: int = 2
    today: str | None = None


class SuggestSessionsResponse(BaseModel):
    suggestions: list[dict[str, Any]] = Field(default_factory=list)


# ── Smart Plan Generator ──

class SmartPlanRequest(BaseModel):
    profile: dict[str, Any] | None = None
    slots: list[dict[str, Any]] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)
    today: str | None = None


class SmartPlanResponse(BaseModel):
    plan: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
