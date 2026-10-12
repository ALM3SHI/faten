"""
================================================================
UQU Academic Assistant — Dashboard Analytics Schemas
================================================================
Pydantic models for the dashboard analytics endpoint at
    POST /api/analytics/dashboard

Migrates three client-side computations off the React dashboard:
    1. Target-GPA projection (how much you need next semester)
    2. Cumulative + per-term GPA chart series (chronologically ordered)
    3. Smart course-load advisor (heuristic, GPA-driven)

The frontend forwards raw Zustand store data; the backend returns
all three blocks formatted for direct rendering.
================================================================
"""

from typing import Literal
from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────
# Request payload (frontend → backend)
# ──────────────────────────────────────────────────────────────────


class CourseItem(BaseModel):
    """One completed course from useTranscriptStore.completedCourses.

    `gradePoints` is the per-credit grade point already parsed by the
    PDF importer on the official UQU 4.00 scale (e.g., 3.75 for "A").
    The backend trusts this value — it does NOT re-derive points from
    `grade`. Courses with `gradePoints == null` (W, IP, etc.) are
    excluded from the chart calculation.

    `name` was added in Sprint-3 so the CS-specific category dispatcher
    can fall back to keyword matching on the Arabic/English title when
    the code prefix is ambiguous (e.g., generic "CS" codes that need
    to be split between programming / SE / AI buckets). Optional so
    older callers still validate.
    """

    code: str
    name: str = ""
    credits: int = Field(ge=0, le=12)
    grade: str | None = None
    gradePoints: float | None = Field(default=None, ge=0.0, le=4.0)
    semester: str


class CurrentCourseItem(BaseModel):
    """One in-progress course from useTranscriptStore.currentCourses.

    Used as the ROI-analysis input — we don't need its grade (it doesn't
    exist yet); only the credit hours drive the impact calculation.
    """

    code: str
    name: str = ""                         # Arabic preferred; falls back to code
    credits: int = Field(ge=0, le=12)


class AnalyticsRequest(BaseModel):
    current_gpa: float = Field(ge=0.0, le=4.0)
    target_gpa: float = Field(ge=0.0, le=4.0)
    earned_hours: int = Field(ge=0)
    completed_courses: list[CourseItem] = Field(default_factory=list)
    current_courses: list[CurrentCourseItem] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────
# Response (backend → frontend)
# ──────────────────────────────────────────────────────────────────


class TargetAnalysis(BaseModel):
    required: float = Field(description="GPA needed in the next `next_hours` to hit the target")
    status: Literal["achieved", "feasible", "stretch", "impossible", "no_target"]
    message: str = Field(description="Arabic narrative for the dashboard callout")
    next_hours: int = 15


class ChartPoint(BaseModel):
    """One semester's tick on the dashboard line chart."""

    semester: str = Field(description="Pre-shortened Arabic label, e.g. 'ف1 1443'")
    term_gpa: float
    cumulative_gpa: float


class AdvisorRecommendation(BaseModel):
    hours: str = Field(description='"18" | "15–16" | "12–14"')
    tone: Literal["strong", "steady", "recover"]
    headline: str
    body: str


class RadarCourseRef(BaseModel):
    """One completed course as it appears under a Radar category in the
    drill-down dialog. `contribution = gradePoints × credits` is the
    absolute quality-point contribution of this course toward its
    category's weighted GPA — lets the dialog rank "the courses that
    actually drove this spoke up/down" without recomputing client-side.
    """

    code: str
    name: str = ""
    grade: str | None = None
    gradePoints: float | None = Field(default=None, ge=0.0, le=4.0)
    credits: int = Field(ge=0)
    semester: str = ""
    contribution: float = Field(
        ge=0.0,
        description="gradePoints × credits — quality points this course contributed.",
    )


class RadarCategoryPoint(BaseModel):
    """One axis of the Skills DNA Matrix (dual-radar chart).

    Two polygons share the same axis system:
      • `student_competency` — credit-hour-weighted average of the
        student's actual GPA in this category (UQU 4.00 scale).
      • `market_demand` — the Saudi Vision 2030 benchmark for this
        category (also UQU 4.00 scale). Static, curated values; see
        MARKET_DEMAND_VISION2030 in routers/analytics.py.

    `skill_gap = market_demand − student_competency`. Positive values
    mean the student is below market expectation in that category; the
    bigger the positive number, the louder the "agentic intervention"
    surfaces in the UI. Negative values indicate the student is already
    exceeding market demand — flex space, not concern.

    Categories with zero completed courses are omitted from the response.
    """

    category: str = Field(description="Arabic category label, e.g. 'أساسيات البرمجة'")
    student_competency: float = Field(ge=0.0, le=4.0)
    market_demand: float = Field(ge=0.0, le=4.0)
    skill_gap: float = Field(
        ge=-4.0,
        le=4.0,
        description="market_demand − student_competency. Positive = below market.",
    )
    course_count: int = Field(ge=0)
    credit_hours: int = Field(ge=0)
    is_reliable: bool = Field(
        default=False,
        description=(
            "True only when credit_hours >= 9 (≈ 3 courses). The frontend "
            "uses this to dim low-confidence spokes and to exclude them "
            "from the dominant-gap callout — we don't want to flag a "
            "'severe gap' in a category based on a 2-credit elective."
        ),
    )
    courses: list[RadarCourseRef] = Field(
        default_factory=list,
        description="Drill-down list rendered when the user opens the Radar dialog.",
    )


class HighRoiCourse(BaseModel):
    """One in-progress course ranked by potential GPA leverage."""

    code: str
    name: str
    credits: int
    max_point_contribution: float = Field(
        description="credits × 4.0 — the maximum quality points this course can add."
    )
    projected_delta: float = Field(
        description=(
            "Bump in cumulative GPA if the student scores 4.0 in this course, "
            "given their current earned hours + GPA. Always ≥ 0."
        ),
    )
    label: str = Field(description="Arabic one-liner explaining why this course is high-ROI.")


class InterventionTask(BaseModel):
    """A single pomodoro session the agent has scheduled to close a gap.

    The frontend dispatcher persists these into `usePlanStore.addTask`
    on first render of a given `intervention_id`, gated by a local
    flag so the dashboard never re-schedules the same intervention.
    """

    title: str
    courseCode: str = ""
    courseName: str = ""
    durationMinutes: int = Field(default=25, ge=15, le=50)
    suggestedDay: str = Field(description="Arabic day name")
    suggestedTime: str = Field(description="HH:MM 24-hour")
    priority: Literal["high", "medium", "low"] = "high"
    reason: str = ""


class DecisionLogEntry(BaseModel):
    """One row of the "AI Decision Log" surfaced in the intervention dialog.

    Two strings per row so the UI can render both the raw machine fact
    (small mono font, debuggable) AND a friendly Arabic translation
    (large body copy, narrative). Severity drives the row's color band.
    """

    fact: str = Field(description="Machine-style assertion, e.g. 'current_gpa = 2.10'")
    interpretation: str = Field(description="Plain-Arabic explanation of the fact.")
    severity: Literal["info", "warn", "alert"] = "info"


class AgenticAction(BaseModel):
    """The 'Self-Healing UI' descriptor surfaced as a top-of-dashboard banner.

    The agent emits this when it detects a drop in academic resilience
    (low GPA) or a severe Vision 2030 skill gap. Frontend renders the
    glowing banner AND dispatches `scheduled_tasks` into the plan store
    (idempotent via `intervention_id`).
    """

    active: bool = False
    intervention_id: str = Field(
        default="",
        description="Deterministic id used by the frontend to avoid duplicate task injection.",
    )
    trigger: Literal["none", "low_gpa", "skill_gap", "combined"] = "none"
    severity: Literal["low", "medium", "high"] = "low"
    headline: str = ""
    body: str = ""
    scheduled_tasks: list[InterventionTask] = Field(default_factory=list)
    reasoning: list[DecisionLogEntry] = Field(
        default_factory=list,
        description="Decision-log rows shown inside the intervention dialog.",
    )


class AnalyticsResponse(BaseModel):
    target_analysis: TargetAnalysis
    chart_data: list[ChartPoint]
    advisor_recommendation: AdvisorRecommendation
    strengths_radar: list[RadarCategoryPoint] = Field(default_factory=list)
    high_roi_courses: list[HighRoiCourse] = Field(default_factory=list)
    agentic_action: AgenticAction = Field(default_factory=AgenticAction)
    gpa_trend_analysis: str = Field(
        default="",
        description=(
            "One-sentence Arabic narrative describing the variance of "
            "the student's per-semester GPAs. Rendered as a small insight "
            "box under the Cumulative GPA chart on the dashboard."
        ),
    )
