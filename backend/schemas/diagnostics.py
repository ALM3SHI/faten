from typing import List, Dict, Any, Optional
from pydantic import BaseModel

class DiagnosticsRequest(BaseModel):
    semesters: List[Dict[str, Any]] = []
    currentCourses: List[Dict[str, Any]] = []
    goals: Dict[str, Any] = {}

class GoalCalcRequest(BaseModel):
    currentGpa: float
    earnedHours: float
    totalPoints: Optional[float] = None
    targetGpa: float
    termHours: float
