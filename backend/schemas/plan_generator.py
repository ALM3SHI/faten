"""
================================================================
UQU Academic Assistant — Plan Generator Schemas
================================================================
"""

from typing import Any
from pydantic import BaseModel, Field


class CourseScheduleSlot(BaseModel):
    """A single lecture time block from the university timetable."""
    day: str
    startTime: str = ""
    endTime: str = ""
    time: str = ""
    timeEnd: str = ""
    activityType: str | None = None
    room: str | None = None
    building: str | None = None

    model_config = {"extra": "allow"}


class PlanCourse(BaseModel):
    """A current course the student wants scheduled."""
    name: str
    difficulty: str | None = None
    id: str | None = None
    examDate: str | None = None
    currentProgress: float | None = None
    progressPerSession: float | None = None
    color: str | None = None
    schedule_slots: list[dict] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class PlanSlot(BaseModel):
    """An available free time block defined by the user."""
    day: str
    time: str
    timeEnd: str
    place: str = ""

    model_config = {"extra": "allow"}


class CompletedCourse(BaseModel):
    """A historical course used to detect weak subjects."""
    name: str
    grade: float | str | None = None

    model_config = {"extra": "allow"}


class PlanProfilePreferences(BaseModel):
    studyTime: str | None = None
    studyStyle: str | None = None
    availableHours: int | str | None = None
    stressLevel: str | None = None
    learningSpeed: str | None = None

    model_config = {"extra": "allow"}


class PlanProfileGoals(BaseModel):
    currentGpa: float | str | None = None
    targetGpa: float | str | None = None

    model_config = {"extra": "allow"}


class PlanProfile(BaseModel):
    preferences: PlanProfilePreferences | None = None
    goals: PlanProfileGoals | None = None

    model_config = {"extra": "allow"}


class PlanGenerationRequest(BaseModel):
    """Full state sent from the plan page."""
    courses: list[PlanCourse] = Field(default_factory=list)
    slots: list[PlanSlot] = Field(default_factory=list)
    profile: PlanProfile | None = None
    completedCourses: list[CompletedCourse] = Field(default_factory=list)
    sessionMin: int = 60
    weeks: int = 1
    planStart: str = ""


class PlanTask(BaseModel):
    """A single study session returned to the frontend."""
    day: str
    time: str
    timeEnd: str
    courseName: str
    title: str
    note: str
    place: str
    week: int = 1
    date: str = ""
    courseId: str | None = None
    courseColor: str = "#6366f1"

    model_config = {"extra": "allow"}


class PlanGenerationResponse(BaseModel):
    """Shape returned by generateAIPlan(state) callers."""
    reasoning: str
    tasks: list[PlanTask]


class FallbackPlanRequest(BaseModel):
    slots: list[dict[str, Any]]
    courses: list[dict[str, Any]]
    sessionMin: int = 60
    weeks: int = 1
    planStart: str


class FallbackPlanResponse(BaseModel):
    success: bool
    plan: list[dict[str, Any]] = []
    warnings: list[str] = []
    message: str = ""
