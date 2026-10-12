from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# --- Save Profile Schema (replaces direct Firestore writes from onboarding.js) ---

class OnboardingSaveGoals(BaseModel):
    currentGpa: Optional[float] = None
    earnedHours: Optional[int] = None
    targetGpa: Optional[float] = None
    planHours: Optional[float] = None
    goal: str = "raise"

class OnboardingSavePreferences(BaseModel):
    theme: str = "auto"
    notifications: bool = True
    work_status: str = "none"
    best_time: str = "night"
    study_hours: Optional[int] = 10
    method: str = "Pomodoro"
    focus_length: Optional[int] = 45
    study_speed: str = "normal"
    stress_level: str = "normal"

class SaveProfileRequest(BaseModel):
    """Payload for POST /api/onboarding/save-profile.
    Replaces the direct Firestore batch write in onboarding.js."""
    goals: OnboardingSaveGoals
    courses: List[Dict[str, Any]] = []
    preferences: OnboardingSavePreferences = OnboardingSavePreferences()
    timetable: List[Dict[str, Any]] = []
    historical_semesters: List[Dict[str, Any]] = []
    university: str = "أم القرى"

class SaveProfileResponse(BaseModel):
    success: bool = True
    message: str = "تم حفظ البيانات بنجاح"


# --- Transcript Parsing Schemas ---

class OnboardingCourse(BaseModel):
    name: str = Field(..., description="Subject name")
    code: str = Field(..., description="Subject code (e.g. CS 101)")
    credits: int = Field(..., description="Credit hours for the subject")
    grade: str = Field(..., description="Letter grade (e.g., A+, B, F)")
    term: Optional[str] = Field(None, description="The semester/term the course was taken in")

class HistoricalSemester(BaseModel):
    name: str = Field(..., description="Name of the semester (e.g., الفصل الأول 1444)")
    sgpa: float = Field(..., description="Semester GPA")
    gpa: float = Field(..., description="Cumulative GPA at the end of this semester")
    hours: int = Field(..., description="Credit hours taken in this semester")

class LearningStyleSuggestion(BaseModel):
    best_time: str = Field(..., description="Suggested optimal study time. Options: 'morning', 'noon', 'evening', 'night'")
    study_hours: int = Field(..., description="Suggested total study hours per week")
    method: str = Field(..., description="Suggested study method (e.g., 'Pomodoro', 'Deep Work', 'Spaced Repetition')")
    focus_length: int = Field(..., description="Suggested focus length in minutes (e.g., 25, 45, 60)")
    study_speed: str = Field(..., description="Suggested study speed: 'fast', 'normal', 'slow'")
    stress_level: str = Field(..., description="Current detected stress level: 'low', 'normal', 'high'")
    concept_style: str = Field(..., description="Learning style (Visual, Auditory, Reading, Kinesthetic)")

class OnboardingTranscriptResponse(BaseModel):
    success: bool = Field(True, description="Whether the parsing was successful")
    current_gpa: float = Field(..., description="Extracted cumulative GPA")
    gpa_scale: float = Field(..., description="Grading scale — always 4.0 (UQU's official scale).")
    earned_hours: int = Field(..., description="Total earned credit hours")
    plan_hours: Optional[int] = Field(..., description="Total required plan hours if listed, otherwise default to 130")
    university: str = Field(..., description="Name of the University, e.g., Umm Al-Qura University")
    courses: List[OnboardingCourse] = Field(..., description="List of extracted current courses (for active semester)")
    historical_semesters: List[HistoricalSemester] = Field(..., description="List of past semesters with GPA performance")
    suggested_learning_style: LearningStyleSuggestion = Field(..., description="AI suggested learning preferences")
    affinity_reasoning: str = Field(..., description="Short explanation (in Arabic) of why this learning style was chosen.")

# --- Timetable Parsing Schemas ---

class TimetableEntry(BaseModel):
    course_name: str = Field(..., description="Name of the course")
    days: List[str] = Field(..., description="Days of the week (e.g., Sunday, Tuesday) in Arabic or English depending on source")
    start_time: str = Field(..., description="Start time (e.g., 10:00 AM)")
    end_time: str = Field(..., description="End time (e.g., 11:30 AM)")
    location: Optional[str] = Field(None, description="Location/Hall if available")

class TimetableResponse(BaseModel):
    success: bool = Field(True, description="Whether timetable parsing was successful")
    schedule: List[TimetableEntry] = Field(..., description="List of scheduled classes")
