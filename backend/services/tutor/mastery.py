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
import math
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


def add_evidence(topic: dict, item: dict, today: str | None = None) -> dict:
    """Keep one graded answer; with `today`, it also reviews the concepts it tests (FSRS)."""
    if today:
        review_concepts(topic, item, today)
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
    # its concepts' memory decides when, when we know it (FSRS, below)
    topic["reviewDue"] = _concept_review_day(topic, today) or add_days(today, REVIEW_INTERVALS[box - 1])
    topic["lastReviewedAt"] = today
    return topic


def start_review_schedule(topic: dict, today: str) -> dict:
    topic["reviewBox"] = 1
    topic["reviewDue"] = _concept_review_day(topic, today) or add_days(today, REVIEW_INTERVALS[0])
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


# ── Memory per concept: FSRS ───────────────────────────────────────
# FSRS (Free Spaced Repetition Scheduler, Ye et al. 2022; version 4.5 with its
# published default weights) models each concept's memory with two numbers:
#   stability S   days until recall probability falls to 90%
#   difficulty D  1..10, how hard this concept is for this student
# Every assessed answer (quiz, review, final — not the in-lesson checks) is a
# review of the concepts it tests. The next review of a concept is due when
# its recall would drop to DESIRED_RETENTION; a topic's review is due when its
# first concept is. Topics whose questions name no concepts keep the
# Leitner ladder above.

FSRS_W = (0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755)
FSRS_DECAY = -0.5
FSRS_FACTOR = 19 / 81  # with DECAY, R(S days) = 0.9
DESIRED_RETENTION = 0.9
MAX_INTERVAL = 180


def fsrs_grade(correct: bool, hints: int = 0, confidence: str | None = None, difficulty: int = 2) -> int:
    """1 again · 2 hard · 3 good · 4 easy — from what the answer shows."""
    if not correct:
        return 1
    if hints or confidence == "guess":
        return 2
    if confidence == "sure" and difficulty >= 3:
        return 4
    return 3


def _clamp_d(d: float) -> float:
    return min(10.0, max(1.0, d))


def retrievability(mem: dict, today: str) -> float:
    """Probability of recalling the concept today."""
    try:
        t = max(0, (dt.date.fromisoformat(today) - dt.date.fromisoformat(mem["last"])).days)
        return (1 + FSRS_FACTOR * t / float(mem["S"])) ** FSRS_DECAY
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return 1.0


def fsrs_review(mem: dict | None, grade: int, today: str) -> dict:
    """The concept's memory after one review on `today`."""
    w = FSRS_W
    g = min(4, max(1, int(grade)))
    if not mem or not mem.get("S"):
        s = w[g - 1]
        d = _clamp_d(w[4] - (g - 3) * w[5])
        reps, lapses = 1, 0 if g > 1 else 1
    else:
        s0, d0 = float(mem["S"]), float(mem["D"])
        r = retrievability(mem, today)
        d = _clamp_d(w[7] * w[4] + (1 - w[7]) * (d0 - w[6] * (g - 3)))
        if g == 1:
            s = w[11] * d0 ** (-w[12]) * ((s0 + 1) ** w[13] - 1) * math.exp(w[14] * (1 - r))
            s = min(s, s0)
        else:
            bonus = (w[15] if g == 2 else 1.0) * (w[16] if g == 4 else 1.0)
            s = s0 * (1 + math.exp(w[8]) * (11 - d0) * s0 ** (-w[9]) * (math.exp(w[10] * (1 - r)) - 1) * bonus)
        reps = int(mem.get("reps") or 0) + 1
        lapses = int(mem.get("lapses") or 0) + (1 if g == 1 else 0)
    interval = s / FSRS_FACTOR * (DESIRED_RETENTION ** (1 / FSRS_DECAY) - 1)
    days = int(min(MAX_INTERVAL, max(1, round(interval))))
    return {"S": round(s, 4), "D": round(d, 4), "last": today, "due": add_days(today, days), "reps": reps, "lapses": lapses}


def review_concepts(topic: dict, item: dict, today: str) -> None:
    """An assessed answer reviews each concept it tests."""
    if item.get("kind") == "check" or not item.get("concept_ids"):
        return
    grade = fsrs_grade(bool(item.get("correct")), int(item.get("hints") or 0), item.get("confidence"), int(item.get("difficulty") or 2))
    mems = dict(topic.get("concepts") or {})
    for cid in item["concept_ids"]:
        mems[cid] = fsrs_review(mems.get(cid), grade, today)
    topic["concepts"] = mems


def concepts_due(topic: dict, today: str) -> list[str]:
    """This topic's concepts due for review, least likely to be recalled first."""
    mems = topic.get("concepts") or {}
    due = [(retrievability(m, today), cid) for cid, m in mems.items() if (m.get("due") or "") <= today]
    return [cid for _, cid in sorted(due)]


def _concept_review_day(topic: dict, today: str) -> str | None:
    dues = [m.get("due") for m in (topic.get("concepts") or {}).values() if m.get("due")]
    return max(add_days(today, 1), min(dues)) if dues else None


def concept_states(topic: dict, concept_ids: list[str], today: str) -> dict[str, dict]:
    """What the student shows for each concept: level from the answers, and
    when its memory needs a review."""
    ev = [e for e in topic.get("evidence") or [] if e.get("kind") != "check"] or list(topic.get("evidence") or [])
    rows = concept_breakdown(ev)
    mems = topic.get("concepts") or {}
    out = {}
    for cid in concept_ids:
        row = rows.get(cid) or {}
        mem = mems.get(cid) or {}
        out[cid] = {
            "level": level_of(row.get("score")),
            "attempts": row.get("attempts", 0),
            "due": mem.get("due"),
            "recall": round(retrievability(mem, today), 2) if mem else None,
        }
    return out


# ── Question difficulty from answers: Elo ──────────────────────────
# A question's written difficulty (1-3) is the model's guess. Every first
# answer moves the question's rating b and the student's ability θ (per
# topic) the way chess ratings move: an expected answer changes little, a
# surprise changes more. Once a question has ELO_TRUSTED answers, its
# measured difficulty replaces the guess when questions are picked.

ELO_K_STUDENT = 0.4
ELO_K_ITEM = 0.3
ELO_TRUSTED = 5
_B_OF = {1: -0.8, 2: 0.0, 3: 0.8}


def elo_expected(theta: float, b: float) -> float:
    return 1 / (1 + math.exp(-(theta - b)))


def elo_update(theta: float, rating: dict | None, written_difficulty: int, correct: bool) -> tuple[float, dict]:
    b = float((rating or {}).get("b", _B_OF.get(int(written_difficulty or 2), 0.0)))
    n = int((rating or {}).get("n") or 0)
    p = elo_expected(theta, b)
    k_item = ELO_K_ITEM / (1 + n / 20)  # settles as answers add up
    hit = 1.0 if correct else 0.0
    return round(theta + ELO_K_STUDENT * (hit - p), 4), {"b": round(b - k_item * (hit - p), 4), "n": n + 1}


def measured_difficulty(rating: dict | None, written: int) -> int:
    if not rating or int(rating.get("n") or 0) < ELO_TRUSTED:
        return written
    b = float(rating["b"])
    return 1 if b < -0.4 else 3 if b > 0.4 else 2


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
