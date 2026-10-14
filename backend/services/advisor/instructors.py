"""Instructor evidence: replaceable providers + cautious aggregation.

Providers
  • VerifiedStudentProvider — reviews written in Faten by students whose own
    academic record contains the course (same verification as course reviews).
  • QaymProvider — placeholder that reports why it is not used (see docs):
    no public API or data-use permission was found, and on 2026-10-14 the
    site's origin did not respond (Cloudflare 522). It returns no data.
  • StaticProvider — for an authorised dataset (and for tests).

Aggregation never turns a handful of ratings into a verdict:
  • recency weighting (half-life two years),
  • Bayesian shrinkage toward the course-wide mean (prior weight 5 reviews),
  • disagreement detection (spread of overall scores),
  • a recommendation only when ≥2 instructors each have enough evidence
    and the gap between them is larger than the noise.
Popularity is not quality and no rating predicts a grade; the output says so.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
import statistics
from typing import Protocol

from pydantic import BaseModel, Field

RATING_FIELDS = ("clarity", "organization", "fairness", "workload")  # workload: 1 light … 5 heavy (not quality)
QUALITY_FIELDS = ("clarity", "organization", "fairness")
PRIOR_WEIGHT = 5.0
HALF_LIFE_YEARS = 2.0
MIN_FOR_ANY_SIGNAL = 3
MIN_FOR_COMPARISON = 5
MIN_GAP = 0.4
DISAGREEMENT_STD = 1.2

_TITLES = re.compile(r"^(د\.?|دكتور|الدكتور|أ\.?د\.?|أ\.|الأستاذ|أستاذ|م\.|Dr\.?|Prof\.?)\s*", re.IGNORECASE)


def normalize_instructor(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "").strip())
    prev = None
    while prev != n:
        prev, n = n, _TITLES.sub("", n).strip()
    return n


def instructor_key(name: str) -> str:
    return hashlib.sha256(normalize_instructor(name).lower().encode()).hexdigest()[:16]


class InstructorReview(BaseModel):
    instructor: str
    course_code: str
    ratings: dict[str, int]
    recommend: bool | None = None
    term: str = ""
    created_at: str  # ISO date
    source: str
    verified: bool


class ProviderStatus(BaseModel):
    name: str
    available: bool
    reason: str
    data_policy: str = ""


class InstructorEvidenceProvider(Protocol):
    def status(self) -> ProviderStatus: ...
    def reviews(self, course_code: str) -> list[InstructorReview]: ...


class QaymProvider:
    def status(self) -> ProviderStatus:
        return ProviderStatus(
            name="qaym", available=False,
            reason=("لم نجد واجهة برمجية عامة أو إذناً باستخدام بيانات موقع «قيم»، وتعذّر الوصول لخادمه عند الفحص "
                    "(2026-10-14، خطأ 522). لا نجمع بياناته آلياً دون إذن."),
            data_policy="يُفعَّل فقط عبر اتفاقية بيانات أو مجموعة بيانات مرخّصة.",
        )

    def reviews(self, course_code: str) -> list[InstructorReview]:
        return []


class StaticProvider:
    def __init__(self, name: str, rows: list[InstructorReview]):
        self._name, self._rows = name, rows

    def status(self) -> ProviderStatus:
        return ProviderStatus(name=self._name, available=True, reason="مجموعة بيانات مرخّصة")

    def reviews(self, course_code: str) -> list[InstructorReview]:
        return [r for r in self._rows if r.course_code == course_code]


class VerifiedStudentProvider:
    """Firestore: instructor_reviews/{CODE}/reviews/{sha(uid:code:instructor)} — server-only."""

    def __init__(self, db):
        self._db = db

    def status(self) -> ProviderStatus:
        return ProviderStatus(name="faten_verified_students", available=True,
                              reason="تقييمات طلاب فطن الذين يظهر المقرر في سجلهم الأكاديمي.")

    def reviews(self, course_code: str) -> list[InstructorReview]:
        out = []
        col = self._db.collection("instructor_reviews").document(course_code).collection("reviews")
        for snap in col.stream():
            d = snap.to_dict() or {}
            if d.get("hidden"):
                continue
            try:
                out.append(InstructorReview(
                    instructor=d.get("instructor", ""), course_code=course_code,
                    ratings={f: int(d[f]) for f in RATING_FIELDS if f in d}, recommend=d.get("recommend"),
                    term=d.get("term", ""), created_at=str(d.get("updatedAt") or d.get("createdAt") or "")[:10],
                    source="faten_verified_students", verified=True,
                ))
            except (TypeError, ValueError):
                continue
        return out


class InstructorSummary(BaseModel):
    instructor: str
    reviews: int
    effective_reviews: float
    quality_raw: float | None
    quality_adjusted: float | None
    workload: float | None
    recommend_pct: int | None
    disagreement: bool
    latest: str | None
    confidence: str  # insufficient | low | medium | high
    notes: list[str] = Field(default_factory=list)


def _age_years(date_str: str, today: dt.date) -> float:
    try:
        d = dt.date.fromisoformat(date_str[:10])
    except ValueError:
        return 5.0
    return max(0.0, (today - d).days / 365.25)


def summarize(reviews: list[InstructorReview], today: dt.date | None = None) -> dict:
    today = today or dt.date.today()
    usable = [r for r in reviews if r.verified and all(f in r.ratings for f in QUALITY_FIELDS)]
    by: dict[str, list[InstructorReview]] = {}
    for r in usable:
        by.setdefault(normalize_instructor(r.instructor), []).append(r)

    def overall(r: InstructorReview) -> float:
        return sum(r.ratings[f] for f in QUALITY_FIELDS) / len(QUALITY_FIELDS)

    prior = statistics.fmean(overall(r) for r in usable) if usable else 3.0
    summaries: list[InstructorSummary] = []
    for name, rs in sorted(by.items()):
        weights = [0.5 ** (_age_years(r.created_at, today) / HALF_LIFE_YEARS) for r in rs]
        eff = sum(weights)
        scores = [overall(r) for r in rs]
        raw = sum(w * s for w, s in zip(weights, scores)) / eff if eff else None
        adjusted = (eff * raw + PRIOR_WEIGHT * prior) / (eff + PRIOR_WEIGHT) if raw is not None else None
        spread = statistics.pstdev(scores) if len(scores) >= 2 else 0.0
        wl = [r.ratings["workload"] for r in rs if "workload" in r.ratings]
        rec = [r.recommend for r in rs if r.recommend is not None]
        n = len(rs)
        if n < MIN_FOR_ANY_SIGNAL:
            conf = "insufficient"
        elif n < MIN_FOR_COMPARISON or eff < MIN_FOR_ANY_SIGNAL:
            conf = "low"
        elif n < 15 or eff < 10:
            conf = "medium"
        else:
            conf = "high"
        notes = []
        disagreement = spread >= DISAGREEMENT_STD and n >= 3
        if disagreement:
            notes.append("آراء الطلاب متباينة بشدة حول هذا المحاضر.")
            conf = {"high": "medium", "medium": "low"}.get(conf, conf)
        latest = max((r.created_at for r in rs), default=None)
        if latest and _age_years(latest, today) > 3:
            notes.append("أحدث تقييم أقدم من ثلاث سنوات.")
            conf = {"high": "medium", "medium": "low"}.get(conf, conf)
        summaries.append(InstructorSummary(
            instructor=name, reviews=n, effective_reviews=round(eff, 1),
            quality_raw=round(raw, 2) if raw is not None else None,
            quality_adjusted=round(adjusted, 2) if adjusted is not None else None,
            workload=round(statistics.fmean(wl), 1) if wl else None,
            recommend_pct=round(100 * sum(rec) / len(rec)) if rec else None,
            disagreement=disagreement, latest=latest, confidence=conf, notes=notes,
        ))

    comparable = sorted((s for s in summaries if s.confidence in ("medium", "high")),
                        key=lambda s: -(s.quality_adjusted or 0))
    recommendation = None
    if len(comparable) >= 2:
        gap = (comparable[0].quality_adjusted or 0) - (comparable[1].quality_adjusted or 0)
        if gap >= MIN_GAP:
            recommendation = {
                "instructor": comparable[0].instructor, "gap": round(gap, 2),
                "confidence": "medium" if "medium" in (comparable[0].confidence, comparable[1].confidence) else "high",
                "basis": f"تقييم معدَّل {comparable[0].quality_adjusted} مقابل {comparable[1].quality_adjusted} مع عدد كافٍ من التقييمات.",
            }
    if recommendation:
        verdict = "recommend"
        message = f"الأدلة المتاحة تميل إلى {recommendation['instructor']} في الوضوح والتنظيم وعدالة التقييم."
    elif not summaries:
        verdict = "no_data"
        message = "لا توجد تقييمات موثقة لمحاضري هذا المقرر بعد؛ لا نرشّح أحداً."
    elif len(comparable) < 2:
        verdict = "insufficient"
        message = "التقييمات قليلة أو متباينة؛ لا تكفي للمفاضلة بين المحاضرين، فلا نرشّح أحداً."
    else:
        verdict = "no_clear_difference"
        message = "الفرق بين المحاضرين ضمن هامش التذبذب؛ لا يوجد خيار أفضل بوضوح."
    return {
        "verdict": verdict, "message": message, "recommendation": recommendation,
        "instructors": [s.model_dump() for s in summaries], "course_mean": round(prior, 2) if usable else None,
        "method": {"prior_weight": PRIOR_WEIGHT, "half_life_years": HALF_LIFE_YEARS, "min_reviews_to_compare": MIN_FOR_COMPARISON,
                   "min_gap": MIN_GAP},
        "caveats": [
            "التقييم يعكس تجربة من كتبوا فقط (انحياز الاختيار).",
            "شعبية المحاضر ليست مقياساً لجودة التدريس، ولا يضمن أي محاضر درجة معينة.",
        ],
    }


def evidence_for_course(course_code: str, providers: list[InstructorEvidenceProvider], today: dt.date | None = None) -> dict:
    rows, statuses = [], []
    for p in providers:
        st = p.status()
        statuses.append(st.model_dump())
        if st.available:
            rows.extend(p.reviews(course_code))
    out = summarize(rows, today)
    out["course_code"] = course_code
    out["providers"] = statuses
    return out


def validate_review_payload(payload: dict) -> dict:
    """Ratings 1–5 for every field; instructor name required. Raises ValueError (Arabic)."""
    name = normalize_instructor(str(payload.get("instructor") or ""))
    if not (3 <= len(name) <= 80):
        raise ValueError("اكتب اسم المحاضر (3 أحرف على الأقل).")
    out = {"instructor": name}
    for f in RATING_FIELDS:
        v = payload.get(f)
        if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 5:
            raise ValueError("كل تقييم يجب أن يكون رقماً من 1 إلى 5.")
        out[f] = v
    out["recommend"] = bool(payload.get("recommend"))
    out["term"] = re.sub(r"[^\w\s؀-ۿ/-]", "", str(payload.get("term", "")))[:40]
    return out


def review_doc_id(uid: str, code: str, instructor: str) -> str:
    return hashlib.sha256(f"{uid}:{code}:{instructor_key(instructor)}".encode()).hexdigest()[:20]


__all__ = [
    "InstructorReview", "QaymProvider", "StaticProvider", "VerifiedStudentProvider", "evidence_for_course",
    "summarize", "validate_review_payload", "review_doc_id", "normalize_instructor",
]
