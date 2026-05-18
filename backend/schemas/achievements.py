"""
================================================================
UQU Academic Assistant — Achievements Schemas
================================================================
Complete achievements schemas for badge calculation, XP tracking,
and level progression. Mirrors localStorage and adds response types.
"""

from typing import Any, Optional
from pydantic import BaseModel, Field


class AchievementsState(BaseModel):
    """Mirror of the loadAchievements() / saveAchievements() shape."""
    xp: int = 0
    unlockedBadges: list[str] = Field(default_factory=list)
    goals: list[dict[str, Any]] = Field(default_factory=list)
    weeklyGoals: list[dict[str, Any]] = Field(default_factory=list)
    lastLoginDate: str | None = None

    model_config = {"extra": "allow"}


class AchievementsResponse(BaseModel):
    success: bool = True


class LevelInfo(BaseModel):
    level: int
    title: str
    xpNeeded: int
    xpInLevel: int
    xpForNext: int
    progress: float
    nextTitle: str


class AchievementsData(BaseModel):
    """Complete achievements data for the user."""
    xp: int
    unlockedBadges: list[str]
    goals: list[dict[str, Any]]
    level: int
    levelTitle: str
    xpInLevel: int
    xpForNext: int
    progress: float


class CheckBadgesRequest(BaseModel):
    """Request to check for new badge unlocks."""
    triggerSource: Optional[str] = None  # e.g., "pomodoro_complete", "plan_generated"


class AddXPRequest(BaseModel):
    """Request to add XP for an action."""
    reason: str  # Should match an XP_REWARDS key
    amount: Optional[int] = None  # Override amount if needed
