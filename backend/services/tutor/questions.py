"""
Question bank: validation of model output, what the student may see,
deterministic grading of choice questions, adaptive selection and the
diagnosis of what went wrong.

A question (stored server-side, never sent with its answer):
  id, topic_id, pool (check|quiz|final), segment (lesson part for checks)
  format   choice | text | code
  skill    recall · explain · predict · apply · debug · compare · write_code
  bloom    remember · understand · apply · analyze
  difficulty 1..3, concept_ids [..], prompt (markdown)
  options [..], answer_index, option_feedback [..]   (choice only — one note
           per option saying which misunderstanding leads there)
  misconceptions [..] short tag per option ("" for the right one)
  model_answer, rubric                               (text / code)
  hints [h1, h2], explanation, pages [..]
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

FORMATS = ("choice", "text", "code")
SKILLS = ("recall", "explain", "predict", "apply", "debug", "compare", "write_code")
BLOOMS = ("remember", "understand", "apply", "analyze")
POOLS = ("check", "quiz", "final")

SKILL_AR = {
    "recall": "تذكّر",
    "explain": "تفسير",
    "predict": "توقّع النتيجة",
    "apply": "تطبيق",
    "debug": "اكتشاف الخطأ",
    "compare": "مقارنة",
    "write_code": "كتابة كود",
}

_SKILL_BLOOM = {
    "recall": "remember",
    "explain": "understand",
    "compare": "analyze",
    "predict": "apply",
    "apply": "apply",
    "debug": "analyze",
    "write_code": "apply",
}

_PAGE_REF = re.compile(r"\[ص\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\]")


def clip(v: Any, n: int) -> str:
    return str(v or "").strip()[:n]


def _int(v: Any, default: int, lo: int, hi: int) -> int:
    try:
        return min(hi, max(lo, int(v)))
    except (TypeError, ValueError):
        return default


def valid_pages(pages: Any, allowed: set[int]) -> list[int]:
    out = []
    for p in pages or []:
        try:
            n = int(p)
        except (TypeError, ValueError):
            continue
        if n in allowed and n not in out:
            out.append(n)
    return out[:8]


def strip_bad_refs(md: str, allowed: set[int]) -> str:
    """Drop [ص N] citations that point outside the lecture (never cite a page we don't have)."""

    def fix(m: re.Match) -> str:
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        return m.group(0) if a in allowed and b in allowed else ""

    return _PAGE_REF.sub(fix, md or "")


def cited_pages(md: str) -> list[int]:
    out: list[int] = []
    for m in _PAGE_REF.finditer(md or ""):
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        for n in range(min(a, b), min(max(a, b), min(a, b) + 10) + 1):
            if n not in out:
                out.append(n)
    return out


def question_id(topic_id: str, prompt: str, salt: str = "") -> str:
    h = hashlib.sha1(f"{topic_id}|{prompt}|{salt}".encode("utf-8")).hexdigest()[:10]
    return f"{topic_id}-{h}"


def normalize_question(raw: Any, topic_id: str, pool: str, concept_ids: set[str], allowed_pages: set[int], segment: str | None = None) -> dict | None:
    """Validate one model-made question; None if unusable."""
    if not isinstance(raw, dict):
        return None
    prompt = clip(raw.get("prompt") or raw.get("question"), 2500)
    if len(prompt) < 5:
        return None
    fmt = raw.get("format") if raw.get("format") in FORMATS else ("choice" if raw.get("options") else "text")
    skill = raw.get("skill") if raw.get("skill") in SKILLS else ("recall" if fmt == "choice" else "explain")
    bloom = raw.get("bloom") if raw.get("bloom") in BLOOMS else _SKILL_BLOOM[skill]
    q: dict[str, Any] = {
        "id": "",
        "topic_id": topic_id,
        "pool": pool if pool in POOLS else "quiz",
        "segment": segment,
        "format": fmt,
        "skill": skill,
        "bloom": bloom,
        "difficulty": _int(raw.get("difficulty"), 2, 1, 3),
        "concept_ids": [c for c in (raw.get("concept_ids") or []) if c in concept_ids][:4],
        "prompt": strip_bad_refs(prompt, allowed_pages),
        "hints": [clip(h, 500) for h in (raw.get("hints") or []) if clip(h, 500)][:2],
        "explanation": strip_bad_refs(clip(raw.get("explanation"), 1500), allowed_pages),
        "pages": valid_pages(raw.get("pages"), allowed_pages),
    }
    if fmt == "choice":
        opts = [clip(o, 400) for o in (raw.get("options") or [])]
        opts = [o for o in opts if o]
        ans = _int(raw.get("answer_index"), -1, -1, 10)
        if not (2 <= len(opts) <= 5) or not (0 <= ans < len(opts)) or len(set(opts)) != len(opts):
            return None
        fb = [clip(x, 600) for x in (raw.get("option_feedback") or [])]
        mis = [clip(x, 80) for x in (raw.get("misconceptions") or [])]
        q["options"] = opts
        q["answer_index"] = ans
        q["option_feedback"] = (fb + [""] * len(opts))[: len(opts)]
        q["misconceptions"] = (mis + [""] * len(opts))[: len(opts)]
        q["misconceptions"][ans] = ""
    else:
        model = clip(raw.get("model_answer"), 3000)
        if not model:
            return None
        q["model_answer"] = model
        q["rubric"] = clip(raw.get("rubric"), 1500)
        # Exact answers (short commands / one-liners) that are fully correct —
        # matched in code before paying for a model grade.
        q["accepted_answers"] = [clip(a, 300) for a in (raw.get("accepted_answers") or []) if clip(a, 300)][:8]
    if not q["concept_ids"] and concept_ids:
        q["concept_ids"] = []
    q["id"] = question_id(topic_id, q["prompt"], pool)
    return q


def public_question(q: dict) -> dict:
    """What the browser receives before answering: no answer, no rubric."""
    out = {
        "id": q["id"],
        "topic_id": q["topic_id"],
        "format": q["format"],
        "skill": q["skill"],
        "skill_label": SKILL_AR.get(q["skill"], ""),
        "difficulty": q["difficulty"],
        "prompt": q["prompt"],
        "pages": q.get("pages") or [],
        "has_hint": bool(q.get("hints")),
    }
    if q["format"] == "choice":
        out["options"] = q["options"]
    return out


def normalize_answer(text: str) -> str:
    """Whitespace- and prompt-insensitive form of a short command/code answer."""
    t = str(text or "").strip()
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    lines = [ln[2:] if ln.startswith("$ ") else ln for ln in lines]
    t = "\n".join(" ".join(ln.split()) for ln in lines)
    return t.rstrip(";").strip().strip("`").strip()


def match_accepted(q: dict, answer: str) -> bool:
    """True when the answer equals one of the question's accepted answers."""
    if not q.get("accepted_answers"):
        return False
    a = normalize_answer(answer)
    return bool(a) and any(a == normalize_answer(x) for x in q["accepted_answers"])


def grade_choice(q: dict, choice: Any) -> dict:
    """Deterministic: right/wrong plus the misunderstanding behind the picked option."""
    idx = _int(choice, -1, -1, 99)
    if not (0 <= idx < len(q.get("options") or [])):
        return {"valid": False}
    correct = idx == q["answer_index"]
    return {
        "valid": True,
        "correct": correct,
        "credit": 1.0 if correct else 0.0,
        "picked": idx,
        "misconception": "" if correct else (q.get("misconceptions") or [""] * 9)[idx],
        "note": "" if correct else (q.get("option_feedback") or [""] * 9)[idx],
    }


# ── Adaptive selection ─────────────────────────────────────────────


def next_difficulty(current: int, last_correct: bool | None) -> int:
    """Staircase: a right answer raises the level, a wrong one lowers it."""
    if last_correct is None:
        return current
    return min(3, current + 1) if last_correct else max(1, current - 1)


def select_next(
    pool: list[dict],
    asked: set[str],
    target_difficulty: int,
    weak: list[str] | None = None,
    need_higher_order: bool = False,
    covered_concepts: set[str] | None = None,
    avoid_formats: set[str] | None = None,
    solved_skills: set[str] | None = None,
) -> dict | None:
    """Best unasked question for what we still need to learn about the student."""
    weak = weak or []
    covered = covered_concepts or set()
    best: tuple[float, str, dict] | None = None
    for q in pool:
        if q["id"] in asked or q.get("disabled"):
            continue
        s = -abs(q["difficulty"] - target_difficulty) * 1.5
        cs = set(q.get("concept_ids") or [])
        if weak and cs & set(weak):
            s += 3.0
        if need_higher_order and q["bloom"] in ("apply", "analyze"):
            s += 2.5
        if solved_skills and q.get("skill") not in solved_skills:
            s += 1.5  # transfer: try a form of question not answered correctly yet
        if cs - covered:
            s += 1.0
        if avoid_formats and q["format"] in avoid_formats:
            s -= 1.0
        key = (s, q["id"])
        if best is None or key > (best[0], best[1]):
            best = (s, q["id"], q)
    return best[2] if best else None


# ── Diagnosis → teaching strategy ─────────────────────────────────

STRATEGY_AR = {
    "prerequisite": "نرجع للمتطلب السابق الذي يعتمد عليه هذا المفهوم",
    "worked_example": "أمثلة محلولة خطوة بخطوة ثم تطبيق موجّه",
    "contrast": "شرح بزاوية مختلفة مع مثال مضاد يوضح الخلط المتكرر",
    "reexplain": "شرح المفهوم من جديد بأسلوب أبسط وتشبيه",
}


def diagnose(evidence: list[dict], weak: list[str], prereq_gap: list[str]) -> dict:
    """Pick a strategy from the pattern of mistakes (rules, not the model).

    • a weak concept rests on an unmastered prerequisite → prerequisite
    • the same misunderstanding came up twice or more → contrast (different angle)
    • recall/understanding fine but application/analysis wrong → worked_example
    • otherwise → reexplain
    """
    if prereq_gap:
        kind = "prerequisite"
    else:
        counts: dict[str, int] = {}
        for e in evidence:
            if e.get("misconception") and not e.get("correct"):
                counts[e["misconception"]] = counts.get(e["misconception"], 0) + 1
        repeated = [m for m, c in counts.items() if c >= 2]
        # Wrong while "sure": a belief to confront, not a gap to fill.
        confident_wrong = any(not e.get("correct") and e.get("confidence") == "sure" for e in evidence)
        low = [e for e in evidence if e.get("bloom") in ("remember", "understand") and e.get("kind") != "check"]
        high = [e for e in evidence if e.get("bloom") in ("apply", "analyze") and e.get("kind") != "check"]
        low_ok = bool(low) and sum(1 for e in low if e.get("correct")) / len(low) >= 0.7
        high_bad = bool(high) and sum(1 for e in high if not e.get("correct")) / len(high) >= 0.5
        if repeated or confident_wrong:
            kind = "contrast"
        elif low_ok and high_bad:
            kind = "worked_example"
        else:
            kind = "reexplain"
    misconceptions = sorted(
        {e.get("misconception") for e in evidence if e.get("misconception") and not e.get("correct")}
    )
    return {"strategy": kind, "label": STRATEGY_AR[kind], "weak": weak, "prerequisites": prereq_gap, "misconceptions": misconceptions[:5]}


# ── Final exam blueprint ──────────────────────────────────────────


def exam_blueprint(topics: list[dict], total_min: int = 6, total_max: int = 15) -> dict[str, int]:
    """Questions per topic in proportion to importance (every topic at least one)."""
    if not topics:
        return {}
    weights = {t["id"]: max(1, int(t.get("importance") or 2)) for t in topics}
    total = max(total_min, min(total_max, sum(weights.values()) + len(topics) // 2))
    total = max(total, len(topics))
    s = sum(weights.values())
    alloc = {tid: max(1, int(total * w / s)) for tid, w in weights.items()}
    # Hand out the remainder to the most important topics first.
    order = sorted(weights, key=lambda t: (-weights[t], t))
    i = 0
    while sum(alloc.values()) < total:
        alloc[order[i % len(order)]] += 1
        i += 1
    while sum(alloc.values()) > max(total, len(topics)):
        for tid in reversed(order):
            if alloc[tid] > 1 and sum(alloc.values()) > total:
                alloc[tid] -= 1
    return alloc


def pick_for_exam(pool: list[dict], asked: set[str], n: int) -> list[dict]:
    """n questions for one topic: unseen first, mixing levels of thinking and difficulty."""
    fresh = [q for q in pool if q["id"] not in asked]
    fresh.sort(key=lambda q: (0 if q["pool"] == "final" else 1, q["id"]))
    chosen: list[dict] = []
    blooms: set[str] = set()
    for q in fresh:  # first pass: one per level of thinking
        if len(chosen) >= n:
            break
        if q["bloom"] not in blooms:
            chosen.append(q)
            blooms.add(q["bloom"])
    for q in fresh:
        if len(chosen) >= n:
            break
        if q not in chosen:
            chosen.append(q)
    # Text/code questions cost a model call to grade — keep at most 2 per topic.
    text = [q for q in chosen if q["format"] != "choice"]
    if len(text) > 2:
        chosen = [q for q in chosen if q["format"] == "choice"] + text[:2]
    return chosen[:n]
