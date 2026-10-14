"""
Anonymous, aggregate learning statistics per lecture file.

  tutor_stats/{fileHash[:24]}   counters only — no uid, no names, no answers

What is counted (everything the admin page can show):
  students        students who answered at least one question on this lecture
  topics          per topic: answers / correct, topic closes, mastered closes,
                  minutes to close, remediation rounds
  concepts        per concept: answers / correct (most-missed concepts)
  questions       per question of the shared bank: answers / correct, skill,
                  difficulty, short prompt (too easy / too hard flags)
  strategies      remediation strategy → rounds / rounds followed by mastery
  retention       spaced-review answers by days since mastery bucket
  finals          first attempt vs later attempts of the final exam

Only the shared question bank (tutor_cache) is counted per question, so the
same question is seen by many students. Results are hidden below MIN_SAMPLE.
Everything here is best-effort: a failure never blocks a student.
"""

from __future__ import annotations

import logging
from typing import Any

from google.cloud import firestore

logger = logging.getLogger(__name__)

MIN_STUDENTS = 10
MIN_ANSWERS_PER_QUESTION = 30
MIN_ANSWERS_PER_CONCEPT = 20


def stats_ref(db, file_hash: str):
    return db.collection("tutor_stats").document(file_hash[:24])


def _bump(d: dict, path: list[str], field: str, by: float = 1) -> None:
    cur = d
    for p in path:
        cur = cur.setdefault(p, {})
    cur[field] = cur.get(field, 0) + by


def _key(s: str) -> str:
    """Firestore map keys cannot contain dots or slashes."""
    return (s or "—").replace(".", "·").replace("/", "∕").strip()[:120] or "—"


def apply_events(db, file_hash: str, title: str, events: list[dict]) -> None:
    if not events or not file_hash:
        return
    ref = stats_ref(db, file_hash)

    @firestore.transactional
    def _run(tx) -> None:
        snap = ref.get(transaction=tx)
        d: dict[str, Any] = snap.to_dict() or {} if snap.exists else {}
        d["title"] = title
        for e in events:
            kind = e.get("type")
            if kind == "new_student":
                d["students"] = d.get("students", 0) + 1
            elif kind == "answer":
                ok = 1 if e.get("correct") else 0
                _bump(d, ["topics", _key(e["topic"])], "answers")
                _bump(d, ["topics", _key(e["topic"])], "correct", ok)
                for c in e.get("concepts") or []:
                    _bump(d, ["concepts", _key(c)], "answers")
                    _bump(d, ["concepts", _key(c)], "correct", ok)
                if e.get("shared") and e.get("qid"):
                    q = d.setdefault("questions", {}).setdefault(_key(e["qid"]), {})
                    q["answers"] = q.get("answers", 0) + 1
                    q["correct"] = q.get("correct", 0) + ok
                    q["skill"], q["difficulty"] = e.get("skill"), e.get("difficulty")
                    q["topic"] = e.get("topic")
                    q["prompt"] = str(e.get("prompt") or "")[:140]
                _bump(d, ["kinds", _key(e.get("kind") or "quiz")], "answers")
                _bump(d, ["kinds", _key(e.get("kind") or "quiz")], "correct", ok)
            elif kind == "topic_closed":
                t = ["topics", _key(e["topic"])]
                _bump(d, t, "closes")
                _bump(d, t, "mastered", 1 if e.get("mastered") else 0)
                _bump(d, t, "minutes", round(float(e.get("minutes") or 0), 1))
                _bump(d, t, "rounds", int(e.get("rounds") or 0))
            elif kind == "remediation_result":
                s = ["strategies", _key(e["strategy"])]
                _bump(d, s, "rounds")
                _bump(d, s, "improved", 1 if e.get("improved") else 0)
            elif kind == "review":
                b = ["retention", _key(e.get("bucket") or "?")]
                _bump(d, b, "answers")
                _bump(d, b, "correct", 1 if e.get("correct") else 0)
            elif kind == "report":
                q = d.setdefault("questions", {}).setdefault(_key(e["qid"]), {})
                q["reports"] = q.get("reports", 0) + 1
                q.setdefault("reasons", {})[_key(e.get("reason") or "unclear")] = q.get("reasons", {}).get(_key(e.get("reason") or "unclear"), 0) + 1
                q["topic"] = e.get("topic")
                q["prompt"] = str(e.get("prompt") or "")[:140]
            elif kind == "final":
                f = ["finals", "first" if e.get("attempt", 1) == 1 else "later"]
                _bump(d, f, "attempts")
                _bump(d, f, "scoreSum", round(float(e.get("score") or 0), 3))
        tx.set(ref, d)

    try:
        _run(db.transaction())
    except Exception as exc:  # analytics must never break studying
        logger.warning("[tutor.analytics] skipped %d events: %s", len(events), exc)


def retention_bucket(days: int) -> str:
    if days <= 1:
        return "1d"
    if days <= 3:
        return "2-3d"
    if days <= 7:
        return "4-7d"
    if days <= 14:
        return "8-14d"
    return "15d+"


def _rate(row: dict) -> float | None:
    n = row.get("answers") or row.get("attempts") or 0
    return round((row.get("correct", 0) / n), 3) if n else None


def insights(db) -> dict[str, Any]:
    """Admin view across lectures. Hides everything below the sample thresholds."""
    lectures = []
    for snap in db.collection("tutor_stats").stream():
        d = snap.to_dict() or {}
        students = int(d.get("students") or 0)
        enough = students >= MIN_STUDENTS
        row: dict[str, Any] = {"id": snap.id, "title": d.get("title") or "محاضرة", "students": students, "enough_data": enough}
        if not enough:
            row["note"] = f"العينة صغيرة ({students} طالب) — نعرض النتائج بعد {MIN_STUDENTS} طلاب على الأقل."
            lectures.append(row)
            continue
        topics = []
        for name, t in (d.get("topics") or {}).items():
            closes = t.get("closes", 0)
            topics.append({
                "topic": name,
                "accuracy": _rate(t),
                "answers": t.get("answers", 0),
                "mastery_rate": round(t.get("mastered", 0) / closes, 3) if closes else None,
                "avg_minutes": round(t.get("minutes", 0) / closes, 1) if closes else None,
                "avg_rounds": round(t.get("rounds", 0) / closes, 2) if closes else None,
            })
        topics.sort(key=lambda r: (r["accuracy"] if r["accuracy"] is not None else 1))
        concepts = [
            {"concept": k, "accuracy": _rate(v), "answers": v.get("answers", 0)}
            for k, v in (d.get("concepts") or {}).items()
            if v.get("answers", 0) >= MIN_ANSWERS_PER_CONCEPT
        ]
        concepts.sort(key=lambda r: r["accuracy"])
        flags = []
        for qid, q in (d.get("questions") or {}).items():
            n = q.get("answers", 0)
            if q.get("reports", 0) >= 2:  # students flagged it: worth a look at any sample size
                flags.append({
                    "question": q.get("prompt"),
                    "topic": q.get("topic"),
                    "skill": q.get("skill"),
                    "difficulty": q.get("difficulty"),
                    "accuracy": round(q.get("correct", 0) / n, 3) if n else None,
                    "answers": n,
                    "flag": f"أبلغ عنه {q['reports']} طلاب",
                    "advice": "تحقق من الإجابة المعتمدة وصياغة السؤال. يتوقف عرضه تلقائياً بعد 3 بلاغات.",
                })
                continue
            if n < MIN_ANSWERS_PER_QUESTION:
                continue
            p = q.get("correct", 0) / n
            if p >= 0.95 or p <= 0.2:
                flags.append({
                    "question": q.get("prompt"),
                    "topic": q.get("topic"),
                    "skill": q.get("skill"),
                    "difficulty": q.get("difficulty"),
                    "accuracy": round(p, 3),
                    "answers": n,
                    "flag": "سهل أكثر من اللازم" if p >= 0.95 else "صعب بشكل غير معتاد",
                    "advice": "راجع صياغة السؤال وصحة الإجابة المعتمدة وتغطية الشرح للمعلومة قبل تغيير مستوى المحتوى.",
                })
        strategies = [
            {"strategy": k, "rounds": v.get("rounds", 0), "improved_rate": round(v.get("improved", 0) / v["rounds"], 3) if v.get("rounds") else None}
            for k, v in (d.get("strategies") or {}).items()
        ]
        retention = {k: {"answers": v.get("answers", 0), "accuracy": _rate(v)} for k, v in (d.get("retention") or {}).items()}
        finals = {
            k: {"attempts": v.get("attempts", 0), "avg_score": round(v.get("scoreSum", 0) / v["attempts"], 3) if v.get("attempts") else None}
            for k, v in (d.get("finals") or {}).items()
        }
        row.update({
            "hardest_topics": topics[:5],
            "most_missed_concepts": concepts[:8],
            "question_flags": flags[:10],
            "strategies": strategies,
            "retention": retention,
            "finals": finals,
        })
        lectures.append(row)
    lectures.sort(key=lambda r: -r["students"])
    return {"min_students": MIN_STUDENTS, "lectures": lectures}
