"""
================================================================
UQU Academic Assistant — AI Study Plan Generator Schemas
================================================================
Pydantic models for the Gemini-driven study plan endpoint at
    POST /api/plan/generate-ai

Request: snapshot of the student's courses + weekly schedule +
preferences from the frontend stores. Response: a structured weekly
plan with per-task scheduling rationale and per-day summaries.

Why a separate file from `plan_generator.py`?
The legacy `plan_generator.py` schemas describe a rule-based planner
with a different shape (weeks, sessionMin, place, courseColor). The
new AI flow is consumer-driven by the Zustand stores on the frontend
(useTranscriptStore, useScheduleStore, useProfileStore) and uses a
simpler, opinionated shape tuned for Gemini's structured-JSON output.
================================================================
"""

from typing import Literal
from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────
# Request payload (frontend → backend)
# ──────────────────────────────────────────────────────────────────


class PlanCourseInput(BaseModel):
    """A single registered course this semester."""

    code: str = Field(..., description="Course code, e.g., 'CS4216'")
    name: str = Field(..., description="Arabic or English course name")
    creditHours: int = Field(default=3, ge=0, le=12)
    difficulty: Literal["easy", "medium", "hard"] | None = None


class PlanScheduleSlotInput(BaseModel):
    """A busy slot from the student's weekly timetable."""

    day: str = Field(..., description="Arabic day name: الأحد / الإثنين / ...")
    start_time: str = Field(..., description="HH:MM 24-hour")
    end_time: str = Field(..., description="HH:MM 24-hour")
    course_code: str | None = None
    course_name: str | None = None
    type: str | None = Field(default=None, description="نظري | عملي")


class PlanPreferencesInput(BaseModel):
    """Smart Preferences Hub selections."""

    learningStyle: Literal["visual", "auditory", "kinesthetic", "reading"] = "visual"
    energyPeak: Literal["morning", "afternoon", "night"] = Field(
        default="morning",
        description=(
            "Preferred review window: morning 06:00–11:59; "
            "afternoon 12:00–16:59 (17:00–21:59 overflow); "
            "night 22:00–23:59 and 00:00–01:59"
        ),
    )
    taskStrategy: Literal["eat_frog", "snowball"] = "eat_frog"
    pomodoroFocus: int = Field(default=25, ge=15, le=120)
    pomodoroShortBreak: int = Field(default=5, ge=3, le=30)
    pomodoroLongBreak: int = Field(default=15, ge=10, le=60)
    dayOff: Literal[
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "none",
    ] = "friday"


class BacklogItem(BaseModel):
    """One uncompleted task carried over from the previous week's plan.

    Sprint-5 Bug #14 — the frontend store derives this list automatically
    in `generatePlan` (uncompleted tasks from the live `plan.tasks`)
    so the LLM can merge missing items into the new schedule. The
    backend treats this as advisory context, NOT a hard schedule input
    — the prompt instructs the model to RE-distribute these items
    across the new week with appropriate priority bumps.
    """

    title: str
    courseCode: str = ""
    courseName: str | None = None
    durationMinutes: int = Field(default=25, ge=15, le=240)
    suggestedDay: str = ""
    suggestedTime: str = ""
    priority: Literal["high", "medium", "low"] = "medium"


class GeneratePlanRequest(BaseModel):
    """Full payload sent by the frontend Plan page."""

    courses: list[PlanCourseInput] = Field(default_factory=list)
    schedule: list[PlanScheduleSlotInput] = Field(default_factory=list)
    preferences: PlanPreferencesInput
    studentName: str | None = None
    currentGpa: float | None = None
    targetGpa: float | None = None
    backlog: list[BacklogItem] = Field(
        default_factory=list,
        description=(
            "Carry-over tasks from last week the student didn't mark "
            "completed. The system prompt instructs the model to merge "
            "these into the new schedule and append a strategic note "
            "to the overview."
        ),
    )


# ──────────────────────────────────────────────────────────────────
# Response (Gemini → backend → frontend)
# ──────────────────────────────────────────────────────────────────


class PlanTask(BaseModel):
    """One study session in the generated plan."""

    title: str = Field(..., description="Arabic action phrase, e.g., 'مراجعة الفصل الأول'")
    courseCode: str
    courseName: str | None = None
    durationMinutes: int = Field(..., ge=15, le=240)
    suggestedDay: str = Field(..., description="Arabic day name")
    suggestedTime: str = Field(..., description="HH:MM start time")
    priority: Literal["high", "medium", "low"]
    reason: str = Field(..., description="Why this slot was chosen — Arabic, one sentence")


class PlanDailySummary(BaseModel):
    """Per-day rollup the UI uses for the section header."""

    day: str
    summary: str = Field(..., description="One-line Arabic recap of the day's load")
    totalMinutes: int = Field(default=0, ge=0)


class StudyPlan(BaseModel):
    """Full plan returned to the frontend."""

    overview: str = Field(..., description="Two-sentence Arabic intro for the whole week")
    tasks: list[PlanTask] = Field(default_factory=list)
    dailySummary: list[PlanDailySummary] = Field(default_factory=list)


class GeneratePlanResponse(BaseModel):
    """Wrapper response — leaves room for future meta fields."""

    plan: StudyPlan
    model: str
    generatedAt: str  # ISO-8601 timestamp
