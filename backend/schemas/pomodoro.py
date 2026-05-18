"""
================================================================
UQU Academic Assistant — Pomodoro Schemas
================================================================
1:1 port of the document shape that assets/pomodoro.js sends,
plus response schemas for stats and session retrieval.
"""

from typing import Optional
from pydantic import BaseModel


class PomodoroSessionLog(BaseModel):
    """The exact field set that pomodoro.js currently passes."""
    courseCode: str = ""
    courseName: str = ""
    duration: int
    type: str = "focus"
    date: str = ""              # YYYY-MM-DD
    completedAt: str = ""       # ISO timestamp

    model_config = {"extra": "allow"}


class PomodoroLogResponse(BaseModel):
    success: bool = True
    id: str


class PomodoroSession(BaseModel):
    """A single Pomodoro session record."""
    id: str
    courseCode: str
    courseName: str
    duration: int
    type: str
    date: str
    completedAt: str


class PomodoroSessionListResponse(BaseModel):
    """List of sessions for the user."""
    sessions: list[PomodoroSession]


class PomodoroStats(BaseModel):
    """Computed statistics for the user's Pomodoro history."""
    todaySessions: int
    todayMinutes: int
    currentStreak: int
    bestDayCount: int
    weeklyChart: list[dict]
    courseBreakdown: list[dict]
    recentSessions: list[PomodoroSession]
    totalSessions: int
    totalMinutes: int
    totalHours: float
    bestStreak: int


class PomodoroSettings(BaseModel):
    """User's Pomodoro timer settings."""
    focus: Optional[int] = 25
    short: Optional[int] = 5
    long: Optional[int] = 15
    sound: Optional[bool] = True
    autoBreak: Optional[bool] = True
    notify: Optional[bool] = True
