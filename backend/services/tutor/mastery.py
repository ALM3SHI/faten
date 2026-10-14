"""
Mastery from evidence — explainable rules, no model in the loop.

Every graded answer becomes one `evidence` item:
    {qid, kind, correct, credit, difficulty, bloom, concept_ids, hints,
     misconception, ts}

  kind        check (during the lesson) · quiz (topic mastery quiz)
              · review (spaced review) · final (end-of-lecture exam)
  credit      0..1 — a correct answer after a hint earns less than one without
  difficulty  1 easy · 2 medium · 3 hard
  bloom       remember · understand · apply · analyze

Two separate numbers come out of it:

  score       how well the student answers (weighted accuracy, recent answers
              weigh more)
  confidence  how much evidence that score rests on (amount + variety)

A topic counts as *mastered* only when ALL rules hold (see `assess`):
  1. score ≥ 0.80
  2. at least 3 graded answers outside the lesson checks
  3. at least one correct application/analysis answer without a hint
  4. at least one correct answer of medium or hard difficulty
  5. confidence ≥ 0.60
  6. the latest assessed answers are not two misses in a row

so one easy quiz, or watching the lesson, or finishing flashcards, can never
mark a topic as mastered. Each failed rule is reported in Arabic so the
student (and the tutor) can see *why*.

Points (XP) for motivation are computed separately and never feed mastery.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Iterable

KIND_WEIGHT = {"check": 0.6, "quiz": 1.0, "review": 1.0, "final": 1.2}
DIFF_WEIGHT = {1: 0.8, 2: 1.0, 3: 1.3}
HIGHER_ORDER = {"apply", "analyze"}
RECENCY = 0.8  # each newer answer on the same topic multiplies older weights by this,
# so a student who struggled, was re-taught and then answers new questions
# correctly can recover — old mistakes fade instead of counting forever.
MAX_EVIDENCE = 60

MASTERY_SCORE = 0.80
MASTERY_CONFIDENCE = 0.60
MIN_ASSESSED = 3
CONFIDENCE_FULL_AT = 4.0  # effective weight at which confidence reaches 1

# Spaced review after mastery (days) — same ladder as the flashcards.
REVIEW_INTERVALS = [1, 3, 7, 14, 30]

STATUSES = ("not_started", "in_progress", "needs_review", "review_due", "mastered")

STATUS_AR = {
    "not_started": "لم يبدأ",
    "in_progress": "قيد الدراسة",
    "needs_review": "يحتاج إلى مراجعة",
    "review_due": "حان وقت مراجعته",
    "mastered": "متقن",
}

BLOOM_AR = {"remember": "تذكّر", "understand": "فهم", "apply": "تطبيق", "analyze": "تحليل"}


def _diff(e: dict) -> int:
    try:
        return min(3, max(1, int(e.get("difficulty") or 2)))
    except (TypeError, ValueError):
        return 2


def _weights(evidence: list[dict]) -> list[float]:
    n = len(evidence)
    out = []
    for i, e in enumerate(evidence):
        w = KIND_WEIGHT.get(e.get("kind"), 1.0) * DIFF_WEIGHT[_diff(e)]
        out.append(w * (RECENCY ** (n - 1 - i)))
    return out


def score_of(evidence: list[dict]) -> float | None:
    """Weighted accuracy in 0..1, or None without evidence."""
    if not evidence:
        return None
    ws = _weights(evidence)
    total = sum(ws)
    got = sum(w * float(e.get("credit", 1.0 if e.get("correct") else 0.0)) for w, e in zip(ws, evidence))
    return round(got / total, 3) if total else None


def confidence_of(evidence: list[dict]) -> float:
    """How much the score can be trusted: amount of evidence and its variety."""
    eff = sum(KIND_WEIGHT.get(e.get("kind"), 1.0) * DIFF_WEIGHT[_diff(e)] for e in evidence)
    conf = min(1.0, eff / CONFIDENCE_FULL_AT)
    blooms = {e.get("bloom") for e in evidence}
    if not blooms & HIGHER_ORDER:
        conf = min(conf, 0.5)  # recognition only — we have not seen them use it
    if len(blooms) < 2:
        conf = min(conf, 0.5)
    return round(conf, 3)


def assess(evidence: list[dict]) -> dict[str, Any]:
    """Score, confidence, mastered?, and the reasons in Arabic."""
    score = score_of(evidence)
    conf = confidence_of(evidence)
    assessed = [e for e in evidence if e.get("kind") != "check"]
    reasons_missing: list[str] = []
    reasons_met: list[str] = []

    if score is None or score < MASTERY_SCORE:
        reasons_missing.append(f"نسبة الإجابات الصحيحة الموزونة {pct(score)} وتحتاج 80% على الأقل")
    else:
        reasons_met.append(f"نسبة الإجابات الصحيحة الموزونة {pct(score)}")
    if len(assessed) < MIN_ASSESSED:
        reasons_missing.append(f"أجبت {len(assessed)} من {MIN_ASSESSED} أسئلة تقييم على الأقل خارج أسئلة الشرح")
    else:
        reasons_met.append(f"{len(assessed)} أسئلة تقييم")
    # "Real" correct answers: not a self-declared guess.
    solid = [e for e in assessed if e.get("correct") and e.get("confidence") != "guess"]
    if not any(e.get("bloom") in HIGHER_ORDER and not e.get("hints") for e in solid):
        reasons_missing.append("لم تُجب بعد إجابة صحيحة (غير تخمين) على سؤال تطبيق أو تحليل دون تلميح")
    else:
        reasons_met.append("نجحت في سؤال تطبيقي دون تلميح")
    if not any(_diff(e) >= 2 for e in solid):
        reasons_missing.append("لم تنجح بعد في سؤال متوسط أو صعب")
    # Transfer: the same understanding shown in two different forms of question
    # (e.g. predict the output AND find the bug), not one pattern learned.
    skills = {e.get("skill") for e in solid if e.get("skill")}
    if len(skills) < 2:
        reasons_missing.append("نجحت في نوع واحد فقط من الأسئلة — نحتاج نفس الفهم بصيغة ثانية")
    else:
        reasons_met.append(f"نجحت في {len(skills)} أنواع مختلفة من الأسئلة")
    if conf < MASTERY_CONFIDENCE:
        reasons_missing.append("الأدلة ما زالت قليلة أو متشابهة للحكم بثقة")
    last_two = assessed[-2:]
    if len(last_two) == 2 and not any(e.get("correct") for e in last_two):
        reasons_missing.append("آخر إجابتين في التقييم كانتا خاطئتين")

    return {
        "score": score,
        "confidence": conf,
        "assessed": len(assessed),
        "mastered": not reasons_missing,
        "missing": reasons_missing,
        "met": reasons_met,
        "level": level_of(score),
    }


def calibration(evidence: list[dict]) -> dict[str, Any]:
    """How well the student's confidence matches their answers.

    confident_errors   wrong while "sure" — the misconceptions worth fixing first
    lucky_guesses      right while "guessing" — not yet evidence of knowledge
    """
    rows = {c: [0, 0] for c in ("sure", "think", "guess")}
    for e in evidence:
        c = e.get("confidence")
        if c in rows:
            rows[c][0] += 1
            rows[c][1] += 1 if e.get("correct") else 0
    return {
        "by_level": {c: {"answers": n, "correct": k} for c, (n, k) in rows.items() if n},
        "confident_errors": rows["sure"][0] - rows["sure"][1],
        "lucky_guesses": rows["guess"][1],
    }


def level_of(score: float | None) -> str:
    if score is None:
        return "unknown"
    if score >= MASTERY_SCORE:
        return "strong"
    if score >= 0.5:
        return "developing"
    return "weak"


def pct(x: float | None) -> str:
    return "—" if x is None else f"{round(x * 100)}%"


def concept_breakdown(evidence: list[dict]) -> dict[str, dict]:
    """Per concept: attempts, correct, score."""
    by: dict[str, list[dict]] = {}
    for e in evidence:
        for c in e.get("concept_ids") or []:
            by.setdefault(c, []).append(e)
    return {
        c: {
            "attempts": len(items),
            "correct": sum(1 for e in items if e.get("correct")),
            "score": score_of(items),
        }
        for c, items in by.items()
    }


def weak_concepts(evidence: list[dict], threshold: float = 0.6) -> list[str]:
    """Concepts with at least one miss and a score under `threshold`, weakest first."""
    rows = [
        (v["score"] if v["score"] is not None else 0.0, c)
        for c, v in concept_breakdown(evidence).items()
        if v["attempts"] > v["correct"] and (v["score"] or 0.0) < threshold
    ]
    return [c for _, c in sorted(rows)]


def add_evidence(topic: dict, item: dict) -> dict:
    ev = list(topic.get("evidence") or [])
    ev.append(item)
    topic["evidence"] = ev[-MAX_EVIDENCE:]
    topic["attempts"] = int(topic.get("attempts") or 0) + 1
    if item.get("correct"):
        topic["correct"] = int(topic.get("correct") or 0) + 1
    else:
        topic["wrong"] = int(topic.get("wrong") or 0) + 1
    if item.get("misconception"):
        mc = dict(topic.get("misconceptions") or {})
        mc[item["misconception"]] = int(mc.get(item["misconception"], 0)) + 1
        topic["misconceptions"] = mc
    return topic


# ── Spaced review ──────────────────────────────────────────────────


def add_days(day: str, n: int) -> str:
    return (dt.date.fromisoformat(day) + dt.timedelta(days=n)).isoformat()


def schedule_after_review(topic: dict, correct: bool, today: str) -> dict:
    """Leitner step: right → longer wait, wrong → back to the first box."""
    box = int(topic.get("reviewBox") or 0)
    box = min(len(REVIEW_INTERVALS), box + 1) if correct else 1
    topic["reviewBox"] = box
    topic["reviewDue"] = add_days(today, REVIEW_INTERVALS[box - 1])
    topic["lastReviewedAt"] = today
    return topic


def start_review_schedule(topic: dict, today: str) -> dict:
    topic["reviewBox"] = 1
    topic["reviewDue"] = add_days(today, REVIEW_INTERVALS[0])
    topic["lastReviewedAt"] = today
    return topic


def status_of(topic: dict, today: str) -> str:
    """The single status a student sees for a topic."""
    if not topic or not (topic.get("visitedAt") or topic.get("evidence")):
        return "not_started"
    if not topic.get("closedAt"):
        return "in_progress"
    if not assess(topic.get("evidence") or [])["mastered"]:
        return "needs_review"
    due = topic.get("reviewDue")
    if due and due <= today:
        return "review_due"
    return "mastered"


def due_reviews(topics: dict[str, dict], today: str) -> list[str]:
    """Topic ids whose spaced review is due, most overdue first."""
    due = [(t.get("reviewDue") or "", tid) for tid, t in topics.items() if status_of(t, today) == "review_due"]
    return [tid for _, tid in sorted(due)]


# ── Points (motivation only — never used for mastery) ─────────────


def points_for(correct: bool, difficulty: int, hints: int, kind: str) -> int:
    if not correct:
        return 1 if kind != "final" else 0  # trying counts a little
    base = {1: 5, 2: 8, 3: 12}.get(difficulty, 8)
    return max(2, base - 3 * hints)


def lecture_summary(topic_ids: Iterable[str], topics: dict[str, dict], today: str) -> dict[str, Any]:
    counts = {s: 0 for s in STATUSES}
    for tid in topic_ids:
        counts[status_of(topics.get(tid) or {}, today)] += 1
    total = sum(counts.values()) or 1
    return {"counts": counts, "mastered_share": round(counts["mastered"] / total, 3)}
