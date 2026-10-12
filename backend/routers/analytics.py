"""
================================================================
UQU Academic Assistant — Dashboard Analytics Router
================================================================
Centralises business logic that previously lived in the React
dashboard (frontend/src/app/dashboard/page.tsx):

  • computeRequiredNextGpa  →  _compute_target_analysis
  • buildCumulativeGpaSeries →  _build_chart_series
  • adviseHourLoad          →  _advise_hour_load

Exposed at:
    POST /api/analytics/dashboard

Requires a valid Firebase ID token (HTTPBearer) — matches the auth
contract of every other migrated router in this backend.

DATA INTEGRITY GUARANTEES (do NOT remove):
  1. SINGLE SCALE — official UQU 4.00. Every value handled here
     (current_gpa, target_gpa, gradePoints, computed term/cumulative
     GPAs, required-next projection) lives on the 4.00 scale. There is
     no other scale anywhere; never reintroduce a 5.0 mapping.
  2. NO scale conversions. The chart computes
        term_gpa = Σ(gradePoints · credits) / Σ(credits)
     using the EXACT gradePoints values supplied in the payload — no
     normalisation, no offsets, no inferred rescaling.
  3. NO mock or fallback data. The function only iterates the
     `completed_courses` list received from the request. There is
     no hardcoded semester, no placeholder summer term.
  4. Courses without a real letter grade (W, IP, NP, IC, null) are
     SKIPPED — they have no gradePoints and contribute neither to
     the term nor cumulative average. A semester whose only courses
     are skipped does NOT appear in the chart.
================================================================
"""

import logging
import re
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException

import hashlib
from datetime import date as _date, timedelta

from auth.bearer import verify_firebase_token
from schemas.analytics import (
    AdvisorRecommendation,
    AgenticAction,
    AnalyticsRequest,
    AnalyticsResponse,
    ChartPoint,
    CourseItem,
    CurrentCourseItem,
    DecisionLogEntry,
    HighRoiCourse,
    InterventionTask,
    RadarCategoryPoint,
    RadarCourseRef,
    TargetAnalysis,
)

# Grades that DO NOT contribute to GPA (UQU registrar convention).
# Courses with any of these grades are dropped before semester aggregation.
NON_GPA_GRADES: frozenset[str] = frozenset({"W", "IP", "NP", "IC", ""})


# ──────────────────────────────────────────────────────────────────
# Course-category taxonomy — CS-specific (Sprint 3 rewrite)
# ──────────────────────────────────────────────────────────────────
# The previous taxonomy lumped every CS course into one big "البرمجة"
# bucket, which made the radar useless for picking up the difference
# between (say) a student strong in cyber but weak in AI. The buckets
# below mirror the CS-track specializations Saudi employers hire for.
#
# CATEGORIES (in Arabic, as rendered on the radar):
#   • أساسيات البرمجة                 — programming fundamentals, DS, OS
#   • هندسة البرمجيات                 — SE / requirements / design / arch
#   • الذكاء الاصطناعي   — AI / ML / data / analytics
#   • الأمن السيبراني          — cyber / security / networks / crypto
#   • الرياضيات والمنطق                — math / stats / logic / discrete
#   • الكفاءة المهنية      — internship / capstone / senior project
#   • متنوعة                          — everything else (defensive fallback)
#
# DISPATCH PRIORITY in `_categorize_course`:
#   1. Name keyword match (Arabic first, then English). Most reliable
#      signal for UQU because the registrar emits descriptive Arabic
#      titles even when codes are numeric/cryptic (e.g. "4413313 برمجة 1").
#   2. Code-prefix fallback (legacy support).
#   3. Default bucket.

# CS-track categories — exported so the frontend can theoretically render
# an "all categories" picker even when a student has zero completed
# courses in one bucket. The default fallback "متنوعة" is intentionally
# NOT in this tuple.
CS_TAXONOMY: tuple[str, ...] = (
    "أساسيات البرمجة",
    "هندسة البرمجيات",
    "الذكاء الاصطناعي",
    "الأمن السيبراني",
    "الرياضيات والمنطق",
    "الكفاءة المهنية",
)

_DEFAULT_CATEGORY = "متنوعة"
_COURSE_PREFIX_RE = re.compile(r"^([A-Za-z]+)")

# Keyword sets for name-based dispatch. Lowercased Arabic / English; we
# do a case-insensitive substring check against the lowercased course
# name. Order WITHIN each tuple doesn't matter — we short-circuit on
# first hit — but order of the dispatch BLOCKS in `_categorize_course`
# matters: most specific categories first so "تدريب تعاوني في الذكاء
# الاصطناعي" buckets as COOP, not AI.
_PROJECT_KEYWORDS: tuple[str, ...] = (
    "تدريب تعاوني", "تدريب ميداني", "مشروع تخرج", "كوب", "كووب", "تخرج",
    "coop", "co-op", "cooperative", "internship", "capstone",
    "senior project", "graduation project",
)
_CYBER_KEYWORDS: tuple[str, ...] = (
    "أمن", "سيبراني", "شبكات", "تشفير", "اختراق",
    "security", "cyber", "network", "cryptograph", "firewall",
    "ethical hacking", "penetration",
)
_AI_DATA_KEYWORDS: tuple[str, ...] = (
    "ذكاء اصطناعي", "تعلم الآلة", "تعلم آلة", "التعلم العميق",
    "علم البيانات", "تحليل البيانات", "تنقيب البيانات", "البيانات الضخمة",
    "الرؤية الحاسوبية", "معالجة اللغة",
    "artificial intelligence", "machine learning", "deep learning",
    "neural", "data science", "data mining", "data analytics", "big data",
    "computer vision", "natural language", "nlp ",
)
_SE_KEYWORDS: tuple[str, ...] = (
    "هندسة البرمجيات", "تحليل النظم", "نمذجة النظم", "متطلبات البرمجيات",
    "تصميم البرمجيات", "اختبار البرمجيات", "إدارة المشاريع البرمجية",
    "software engineering", "software design", "requirements",
    "agile", "devops", "software testing", "software architecture",
)
_PROGRAMMING_KEYWORDS: tuple[str, ...] = (
    "برمجة", "بنية البيانات", "هياكل البيانات", "خوارزميات",
    "مترجمات", "نظم تشغيل", "قواعد البيانات", "تطوير الويب", "ويب", "الجوال",
    "programming", "data structure", "algorithm", "compiler",
    "operating system", "database", "web development", "mobile",
    "object-oriented",
)
_MATH_KEYWORDS: tuple[str, ...] = (
    "رياضيات", "حساب", "تفاضل", "تكامل", "جبر", "إحصاء", "احتمالات",
    "منطق", "متقطعة", "خطي", "تحليل عددي",
    "math", "calculus", "algebra", "statistic", "probability",
    "logic", "discrete", "linear", "numerical",
)


# ──────────────────────────────────────────────────────────────────
# Skills DNA — Saudi Vision 2030 market-demand benchmarks
# ──────────────────────────────────────────────────────────────────
# Per-category target values on the UQU 4.00 scale. They reflect how
# "in demand" each CS sub-skill is for the Vision 2030 labor market.
# Recalibrated in Sprint 3 to match the new CS-specific taxonomy:
#
#   • AI / Data         = 3.90  ← top priority (national AI strategy)
#   • Cybersecurity     = 3.80  ← critical infrastructure mandate
#   • Software Eng.     = 3.70  ← every digital transformation hire
#   • Programming Fund. = 3.60  ← baseline expectation
#   • Math / Logic      = 3.50
#   • COOP / Capstone   = 3.50  ← practical experience signal
#   • Other             = 3.00  ← unspecialised fallback
#
# Tune as priorities evolve; the radar will adjust automatically.
MARKET_DEMAND_VISION2030: dict[str, float] = {
    "الذكاء الاصطناعي": 3.90,
    "الأمن السيبراني":         3.80,
    "هندسة البرمجيات":                3.70,
    "أساسيات البرمجة":                3.60,
    "الرياضيات والمنطق":              3.50,
    "الكفاءة المهنية":    3.50,
    _DEFAULT_CATEGORY:                3.00,
}

# Gap thresholds (positive = student below market).
# Used by _maybe_emit_agentic_action and the radar tooltip styling.
_SKILL_GAP_SEVERE = 1.00     # any single category this far below = high severity
_SKILL_GAP_MODERATE = 0.50
_LOW_GPA_THRESHOLD = 2.5     # current_gpa below this triggers recovery loop

# Reliability threshold for the Skills DNA radar. A category with fewer
# than this many credit hours of completed coursework is flagged as
# unreliable (`RadarCategoryPoint.is_reliable = False`) — the frontend
# dims its spoke and excludes it from "biggest gap" callouts so we don't
# scare a student about a "weakness" inferred from 2 elective credits.
# 9 credits ≈ 3 standard 3-credit courses, which is the smallest sample
# size we'll trust for a competency claim.
_RELIABLE_CATEGORY_MIN_HOURS = 9


def _name_contains_any(name_lc: str, needles: tuple[str, ...]) -> bool:
    """Substring search across a pre-lowercased haystack. O(n·k) but the
    haystack is a single course title — tiny in practice."""
    if not name_lc:
        return False
    return any(n in name_lc for n in needles)


def _categorize_course(code: str, name: str = "") -> str:
    """Map a course to its CS-track Arabic category.

    Inspects `name` first (Arabic + English keyword sets); falls back to
    an alphabetic code-prefix heuristic when the name is missing or
    uninformative. The two-stage approach handles both UQU's modern
    PDF transcripts (descriptive titles, numeric codes) and the older
    code-only exports.
    """
    name_lc = (name or "").strip().lower()

    # ── Name-based dispatch — most specific buckets first ──
    if _name_contains_any(name_lc, _PROJECT_KEYWORDS):
        return "الكفاءة المهنية"
    if _name_contains_any(name_lc, _CYBER_KEYWORDS):
        return "الأمن السيبراني"
    if _name_contains_any(name_lc, _AI_DATA_KEYWORDS):
        return "الذكاء الاصطناعي"
    if _name_contains_any(name_lc, _SE_KEYWORDS):
        return "هندسة البرمجيات"
    if _name_contains_any(name_lc, _PROGRAMMING_KEYWORDS):
        return "أساسيات البرمجة"
    if _name_contains_any(name_lc, _MATH_KEYWORDS):
        return "الرياضيات والمنطق"

    # ── Code-prefix fallback (UQU-style alphabetic prefix) ──
    if not code:
        return _DEFAULT_CATEGORY
    m = _COURSE_PREFIX_RE.match(code)
    if not m:
        return _DEFAULT_CATEGORY
    letters = m.group(1).upper()
    if letters.startswith(("MATH", "STAT", "MA")):
        return "الرياضيات والمنطق"
    if letters.startswith(("SE", "SWE")):
        return "هندسة البرمجيات"
    if letters.startswith(("AI", "DS", "ML")):
        return "الذكاء الاصطناعي"
    if letters.startswith(("SEC", "CYB", "NET")):
        return "الأمن السيبراني"
    if letters.startswith(("COOP", "INTR")):
        return "الكفاءة المهنية"
    if letters.startswith(("CSC", "CSE", "CS", "CP")):
        # Generic CS code without a more specific name signal — bucket
        # as programming fundamentals (likeliest default at UQU).
        return "أساسيات البرمجة"
    return _DEFAULT_CATEGORY

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])

# Standard course-load assumed for the target-GPA projection.
NEXT_HOURS = 15
# Official UQU grading ceiling on the 4.00 scale — a required GPA above
# this is mathematically impossible regardless of remaining course load.
UQU_GPA_SCALE = 4.0


# ══════════════════════════════════════════════════════════════════
#  Endpoint
# ══════════════════════════════════════════════════════════════════


@router.post("/dashboard", response_model=AnalyticsResponse)
async def dashboard_analytics(
    body: AnalyticsRequest,
    user_id: str = Depends(verify_firebase_token),
) -> AnalyticsResponse:
    """Return the three analytic blocks the dashboard renders."""
    logger.info(
        "Analytics request: user=%s gpa=%.2f→%.2f earned=%d courses=%d",
        user_id,
        body.current_gpa,
        body.target_gpa,
        body.earned_hours,
        len(body.completed_courses),
    )

    try:
        radar = _build_strengths_radar(body.completed_courses)
        chart_data = _build_chart_series(body.completed_courses)
        return AnalyticsResponse(
            target_analysis=_compute_target_analysis(
                body.current_gpa, body.earned_hours, body.target_gpa
            ),
            chart_data=chart_data,
            advisor_recommendation=_advise_hour_load(body.current_gpa),
            strengths_radar=radar,
            high_roi_courses=_compute_high_roi_courses(
                body.current_courses,
                current_gpa=body.current_gpa,
                earned_hours=body.earned_hours,
                top_n=2,
            ),
            agentic_action=_maybe_emit_agentic_action(
                current_gpa=body.current_gpa,
                completed_courses=body.completed_courses,
                current_courses=body.current_courses,
                radar=radar,
            ),
            gpa_trend_analysis=_analyze_gpa_trend(chart_data),
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — last-resort guard
        logger.error("Analytics unexpected failure: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"فشل في حساب تحليلات لوحة التحكم: {type(exc).__name__}",
        ) from exc


# ══════════════════════════════════════════════════════════════════
#  Engines
# ══════════════════════════════════════════════════════════════════


def _compute_target_analysis(
    current_gpa: float, earned_hours: int, target_gpa: float
) -> TargetAnalysis:
    """Port of computeRequiredNextGpa() from the React dashboard.

    Math:
        current_points  = current_gpa * earned_hours
        desired_points  = target_gpa * (earned_hours + NEXT_HOURS)
        required        = (desired_points - current_points) / NEXT_HOURS
    """
    # No target set → distinct status so the frontend can hide the
    # "required next GPA" callout without faking a feasible projection.
    if target_gpa <= 0:
        return TargetAnalysis(
            required=0.0,
            status="no_target",
            next_hours=NEXT_HOURS,
            message="حدّد معدلاً مستهدفاً من صفحة البروفايل لرؤية المطلوب لتحقيقه.",
        )

    # Target set but no transcript yet → use the target itself as the
    # required baseline (you'd need to score exactly the target).
    if earned_hours <= 0:
        return TargetAnalysis(
            required=round(target_gpa, 2),
            status="feasible",
            next_hours=NEXT_HOURS,
            message="ارفع سجلك الأكاديمي حتى نحسب لك المطلوب بدقة بناءً على ساعاتك المكتسبة.",
        )

    current_points = current_gpa * earned_hours
    desired_points = target_gpa * (earned_hours + NEXT_HOURS)
    required = (desired_points - current_points) / NEXT_HOURS

    if required <= current_gpa or required <= 0:
        return TargetAnalysis(
            required=round(max(current_gpa, 0.0), 2),
            status="achieved",
            next_hours=NEXT_HOURS,
            message=f"🎉 وصلت لهدفك ({target_gpa:.2f}) بالفعل — حافظ على مستواك.",
        )

    required_rounded = round(required, 2)

    if required > UQU_GPA_SCALE:
        return TargetAnalysis(
            required=required_rounded,
            status="impossible",
            next_hours=NEXT_HOURS,
            message=(
                f"المطلوب {required_rounded:.2f} يتجاوز سقف 4.00 — "
                "غيّر الهدف أو وزّعه على فصلين."
            ),
        )

    if required > UQU_GPA_SCALE - 0.5:
        return TargetAnalysis(
            required=required_rounded,
            status="stretch",
            next_hours=NEXT_HOURS,
            message=(
                f"تحتاج معدل {required_rounded:.2f} في الـ{NEXT_HOURS} ساعة القادمة — "
                "هدف طموح يتطلب أداءً ممتازًا."
            ),
        )

    return TargetAnalysis(
        required=required_rounded,
        status="feasible",
        next_hours=NEXT_HOURS,
        message=(
            f"للوصول لهدفك {target_gpa:.2f}، تحتاج معدل {required_rounded:.2f} "
            f"في الـ{NEXT_HOURS} ساعة القادمة."
        ),
    )


_YEAR_RE = re.compile(r"\d{4}")


def _extract_year_key(semester: str) -> int:
    """Earliest 4-digit year in the semester string (for chronological sort)."""
    matches = _YEAR_RE.findall(semester or "")
    if not matches:
        return 10**9  # push unparseable labels to the end
    return min(int(m) for m in matches)


def _short_semester_label(semester: str) -> str:
    """Compact Arabic label for the chart x-axis: 'الفصل الأول 1443/1444' → 'ف1 1443'."""
    year_match = _YEAR_RE.search(semester)
    year = year_match.group(0) if year_match else ""
    if "الأول" in semester:
        return f"ف1 {year}".strip()
    if "الثاني" in semester:
        return f"ف2 {year}".strip()
    if "الثالث" in semester or "الصيف" in semester:
        return f"صيف {year}".strip()
    return semester[:14]


def _is_gpa_bearing(c: CourseItem) -> bool:
    """A course counts toward GPA only if it has all three:
        • a non-empty semester label,
        • a real letter grade (not W/IP/NP/IC/null),
        • a numeric gradePoints value supplied by the frontend parser,
        • positive credits.
    Everything else is dropped — including in-progress/withdrawn courses
    that the parser might surface in `completedCourses`.
    """
    if not c.semester:
        return False
    if c.gradePoints is None:
        return False
    if c.credits <= 0:
        return False
    grade_norm = (c.grade or "").strip().upper()
    if grade_norm in NON_GPA_GRADES:
        return False
    return True


def _build_chart_series(courses: list[CourseItem]) -> list[ChartPoint]:
    """Group GPA-bearing courses by semester, sort chronologically, and
    emit the per-semester + running-cumulative GPA series.

    NO transformations of gradePoints are performed — the values returned
    here are the literal weighted mean of whatever the payload contained.
    NO synthetic semesters are injected; the output list mirrors exactly
    the set of semesters present in `courses` (minus any that became
    empty after dropping non-GPA-bearing entries).
    """
    groups: "OrderedDict[str, list[CourseItem]]" = OrderedDict()
    for c in courses:
        if not _is_gpa_bearing(c):
            continue
        groups.setdefault(c.semester, []).append(c)

    ordered = sorted(
        groups.items(),
        key=lambda kv: (_extract_year_key(kv[0]), kv[0]),
    )

    series: list[ChartPoint] = []
    cum_points = 0.0
    cum_hours = 0
    for semester, items in ordered:
        sem_points = sum((c.gradePoints or 0.0) * c.credits for c in items)
        sem_hours = sum(c.credits for c in items)
        if sem_hours == 0:
            # Defensive — should be unreachable since _is_gpa_bearing
            # already enforces credits > 0. Skip silently rather than
            # invent a 0/0 placeholder semester.
            continue
        cum_points += sem_points
        cum_hours += sem_hours
        series.append(
            ChartPoint(
                semester=_short_semester_label(semester),
                term_gpa=round(sem_points / sem_hours, 3),
                cumulative_gpa=round(cum_points / cum_hours, 3),
            )
        )
    return series


def _advise_hour_load(current_gpa: float) -> AdvisorRecommendation:
    """User-specified heuristic (≥3.5 strong, <2.75 recover, else steady)."""
    if current_gpa >= 3.5:
        return AdvisorRecommendation(
            hours="18",
            tone="strong",
            headline="أداؤك ممتاز 🏆",
            body=(
                "فكر في تسجيل 18 ساعة الترم القادم لتسريع التخرج. "
                "أنت قادر على حمل أكبر دون التضحية بالجودة."
            ),
        )
    if current_gpa < 2.75:
        return AdvisorRecommendation(
            hours="12–14",
            tone="recover",
            headline="ركّز على الجودة 🎯",
            body=(
                "ينصح بتسجيل 12–14 ساعة فقط، وزيادة وقت المذاكرة لكل مادة. "
                "الحمل الأخف الآن يعني معدل أعلى لاحقاً."
            ),
        )
    return AdvisorRecommendation(
        hours="15–16",
        tone="steady",
        headline="تقدمك ثابت 👍",
        body=(
            "حافظ على حملك الحالي (15–16 ساعة). "
            "لو أردت رفع المعدل، فكّر في مادة أقل وزيد التركيز على الجودة."
        ),
    )


# ──────────────────────────────────────────────────────────────────
# Strengths Radar
# ──────────────────────────────────────────────────────────────────


def _build_strengths_radar(courses: list[CourseItem]) -> list[RadarCategoryPoint]:
    """Build the Skills DNA Matrix — student competency vs. Vision 2030 demand.

    For every academic category with GPA-bearing completed courses we
    emit a point on BOTH polygons of the dashboard's dual-radar:

      student_competency = Σ(gradePoints × credits) / Σ(credits)   ← weighted mean
      market_demand      = MARKET_DEMAND_VISION2030[category]
      skill_gap          = market_demand − student_competency

    Why credit-weighted student_competency? A student with an A in a
    4-credit MATH course and a C in a 1-credit lab shouldn't appear
    average — the bulk of their effort was at A level. Weighting by
    credits matches how their cumulative GPA is actually computed and
    keeps the two axes (this and `market_demand`, both 0-4) directly
    comparable.

    Categories with no GPA-bearing courses are omitted so the radar
    never renders meaningless zero spokes.
    """
    # Per-category aggregate accumulators + a parallel list of the raw
    # courses that fed each bucket — the latter is shipped to the
    # frontend so the Radar dialog can drill down to actual transcript
    # rows without a second round-trip.
    buckets: dict[str, dict[str, float | int]] = {}
    bucket_courses: dict[str, list[RadarCourseRef]] = {}
    for c in courses:
        if not _is_gpa_bearing(c):
            continue
        # Pass both code AND name so the CS-specific dispatcher can
        # disambiguate generic codes (e.g., "CS4216 ذكاء اصطناعي" routes
        # to AI/Data even though the code prefix alone would land in
        # programming fundamentals).
        category = _categorize_course(c.code, c.name)
        b = buckets.setdefault(category, {"points": 0.0, "hours": 0, "count": 0})
        contribution = (c.gradePoints or 0.0) * c.credits
        b["points"] = float(b["points"]) + contribution
        b["hours"] = int(b["hours"]) + c.credits
        b["count"] = int(b["count"]) + 1
        bucket_courses.setdefault(category, []).append(
            RadarCourseRef(
                # Prefer the Arabic title for the dialog row; fall back
                # to the code when the frontend hasn't sent a name (older
                # client builds, or rows where the parser lost the title).
                code=c.code,
                name=c.name or c.code,
                grade=c.grade,
                gradePoints=c.gradePoints,
                credits=c.credits,
                semester=c.semester,
                contribution=round(contribution, 2),
            )
        )

    out: list[RadarCategoryPoint] = []
    for category, b in buckets.items():
        hours = int(b["hours"])
        if hours <= 0:
            continue
        competency = round(float(b["points"]) / hours, 2)
        demand = MARKET_DEMAND_VISION2030.get(category, MARKET_DEMAND_VISION2030[_DEFAULT_CATEGORY])
        # Sort courses within each category by descending quality-point
        # contribution so the dialog leads with what mattered most.
        # Stable tiebreaker by code keeps the order deterministic.
        cat_courses = sorted(
            bucket_courses.get(category, []),
            key=lambda rc: (-rc.contribution, rc.code),
        )
        out.append(
            RadarCategoryPoint(
                category=category,
                student_competency=competency,
                market_demand=demand,
                skill_gap=round(demand - competency, 2),
                course_count=int(b["count"]),
                credit_hours=hours,
                # Sprint-3 reliability flag: only true once the sample
                # size justifies a competency claim. The frontend uses
                # this to dim low-confidence spokes and to exclude them
                # from the "biggest gap" callout.
                is_reliable=hours >= _RELIABLE_CATEGORY_MIN_HOURS,
                courses=cat_courses,
            )
        )
    # Display order: biggest skill gap first so the radar "leans" toward
    # the weakest spoke. Ties broken by credit mass (more established
    # categories surface first within the same gap tier).
    out.sort(key=lambda r: (-r.skill_gap, -r.credit_hours))
    return out


# ──────────────────────────────────────────────────────────────────
# High-ROI Courses
# ──────────────────────────────────────────────────────────────────


def _compute_high_roi_courses(
    current_courses: list[CurrentCourseItem],
    *,
    current_gpa: float,
    earned_hours: int,
    top_n: int = 2,
) -> list[HighRoiCourse]:
    """Rank in-progress courses by their potential lift on the cumulative GPA.

    Primary sort key: `max_point_contribution = credits × 4.0` — the
    maximum quality points the course can add to the transcript (UQU
    4.00 ceiling).

    We ALSO compute `projected_delta`: the actual jump in cumulative GPA
    if the student aces the course (scores 4.0), given their CURRENT
    earned hours and GPA. Same credits don't always mean same leverage —
    a 4-credit course matters more for a student with 30 earned hours
    than for one with 130.

    Returns top `top_n` courses; courses with zero credits are dropped.
    """
    if not current_courses:
        return []

    current_points = current_gpa * earned_hours

    ranked: list[HighRoiCourse] = []
    for c in current_courses:
        if c.credits <= 0:
            continue
        max_contribution = round(c.credits * 4.0, 2)
        # Projected GPA if this course scores 4.0:
        #   new_gpa = (current_points + credits * 4.0) / (earned_hours + credits)
        new_hours = earned_hours + c.credits
        if new_hours <= 0:
            projected_delta = 0.0
        else:
            new_gpa = (current_points + c.credits * 4.0) / new_hours
            projected_delta = max(0.0, new_gpa - current_gpa)

        # Label hints why this is a leverage course — uses Arabic so the
        # frontend can render it verbatim without translation.
        if c.credits >= 4:
            label = f"مادة ثقيلة ({c.credits} ساعات) — أكبر تأثير ممكن على المعدل."
        elif projected_delta >= 0.10:
            label = f"رفعة محتملة +{projected_delta:.2f} على معدلك التراكمي."
        else:
            label = f"تأثير معتدل (+{projected_delta:.2f}) — الإتقان مهم لكنه ليس حاسماً."

        ranked.append(
            HighRoiCourse(
                code=c.code,
                name=c.name or c.code,
                credits=c.credits,
                max_point_contribution=max_contribution,
                projected_delta=round(projected_delta, 3),
                label=label,
            )
        )

    # Sort: bigger max contribution first, then bigger projected delta
    # as a tiebreaker (same credits → the student with fewer earned
    # hours sees the bigger delta first).
    ranked.sort(key=lambda r: (-r.max_point_contribution, -r.projected_delta))
    return ranked[:top_n]


# ──────────────────────────────────────────────────────────────────
# Agentic Self-Healing — banner + auto-scheduled recovery sessions
# ──────────────────────────────────────────────────────────────────
# Arabic weekday names matching the rest of the app (plan store /
# pomodoro store / chat client-actions). Index 0 = Sunday so that
# datetime.weekday() conversions below stay readable.
_AR_DAYS = ("الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت")


def _ar_day_for_date(d: _date) -> str:
    """`date.weekday()` is Mon=0..Sun=6; map to our Sun=0..Sat=6 order."""
    # Python: Mon=0 Tue=1 Wed=2 Thu=3 Fri=4 Sat=5 Sun=6
    # We want:    Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6
    return _AR_DAYS[(d.weekday() + 1) % 7]


def _next_three_school_days(start: _date | None = None) -> list[_date]:
    """Return the next 3 calendar days starting tomorrow, skipping Fridays
    (the conventional Saudi weekend day; Saturday is a school day at UQU).
    Pure helper — no side effects.
    """
    cursor = (start or _date.today()) + timedelta(days=1)
    out: list[_date] = []
    while len(out) < 3:
        # weekday() == 4 → Friday on Python's Mon=0 calendar.
        if cursor.weekday() != 4:
            out.append(cursor)
        cursor += timedelta(days=1)
    return out


def _weakest_completed_courses(
    completed: list[CourseItem],
    *,
    top_n: int = 3,
) -> list[CourseItem]:
    """Return the `top_n` completed courses with the lowest gradePoints —
    these are the recovery targets when the student's overall GPA is low.
    """
    scored = [
        c
        for c in completed
        if c.gradePoints is not None and c.credits > 0 and c.code
    ]
    scored.sort(key=lambda c: (c.gradePoints or 0.0, -c.credits))
    return scored[:top_n]


def _build_intervention_tasks(
    *,
    trigger: str,
    weakest: list[CourseItem],
    weakest_radar_category: str | None,
    current_courses: list[CurrentCourseItem],
) -> list[InterventionTask]:
    """Build exactly 3 recovery pomodoro sessions spread across the next
    3 school days at 20:00 (a reasonable default for the energy peak
    when we don't have access to the student's preferences here).

    Targeting rule:
      • low_gpa  → cycle through the student's weakest completed
                   courses (retake / reinforcement focus).
      • skill_gap → target current-term courses whose category matches
                   the weakest radar spoke (or the first current course
                   if no match exists).
      • combined → blend: pull weakest historical first, then current.
    """
    days = _next_three_school_days()

    # Pick targets — a list of (code, name) tuples of length up to 3.
    targets: list[tuple[str, str]] = []

    if trigger in ("low_gpa", "combined") and weakest:
        for c in weakest[:3]:
            targets.append((c.code, c.code))  # historical courses lack Arabic name in the wire
    if trigger in ("skill_gap", "combined") and weakest_radar_category:
        matched = [
            c for c in current_courses
            if _categorize_course(c.code, c.name) == weakest_radar_category
        ]
        for c in matched[:3]:
            targets.append((c.code, c.name or c.code))

    # Fallbacks so we always emit 3 tasks (the banner copy commits to "3").
    if not targets and current_courses:
        for c in current_courses[:3]:
            targets.append((c.code, c.name or c.code))
    if not targets:
        targets = [("", "مراجعة عامة")] * 3
    while len(targets) < 3:
        # Repeat the first target rather than synthesize a fake one — the
        # frontend's title dedup will still display them as distinct slots.
        targets.append(targets[0])
    targets = targets[:3]

    reason_by_trigger = {
        "low_gpa": "جلسة استدراك للمواد الأضعف في سجلك",
        "skill_gap": "جلسة لردم الفجوة بين مهاراتك وسوق العمل (رؤية 2030)",
        "combined": "جلسة استدراك مزدوجة — رفع الأداء وردم فجوة المهارات",
    }
    reason = reason_by_trigger.get(trigger, "جلسة استدراك ذكية")

    tasks: list[InterventionTask] = []
    for (code, name), d in zip(targets, days):
        tasks.append(
            InterventionTask(
                title=f"جلسة استرجاع نشط — {name}",
                courseCode=code,
                courseName=name,
                durationMinutes=25,
                suggestedDay=_ar_day_for_date(d),
                suggestedTime="20:00",
                priority="high",
                reason=reason,
            )
        )
    return tasks


def _intervention_id(
    *,
    trigger: str,
    severity: str,
    weakest_codes: tuple[str, ...],
    weakest_category: str | None,
) -> str:
    """Deterministic hash so the frontend can skip re-dispatching the
    same intervention on every dashboard refresh.

    Keyed on the situation (trigger + severity + the specific courses /
    category being remediated) — NOT on the student id or wall-clock
    time, so two visits five minutes apart produce the same id and the
    second one is a no-op.
    """
    raw = "|".join((trigger, severity, weakest_category or "", *weakest_codes))
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    return f"intv_{digest}"


def _maybe_emit_agentic_action(
    *,
    current_gpa: float,
    completed_courses: list[CourseItem],
    current_courses: list[CurrentCourseItem],
    radar: list[RadarCategoryPoint],
) -> AgenticAction:
    """Decide whether to surface the dashboard self-healing banner.

    Triggers (any one of these activates the action):
      • current_gpa < _LOW_GPA_THRESHOLD              → "low_gpa"
      • max skill_gap in radar > _SKILL_GAP_SEVERE    → "skill_gap"
      • both                                          → "combined"

    Returns an `active=False` placeholder when none fire — the frontend
    treats that as "render nothing", so the dashboard stays clean for
    students who don't need an intervention.
    """
    low_gpa = current_gpa > 0 and current_gpa < _LOW_GPA_THRESHOLD
    # Sprint-3: ignore unreliable categories (< 9 credits) when picking the
    # gap to intervene on. We don't want to fire a "severe skill gap"
    # alert based on a 2-credit elective the student took once.
    reliable_radar = [r for r in radar if r.is_reliable]
    max_gap_point = max(reliable_radar, key=lambda r: r.skill_gap) if reliable_radar else None
    severe_gap = bool(max_gap_point and max_gap_point.skill_gap >= _SKILL_GAP_SEVERE)

    if not (low_gpa or severe_gap):
        return AgenticAction(active=False)

    trigger = "combined" if (low_gpa and severe_gap) else ("low_gpa" if low_gpa else "skill_gap")
    severity = "high" if (low_gpa and current_gpa < 2.0) or (max_gap_point and max_gap_point.skill_gap >= 1.5) else "medium"

    weakest = _weakest_completed_courses(completed_courses, top_n=3)
    weakest_category = max_gap_point.category if (max_gap_point and severe_gap) else None

    tasks = _build_intervention_tasks(
        trigger=trigger,
        weakest=weakest,
        weakest_radar_category=weakest_category,
        current_courses=current_courses,
    )

    iid = _intervention_id(
        trigger=trigger,
        severity=severity,
        weakest_codes=tuple(c.code for c in weakest),
        weakest_category=weakest_category,
    )

    # Compose the banner copy — Arabic, past-tense to mirror the spec
    # ("the AI has automatically scheduled..."). The frontend dispatcher
    # makes that promise true by inserting `scheduled_tasks` into the
    # plan store on first render of this `intervention_id`.
    if trigger == "low_gpa":
        headline = "حلقة التعافي الذكي نشطة"
        body = (
            f"لاحظنا انخفاضاً في مرونتك الأكاديمية (المعدل {current_gpa:.2f} / 4.00). "
            "قام الذكاء الاصطناعي تلقائياً بجدولة 3 جلسات بومودورو استدراكية "
            "في خطتك لهذا الأسبوع لردم الفجوة."
        )
    elif trigger == "skill_gap" and max_gap_point:
        headline = "تنبيه فجوة المهارات (رؤية 2030)"
        body = (
            f"في مجال «{max_gap_point.category}» معدلك {max_gap_point.student_competency:.2f} "
            f"بينما يتطلب سوق العمل {max_gap_point.market_demand:.2f}. "
            "قام الذكاء الاصطناعي تلقائياً بجدولة 3 جلسات بومودورو لردم الفجوة هذا الأسبوع."
        )
    else:  # combined
        gap_phrase = ""
        if max_gap_point:
            gap_phrase = f" بالإضافة إلى فجوة في «{max_gap_point.category}» مقارنة بسوق العمل،"
        headline = "تدخّل ذكي مزدوج — تعافٍ ورفع مهارات"
        body = (
            f"معدلك {current_gpa:.2f} / 4.00 يحتاج عناية،{gap_phrase} "
            "قام الذكاء الاصطناعي تلقائياً بجدولة 3 جلسات بومودورو هذا الأسبوع "
            "لإعادة التوازن لأدائك ومسارك المهني."
        )

    # Build the AI Decision Log surfaced inside the intervention dialog.
    # The frontend renders one row per entry, color-coded by severity,
    # so the user can SEE which signals fired. We don't try to be
    # exhaustive — only the signals that actually drove the decision.
    reasoning: list[DecisionLogEntry] = []
    if low_gpa:
        reasoning.append(
            DecisionLogEntry(
                fact=f"current_gpa = {current_gpa:.2f} < threshold {_LOW_GPA_THRESHOLD:.2f}",
                interpretation=(
                    f"معدلك التراكمي {current_gpa:.2f} أقل من حد التعافي "
                    f"{_LOW_GPA_THRESHOLD:.2f}، فعّل النظام حلقة الاستدراك تلقائياً."
                ),
                severity="alert" if current_gpa < 2.0 else "warn",
            )
        )
    if severe_gap and max_gap_point:
        reasoning.append(
            DecisionLogEntry(
                fact=(
                    f"max_skill_gap = {max_gap_point.skill_gap:.2f} "
                    f"(category='{max_gap_point.category}') > {_SKILL_GAP_SEVERE:.2f}"
                ),
                interpretation=(
                    f"الفارق بين كفاءتك ({max_gap_point.student_competency:.2f}) "
                    f"وما يتطلبه سوق العمل ({max_gap_point.market_demand:.2f}) "
                    f"في «{max_gap_point.category}» تجاوز عتبة التدخل."
                ),
                severity="alert" if max_gap_point.skill_gap >= 1.5 else "warn",
            )
        )
    # Always include the action summary as the final "what we did" row
    # so the log is self-contained.
    reasoning.append(
        DecisionLogEntry(
            fact=(
                f"scheduled_pomodoro_sessions = {len(tasks)} "
                f"(target_minutes = {sum(t.durationMinutes for t in tasks)})"
            ),
            interpretation=(
                f"تمت جدولة {len(tasks)} جلسات بومودورو استدراكية "
                f"بإجمالي {sum(t.durationMinutes for t in tasks)} دقيقة على مدى الأيام الثلاثة القادمة."
            ),
            severity="info",
        )
    )

    return AgenticAction(
        active=True,
        intervention_id=iid,
        trigger=trigger,            # type: ignore[arg-type]
        severity=severity,          # type: ignore[arg-type]
        headline=headline,
        body=body,
        scheduled_tasks=tasks,
        reasoning=reasoning,
    )


# ──────────────────────────────────────────────────────────────────
# GPA trend insight (Sprint-4 Task 4 / Bug #8)
# ──────────────────────────────────────────────────────────────────


def _analyze_gpa_trend(series: list[ChartPoint]) -> str:
    """One-sentence narrative summarising the variance of per-semester GPAs.

    Operates on the already-computed `chart_data` series (each entry
    carries `term_gpa`) so we don't re-aggregate. Thresholds:

      • range > 0.5  → "high volatility" message
      • range ≤ 0.5  → "steady" message
      • fewer than 2 semesters → empty string (no signal to summarise)

    The frontend renders the result inside a glass insight box beneath
    the cumulative-GPA chart. An empty string suppresses the box.
    """
    term_gpas = [round(p.term_gpa, 3) for p in series if p.term_gpa > 0]
    if len(term_gpas) < 2:
        return ""
    spread = max(term_gpas) - min(term_gpas)
    if spread > 0.5:
        return (
            "نلاحظ تذبذباً عالياً في أدائك الفصلي؛ استقرارك في الفصول "
            "القادمة هو مفتاح رفع المعدل."
        )
    return "أداؤك الفصلي يتسم بالاستقرار، استمر على هذا النسق."
