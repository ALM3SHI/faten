"""
Workspace API schemas — GET /api/workspace response shapes.
Aligned with frontend Zustand stores (profile, transcript, schedule, plan, chats).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProfileBasic(BaseModel):
    name: str = ""
    major: str = ""
    studentId: str = ""
    totalPlanHours: int | str | None = ""

    model_config = {"extra": "allow"}


class ProfileGoals(BaseModel):
    currentGpa: float = 0
    targetGpa: float = 0

    model_config = {"extra": "allow"}


class ProfilePreferences(BaseModel):
    learningStyle: str = "visual"
    energyPeak: str = "morning"
    taskStrategy: str = "eat_frog"
    pomodoroFocus: int = 25
    pomodoroShortBreak: int = 5
    pomodoroLongBreak: int = 15
    dayOff: str = "friday"

    model_config = {"extra": "allow"}


class WorkspaceProfile(BaseModel):
    basic: ProfileBasic = Field(default_factory=ProfileBasic)
    goals: ProfileGoals = Field(default_factory=ProfileGoals)
    preferences: ProfilePreferences = Field(default_factory=ProfilePreferences)
    lastUpdated: str | None = None
    email: str | None = None
    uid: str | None = None


class ProfileSaveRequest(BaseModel):
    """PATCH /api/workspace/profile — canonical profile write (Phase 2A)."""

    basic: ProfileBasic = Field(default_factory=ProfileBasic)
    goals: ProfileGoals = Field(default_factory=ProfileGoals)
    preferences: ProfilePreferences = Field(default_factory=ProfilePreferences)
    lastUpdated: str | None = None


class ProfileSaveResponse(BaseModel):
    success: bool = True
    profile: WorkspaceProfile


class WorkspaceTranscript(BaseModel):
    name: str | None = None
    nameEn: str | None = None
    studentId: str | None = None
    university: str | None = None
    major: str | None = None
    faculty: str | None = None
    degree: str | None = None
    gpa: float | None = None
    earnedHours: float | int | None = None
    planHours: float | int | None = None
    completedCourses: list[dict[str, Any]] = Field(default_factory=list)
    currentCourses: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = 0
    lastUpdated: str | None = None


class TranscriptSaveRequest(BaseModel):
    """PATCH /api/workspace/transcript — canonical academic record write (Phase 2B)."""

    name: str | None = None
    nameEn: str | None = None
    studentId: str | None = None
    university: str | None = None
    major: str | None = None
    faculty: str | None = None
    degree: str | None = None
    gpa: float | None = None
    earnedHours: float | int | None = None
    planHours: float | int | None = None
    completedCourses: list[dict[str, Any]] = Field(default_factory=list)
    currentCourses: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = 0
    lastUpdated: str | None = None


class TranscriptSaveResponse(BaseModel):
    success: bool = True
    transcript: WorkspaceTranscript


class WorkspaceSchedule(BaseModel):
    schedule: list[dict[str, Any]] = Field(default_factory=list)
    lastUpdated: str | None = None


class ScheduleSaveRequest(BaseModel):
    """PATCH /api/workspace/schedule — canonical timetable write (Phase 2C)."""

    schedule: list[dict[str, Any]] = Field(default_factory=list)
    lastUpdated: str | None = None


class ScheduleSaveResponse(BaseModel):
    success: bool = True
    schedule: WorkspaceSchedule


class WorkspacePlan(BaseModel):
    plan: dict[str, Any] | None = None
    model: str | None = None
    generatedAt: str | None = None
    completed: list[str] = Field(default_factory=list)


class ChatMessageOut(BaseModel):
    role: str
    content: str = ""
    timestamp: str
    actions: list[Any] | None = None

    model_config = {"extra": "allow"}


class ChatThreadOut(BaseModel):
    id: str
    title: str = "محادثة"
    preview: str = ""
    createdAt: str
    updatedAt: str
    conversationId: str | None = None
    messages: list[ChatMessageOut] = Field(default_factory=list)


class WorkspaceChats(BaseModel):
    threads: list[ChatThreadOut] = Field(default_factory=list)


class WorkspaceAchievements(BaseModel):
    xp: int = 0
    unlockedBadges: list[str] = Field(default_factory=list)
    goals: list[dict[str, Any]] = Field(default_factory=list)
    weeklyGoals: list[dict[str, Any]] = Field(default_factory=list)
    lastLoginDate: str | None = None

    model_config = {"extra": "allow"}


class WorkspaceResponse(BaseModel):
    success: bool = True
    profile: WorkspaceProfile
    transcript: WorkspaceTranscript
    schedule: WorkspaceSchedule
    plan: WorkspacePlan
    chats: WorkspaceChats
    achievements: WorkspaceAchievements
    notifications: list[dict[str, Any]] = Field(default_factory=list)
