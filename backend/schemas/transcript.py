"""
================================================================
UQU Academic Assistant — Transcript Schemas
================================================================
"""

from __future__ import annotations
from pydantic import BaseModel


class CourseRecord(BaseModel):
    """A single course from the academic transcript."""
    code: str = ""
    nameEn: str = ""
    nameAr: str = ""
    name: str = ""
    creditHours: int = 0
    passHours: int = 0
    degree: int = 0
    grade: str | None = None
    points: float = 0.0
    gradePoints: float | None = None
    semester: str = ""
    semesterEn: str = ""
    semesterStatus: str = ""  # completed, registered, current
    difficulty: str = "medium"
    type: str = "theory"

class SemesterRecord(BaseModel):
    """A semester from the academic transcript with GPA."""
    nameEn: str = ""
    nameAr: str = ""
    term: str = ""
    year: str = ""
    sgpa: float | None = None
    cgpa: float | None = None
    totalHours: int = 0
    totalPassedHours: int = 0
    courses: list[dict] = []
    status: str = "completed"

class TranscriptAnalysisResult(BaseModel):
    """Full structured output of the PDF parsing process."""
    name: str | None = None
    nameEn: str | None = None
    studentId: str | None = None
    university: str | None = None
    major: str | None = None
    majorEn: str | None = None
    faculty: str | None = None
    degree: str | None = None
    studyType: str | None = None
    gpa: float | None = None
    earnedHours: int | None = None
    planHours: int | None = None
    totalPoints: float | None = None
    semesters: list[SemesterRecord] = []
    completedCourses: list[CourseRecord] = []
    registeredCourses: list[CourseRecord] = []
    weaknesses: list[str] = []
    strengths: list[str] = []
    recommendations: list[str] = []
    summary: str | None = None
    debug_raw: str | None = None
    confidence: int = 0
    timestamp: str = ""

class TranscriptPayload(BaseModel):
    """Request body for POST /api/sync-transcript."""
    courses: list[CourseRecord] = []
    semesters: list[SemesterRecord] = []
    cgpa: float | None = None
    totalHours: int | None = None

class TranscriptResponse(BaseModel):
    """Response body for POST /api/sync-transcript."""
    success: bool = True
    analysis: dict = {}


class NotificationReadRequest(BaseModel):
    """Request body for POST /api/mark-notification-read."""
    notificationId: str
