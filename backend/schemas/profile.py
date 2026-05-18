"""
================================================================
UQU Academic Assistant — Profile Schemas
================================================================
"""

from __future__ import annotations
from pydantic import BaseModel, model_validator


class BasicInfo(BaseModel):
    """Basic student info from localStorage."""
    name: str = ""
    university: str = ""
    major: str = ""
    level: str = ""

    model_config = {"extra": "allow"}


class GoalsInfo(BaseModel):
    """Academic goals."""
    currentGpa: float | None = None
    targetGpa: float | None = None
    earnedHours: int | None = None

    model_config = {"extra": "allow"}


class LearningInfo(BaseModel):
    """Learning preferences."""
    bestTime: str = ""
    studyHours: int = 0
    studyStyle: str = ""
    focusLength: int = 25
    studySpeed: str = "normal"
    stressLevel: str | int = "normal"   # frontend sends int from parseInt()

    model_config = {"extra": "allow"}


class ProfilePayload(BaseModel):
    """Request body for POST /api/sync-profile.
    Maps to the localStorage structure sent from the frontend.
    """
    # Structured format (preferred)
    basic: BasicInfo | None = None
    goals: GoalsInfo | None = None
    learning: LearningInfo | None = None
    courses: list[dict] = []

    # Flat format fallback
    name: str = ""
    university: str = ""
    major: str = ""
    level: str = ""


class ProfileResponse(BaseModel):
    """Response body for POST /api/sync-profile."""
    success: bool = True

class AcademicProfile(BaseModel):
    """Unified profile structure used across backend services."""
    basic: BasicInfo = BasicInfo()
    goals: GoalsInfo = GoalsInfo()
    learning: LearningInfo = LearningInfo()
    courses: list[dict] = []
    
    model_config = {"extra": "allow"}
