"""
The tutor: a state machine that runs one lecture, topic by topic.

Lecture phases
    overview → topic (repeated) → final_ready → final → done
    (a spaced "review" detour can be inserted whenever reviews are due)

Topic stages (progress.step.stage)
    goal       objective, why it matters, prerequisites
    explain    one lesson segment at a time, each followed by a check question
    quiz       adaptive mastery quiz (3–6 questions, stops when the evidence is clear)
    remediate  targeted re-teaching chosen from the mistakes, then a short re-test
    closed     mastery recorded, summary shown, next topic offered

Moving on is decided by rules on the evidence (services/tutor/mastery.py),
never by message count or time. The model writes explanations and questions;
code decides what happens next, grades choice questions, gives hints and
computes mastery. Every model call is charged against the daily credits.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import HTTPException

from services.quota import COST_TUTOR_LESSON, COST_TUTOR_SMALL
from services.tutor import ai, analytics, mastery, prompts, schemas, store
from services.tutor.extract import PageContent, page_block
from services.tutor.questions import (
    SKILL_AR,
    clip,
    cited_pages,
    diagnose,
    exam_blueprint,
    grade_choice,
    match_accepted,
    next_difficulty,
    normalize_question,
    pick_for_exam,
    public_question,
    select_next,
    strip_bad_refs,
    valid_pages,
)

logger = logging.getLogger(__name__)

COST_LESSON = COST_TUTOR_LESSON
COST_SMALL = COST_TUTOR_SMALL

QUIZ_MIN = 3
QUIZ_MAX = 6
REMEDIATION_QUIZ = 5  # after a failed quiz: up to 5 new questions to show it's fixed
REMEDIATION_MIN = 2
MAX_ROUNDS = 2
MAX_ANSWER_CHARS = 4000
CONFIDENCE = ("sure", "think", "guess")
ACTIVE_GAP_SEC = 300  # longer pauses between actions don't count as study time

TOPIC_PAGES_CHARS = 24_000


class TutorError(Exception):
    """Shown to the student as-is (Arabic)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class Ctx:
    db: Any
    uid: str
    lecture: dict
    progress: dict
    now: dt.datetime
    charge: Callable[[int], None]
    messages: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    _pages: list[PageContent] | None = None
    _lessons: dict[str, dict] = field(default_factory=dict)
    _extras: dict[str, list[dict]] = field(default_factory=dict)
    _extras_dirty: set[str] = field(default_factory=set)
    learner_style: str | None = None

    @property
    def today(self) -> str:
        return (self.now + dt.timedelta(hours=3)).date().isoformat()  # Riyadh day

    @property
    def iso(self) -> str:
        return self.now.isoformat()

    # ── messages ──
    def _push(self, role: str, blocks: list[dict], actions: list[dict] | None = None) -> None:
        self.progress["seq"] = int(self.progress.get("seq") or 0) + 1
        msg = {"seq": self.progress["seq"], "role": role, "ts": self.iso, "blocks": blocks}
        if actions:
            msg["actions"] = actions
        self.messages.append(msg)

    def say(self, *blocks: dict, actions: list[dict] | None = None) -> None:
        self._push("tutor", [b for b in blocks if b], actions)

    def student(self, *blocks: dict) -> None:
        self._push("student", list(blocks))

    # ── lecture data ──
    def topic(self, tid: str | None) -> dict | None:
        return next((t for t in self.lecture["topics"] if t["id"] == tid), None)

    @property
    def topic_ids(self) -> list[str]:
        return [t["id"] for t in self.lecture["topics"]]

    def pages(self) -> list[PageContent]:
        if self._pages is None:
            self._pages = store.load_pages(self.db, self.lecture["fileHash"], self.lecture["pageCount"])
        return self._pages

    def all_page_numbers(self) -> set[int]:
        return set(range(1, int(self.lecture["pageCount"]) + 1))

    def topic_pages_text(self, topic: dict, extra_topics: list[dict] | None = None) -> str:
        nums: list[int] = []
        for t in [topic, *(extra_topics or [])]:
            a, b = t["pages"]
            nums += [n for n in range(a, b + 1) if n not in nums]
        pages = self.pages()
        blocks = [page_block(pages[n - 1], 4000) for n in nums if 0 < n <= len(pages)]
        text = "\n\n".join(blocks)
        return text[:TOPIC_PAGES_CHARS]

    def tstate(self, tid: str) -> dict:
        return self.progress.setdefault("topics", {}).setdefault(tid, {})

    # ── questions ──
    def lesson(self, tid: str) -> dict | None:
        if tid not in self._lessons:
            got = store.get_lesson(self.db, self.lecture["fileHash"], tid)
            if got:
                self._lessons[tid] = got
        return self._lessons.get(tid)

    def extras(self, tid: str) -> list[dict]:
        if tid not in self._extras:
            self._extras[tid] = store.get_extras(self.db, self.uid, self.lecture["id"], tid)
        return self._extras[tid]

    def add_extras(self, tid: str, qs: list[dict]) -> None:
        self.extras(tid).extend(qs)
        self._extras_dirty.add(tid)

    def bank(self, tid: str, pools: tuple[str, ...] = ("quiz",)) -> list[dict]:
        """Usable questions: not retired by reports, not reported by this student."""
        lesson = self.lesson(tid) or {}
        reported = set(self.progress.get("reported") or [])
        qs = [q for q in lesson.get("questions") or [] if q.get("pool") in pools]
        qs += [q for q in self.extras(tid) if q.get("pool") in pools]
        return [q for q in qs if not q.get("disabled") and q["id"] not in reported]

    def question(self, qid: str) -> dict | None:
        tid = qid.split("-")[0]
        for q in (self.lesson(tid) or {}).get("questions") or []:
            if q["id"] == qid:
                return q
        for q in self.extras(tid):
            if q["id"] == qid:
                return q
        return None

    def is_shared(self, qid: str) -> bool:
        tid = qid.split("-")[0]
        return any(q["id"] == qid for q in (self.lesson(tid) or {}).get("questions") or [])

    @property
    def asked(self) -> set[str]:
        return set(self.progress.get("asked") or [])

    def mark_asked(self, qid: str) -> None:
        asked = list(self.progress.get("asked") or [])
        if qid not in asked:
            asked.append(qid)
        self.progress["asked"] = asked[-400:]

    def flush(self) -> None:
        for tid in self._extras_dirty:
            store.save_extras(self.db, self.uid, self.lecture["id"], tid, self._extras[tid])


# ══════════════════════════════════════════════════════════════════
#  Progress
# ══════════════════════════════════════════════════════════════════


def new_progress(lecture: dict, now: dt.datetime) -> dict:
    return {
        "lectureId": lecture["id"],
        "phase": "overview",
        "currentTopicId": None,
        "step": {},
        "topics": {t["id"]: {} for t in lecture["topics"]},
        "asked": [],
        "pending": None,
        "final": None,
        "review": None,
        "points": 0,
        "seq": 0,
        "version": 0,
        "startedAt": now.isoformat(),
        "lastActionAt": now.isoformat(),
    }


def _track_time(ctx: Ctx) -> None:
    last = ctx.progress.get("lastActionAt")
    tid = ctx.progress.get("currentTopicId")
    try:
        gap = (ctx.now - dt.datetime.fromisoformat(last)).total_seconds() if last else 0
    except ValueError:
        gap = 0
    if tid and 0 < gap <= ACTIVE_GAP_SEC:
        ts = ctx.tstate(tid)
        ts["activeSec"] = int(ts.get("activeSec") or 0) + int(gap)
    ctx.progress["lastActionAt"] = ctx.iso


# ══════════════════════════════════════════════════════════════════
#  Blocks the UI renders
# ══════════════════════════════════════════════════════════════════

A_NEXT = {"id": "next", "label": "التالي"}


def _act(id_: str, label: str, **payload: Any) -> dict:
    d = {"id": id_, "label": label}
    if payload:
        d["payload"] = payload
    return d


def map_block(ctx: Ctx) -> dict:
    return {
        "type": "map",
        "title": ctx.lecture.get("title"),
        "overview": ctx.lecture.get("overview"),
        "estMinutes": ctx.lecture.get("estMinutes"),
        "topics": [
            {"id": t["id"], "title": t["title"], "pages": t["pages"], "est_minutes": t["est_minutes"], "importance": t["importance"]}
            for t in ctx.lecture["topics"]
        ],
    }


def extraction_notice(lecture: dict) -> dict | None:
    ex = lecture.get("extraction") or {}
    parts = []
    if ex.get("visionPages"):
        parts.append(f"قرأتُ {len(ex['visionPages'])} صفحة مصوّرة بتحليل الصور ({_pages_label(ex['visionPages'])}).")
    unread = ex.get("unreadablePages") or []
    if unread:
        parts.append(f"لم أتمكن من قراءة {len(unread)} صفحة ({_pages_label(unread)}) — لن أشرح محتواها حتى لا أخترعه؛ ارجع لها في الملف الأصلي.")
    if ex.get("visionSkipped"):
        parts.append(f"الملف فيه صفحات مصوّرة كثيرة؛ لم تُقرأ {len(ex['visionSkipped'])} منها ({_pages_label(ex['visionSkipped'])}).")
    if not parts:
        return None
    return {"type": "notice", "tone": "warn" if unread or ex.get("visionSkipped") else "info", "md": " ".join(parts)}


def _pages_label(nums: list[int]) -> str:
    nums = sorted(set(int(n) for n in nums))
    if not nums:
        return ""
    runs, start, prev = [], nums[0], nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
            continue
        runs.append((start, prev))
        start = prev = n
    runs.append((start, prev))
    text = "، ".join(f"ص {a}" if a == b else f"ص {a}–{b}" for a, b in runs[:6])
    return text + ("…" if len(runs) > 6 else "")


def question_block(q: dict, context: str, index: int | None = None, total: int | None = None) -> dict:
    b = {"type": "question", "context": context, "question": public_question(q)}
    if context == "final":
        b["question"]["has_hint"] = False
    if index is not None:
        b["index"], b["total"] = index, total
    return b


def progress_view(ctx: Ctx) -> dict:
    """Topic statuses for the side panel and the map."""
    out = {}
    for t in ctx.lecture["topics"]:
        ts = ctx.progress.get("topics", {}).get(t["id"]) or {}
        a = mastery.assess(ts.get("evidence") or [])
        out[t["id"]] = {
            "status": mastery.status_of(ts, ctx.today),
            "score": a["score"],
            "confidence": a["confidence"],
            "mastered": a["mastered"],
            "missing": a["missing"],
            "met": a["met"],
            "attempts": int(ts.get("attempts") or 0),
            "correct": int(ts.get("correct") or 0),
            "reviewDue": ts.get("reviewDue"),
            "lastReviewedAt": ts.get("lastReviewedAt"),
            "activeMinutes": round(int(ts.get("activeSec") or 0) / 60),
        }
    return out


def public_state(ctx: Ctx) -> dict:
    p = ctx.progress
    pending = p.get("pending")
    pq = None
    if pending:
        q = ctx.question(pending["qid"])
        if q:
            pq = question_block(q, pending["context"], pending.get("index"), pending.get("total"))
            pq["attempts"] = pending.get("attempts", 0)
            pq["hints"] = pending.get("hints", 0)
    step = p.get("step") or {}
    lesson = ctx.lesson(p["currentTopicId"]) if p.get("currentTopicId") else None
    final = p.get("final") or None
    return {
        "phase": p.get("phase"),
        "currentTopicId": p.get("currentTopicId"),
        "stage": step.get("stage"),
        "segment": step.get("segment"),
        "segments": len((lesson or {}).get("segments") or []),
        "pending": pq,
        "topics": progress_view(ctx),
        "reviewDue": mastery.due_reviews(p.get("topics") or {}, ctx.today),
        "points": int(p.get("points") or 0),
        "final": None if not final else {k: final.get(k) for k in ("status", "index", "total", "attempt", "result")},
        "version": int(p.get("version") or 0),
    }


# ══════════════════════════════════════════════════════════════════
#  Lessons (generated once per file, shared through the cache)
# ══════════════════════════════════════════════════════════════════


def _concepts_text(topic: dict) -> str:
    return "\n".join(f"- {c['id']}: {c['name']} — {c.get('definition', '')}" for c in topic.get("concepts") or []) or "—"


def _normalize_questions(raw_list: Any, topic: dict, allowed: set[int], default_pool: str, salt: str = "") -> list[dict]:
    concept_ids = {c["id"] for c in topic.get("concepts") or []}
    out, seen = [], set()
    for raw in raw_list or []:
        if not isinstance(raw, dict):
            continue
        pool = raw.get("pool") if raw.get("pool") in ("check", "quiz", "final") else default_pool
        seg = raw.get("segment")
        q = normalize_question(raw, topic["id"], pool, concept_ids, allowed, segment=str(seg) if seg is not None and pool == "check" else None)
        if not q:
            continue
        if salt:
            q["id"] = f"{q['id']}{salt}"
        if q["id"] in seen:
            continue
        seen.add(q["id"])
        out.append(q)
    return out


async def ensure_lesson(ctx: Ctx, tid: str) -> dict:
    got = ctx.lesson(tid)
    if got and got.get("segments"):
        return got
    topic = ctx.topic(tid)
    allowed = ctx.all_page_numbers()
    earlier = [t["title"] for t in ctx.lecture["topics"][: ctx.topic_ids.index(tid)]]
    ctx.charge(COST_LESSON)
    raw = await ai.ask_json(
        prompts.LESSON.format(
            lecture=ctx.lecture.get("title", ""),
            title=topic["title"],
            objectives="؛ ".join(topic.get("objectives") or []) or "—",
            concepts=_concepts_text(topic),
            earlier="، ".join(earlier[:10]) or "— (هذا أول موضوع)",
            learner="طالب جامعي يذاكر المحاضرة لأول مرة",
            pages=ctx.topic_pages_text(topic),
            question_spec=prompts.QUESTION_SPEC.format(),
            code_note=", write_code (the topic has code)" if topic.get("has_code") else "",
        ),
        "Write the lesson and the questions for this topic.",
        schema=schemas.LESSON,
        kind="lesson",
        temperature=0.4,
        # Gemini 3 counts its reasoning against this limit; a long topic with
        # its question bank needs room or the JSON gets cut off.
        max_tokens=32000,
        timeout=180.0,
    )
    segments = []
    for s in (raw.get("segments") if isinstance(raw, dict) else None) or []:
        if not isinstance(s, dict):
            continue
        md = strip_bad_refs(clip(s.get("markdown"), 6000), allowed)
        if len(md) < 40:
            continue
        segments.append({
            "title": clip(s.get("title"), 140) or f"الجزء {len(segments) + 1}",
            "markdown": md,
            "pages": valid_pages(s.get("pages"), allowed) or cited_pages(md)[:6],
            "concept_ids": [c for c in s.get("concept_ids") or [] if any(c == k["id"] for k in topic.get("concepts") or [])],
        })
    segments = segments[:5]
    if not segments:
        raise TutorError("تعذّر تجهيز شرح هذا الموضوع الآن. اضغط «حاول مرة أخرى» بعد قليل.", 502)
    questions = _normalize_questions(raw.get("questions"), topic, allowed, "quiz")
    # A check question must point at an existing segment.
    for q in questions:
        if q["pool"] == "check" and (q.get("segment") is None or not str(q["segment"]).isdigit() or int(q["segment"]) >= len(segments)):
            q["pool"] = "quiz"
            q["segment"] = None
    lesson = {"topicId": tid, "segments": segments, "questions": questions, "variants": {}, "generatedAt": ctx.iso}
    store.save_lesson(ctx.db, ctx.lecture["fileHash"], tid, lesson)
    ctx._lessons[tid] = lesson
    return lesson


async def more_questions(ctx: Ctx, tid: str, n: int, pool: str, shared: bool = True) -> list[dict]:
    """Extra questions when the bank runs out (charged)."""
    topic = ctx.topic(tid)
    used = [q["prompt"][:160] for q in ctx.bank(tid, ("check", "quiz", "final"))]
    ctx.charge(COST_SMALL)
    raw = await ai.ask_json(
        prompts.MORE_QUESTIONS.format(
            n=n,
            title=topic["title"],
            lecture=ctx.lecture.get("title", ""),
            concepts=_concepts_text(topic),
            used="\n".join(f"- {u}" for u in used[:30]) or "—",
            pages=ctx.topic_pages_text(topic),
            pool=pool,
            question_spec=prompts.QUESTION_SPEC.format(),
        ),
        f"Write {n} new questions.",
        schema=schemas.QUESTIONS,
        kind="more_questions",
        temperature=0.5,
        max_tokens=8000,
    )
    salt = "" if shared else f"x{int(ctx.progress.get('seq') or 0)}"
    qs = _normalize_questions((raw or {}).get("questions") if isinstance(raw, dict) else None, topic, ctx.all_page_numbers(), pool, salt)
    for q in qs:
        q["pool"] = pool
        q["segment"] = None
    known = {q["id"] for q in ctx.bank(tid, ("check", "quiz", "final"))}
    qs = [q for q in qs if q["id"] not in known]
    if shared:
        lesson = ctx.lesson(tid) or {"topicId": tid, "segments": [], "questions": [], "variants": {}, "generatedAt": ctx.iso}
        lesson["questions"] = list(lesson.get("questions") or []) + qs
        store.save_lesson(ctx.db, ctx.lecture["fileHash"], tid, lesson)
        ctx._lessons[tid] = lesson
    else:
        ctx.add_extras(tid, qs)
    return qs


# ══════════════════════════════════════════════════════════════════
#  Topic flow
# ══════════════════════════════════════════════════════════════════


def _first_open_topic(ctx: Ctx) -> str | None:
    for tid in ctx.topic_ids:
        if mastery.status_of(ctx.progress["topics"].get(tid) or {}, ctx.today) in ("not_started", "in_progress"):
            return tid
    return None


WARMUP_MAX = 2


def enter_topic(ctx: Ctx, tid: str) -> None:
    p = ctx.progress
    p["phase"] = "topic"
    p["currentTopicId"] = tid
    p["pending"] = None
    p["step"] = {"stage": "goal", "segment": -1, "difficulty": 2, "quizAsked": [], "round": 0}
    ts = ctx.tstate(tid)
    ts.setdefault("visitedAt", ctx.iso)
    p["review"] = None
    warm = warmup_questions(ctx, tid)
    if warm:
        # Retrieval before new material: recall an earlier idea from memory
        # (prerequisites first) instead of re-reading it. Costs no model call.
        p["step"]["stage"] = "warmup"
        p["step"]["warmup"] = [q["id"] for q in warm[1:]]
        names = "، ".join(dict.fromkeys(f"«{ctx.topic(q['topic_id'])['title']}»" for q in warm))
        ctx.say({"type": "text", "md": f"قبل ما نبدأ الموضوع الجديد: {'سؤالان سريعان' if len(warm) > 1 else 'سؤال سريع'} من {names}. جاوب من ذاكرتك بدون ما ترجع للشرح — الاسترجاع يثبّت المعلومة أكثر من إعادة القراءة."})
        ask(ctx, warm[0], "warmup", 1, len(warm))
        return
    show_goal(ctx, tid)


def warmup_questions(ctx: Ctx, tid: str) -> list[dict]:
    """Up to WARMUP_MAX questions from topics already studied: the new topic's
    prerequisites first, then the topics reviewed longest ago."""
    order = ctx.topic_ids
    here = order.index(tid)
    studied = [x for x in order[:here] if (ctx.progress["topics"].get(x) or {}).get("closedAt") and ctx.lesson(x)]
    if not studied:
        return []
    prereq = [x for x in ctx.topic(tid).get("prerequisites") or [] if x in studied]
    rest = sorted((x for x in studied if x not in prereq), key=lambda x: (ctx.progress["topics"][x].get("lastReviewedAt") or "", order.index(x)))
    picked: list[dict] = []
    reported = set(ctx.progress.get("reported") or [])
    for x in prereq + rest:
        if len(picked) >= WARMUP_MAX:
            break
        pool = [q for q in ctx.bank(x, ("quiz",)) if q["id"] not in reported]
        q = select_next(pool, ctx.asked, 2)
        if q is None:  # bank used up: retrieval may reuse an old question
            q = next((q for q in pool if not q.get("disabled")), None)
        if q is not None:
            picked.append(q)
    return picked


def show_goal(ctx: Ctx, tid: str) -> None:
    topic = ctx.topic(tid)
    ctx.progress["step"]["stage"] = "goal"
    idx = ctx.topic_ids.index(tid) + 1
    prereq = [ctx.topic(x) for x in topic.get("prerequisites") or []]
    weak_prereq = [t["title"] for t in prereq if t and mastery.status_of(ctx.progress["topics"].get(t["id"]) or {}, ctx.today) != "mastered"]
    prior = "، ".join(t["title"] for t in prereq if t) or "لا يحتاج إلى معرفة سابقة من هذه المحاضرة"
    goal = {
        "type": "goal",
        "topicId": tid,
        "index": idx,
        "total": len(ctx.topic_ids),
        "title": topic["title"],
        "summary": topic.get("summary"),
        "objectives": topic.get("objectives") or [],
        "why": topic.get("summary") or "",
        "prerequisites": prior,
        "weakPrerequisites": weak_prereq,
        "pages": topic["pages"],
        "estMinutes": topic["est_minutes"],
    }
    actions = [_act("next", "ابدأ الشرح"), _act("test_out", "أعرف هذا الموضوع — اختبرني مباشرة")]
    ctx.say(goal, actions=actions)


async def show_segment(ctx: Ctx, seg: int) -> None:
    tid = ctx.progress["currentTopicId"]
    lesson = await ensure_lesson(ctx, tid)
    segs = lesson["segments"]
    step = ctx.progress["step"]
    step["stage"] = "explain"
    step["segment"] = seg
    s = segs[seg]
    ctx.say({"type": "lesson", "topicId": tid, "segment": seg, "total": len(segs), "title": s["title"], "md": s["markdown"], "pages": s["pages"]})
    check = next(
        (q for q in lesson["questions"] if q["pool"] == "check" and str(q.get("segment")) == str(seg) and q["id"] not in ctx.asked and not q.get("disabled")),
        None,
    )
    if check:
        step["stage"] = "check"
        ask(ctx, check, "check")
    else:
        ctx.say({"type": "text", "md": "واضح؟ إذا عندك سؤال اكتبه، أو كمّل."}, actions=[A_NEXT, _act("reexplain", "اشرحه بطريقة ثانية")])


def ask(ctx: Ctx, q: dict, context: str, index: int | None = None, total: int | None = None) -> None:
    ctx.progress["pending"] = {"qid": q["id"], "context": context, "attempts": 0, "hints": 0, "askedAt": ctx.iso, "index": index, "total": total}
    ctx.mark_asked(q["id"])
    acts = []
    if context != "final" and q.get("hints"):
        acts.append(_act("hint", "تلميح"))
    if context == "check":
        acts.append(_act("reexplain", "اشرحه بطريقة ثانية"))
    ctx.say(question_block(q, context, index, total), actions=acts or None)


async def start_quiz(ctx: Ctx) -> None:
    step = ctx.progress["step"]
    step["stage"] = "quiz"
    step["quizAsked"] = []
    step["difficulty"] = max(1, min(3, step.get("difficulty") or 2))
    ctx.say({"type": "text", "md": "**اختبار إتقان قصير** — أسئلة جديدة غير أمثلة الشرح. لن أنقلك للموضوع التالي إلا إذا ظهر أنك تطبّق الفكرة، لا تحفظها فقط."})
    await ask_next_quiz(ctx)


def _topic_evidence(ctx: Ctx, tid: str) -> list[dict]:
    return list(ctx.tstate(tid).get("evidence") or [])


async def ask_next_quiz(ctx: Ctx, weak: list[str] | None = None) -> bool:
    """Ask the next adaptive question. False when the bank is empty even after a refill."""
    tid = ctx.progress["currentTopicId"]
    step = ctx.progress["step"]
    ev = _topic_evidence(ctx, tid)
    need_ho = not any(e.get("correct") and e.get("bloom") in ("apply", "analyze") and e.get("kind") != "check" for e in ev)
    covered = {c for e in ev if e.get("kind") != "check" for c in e.get("concept_ids") or []}
    solved = {e.get("skill") for e in ev if e.get("kind") != "check" and e.get("correct") and e.get("confidence") != "guess"}
    focus = weak or step.get("probe") or step.get("weak")
    pool = ctx.bank(tid, ("quiz",))
    q = select_next(pool, ctx.asked, step.get("difficulty", 2), focus, need_ho, covered, solved_skills=solved)
    if q is None:
        await more_questions(ctx, tid, 4, "quiz")
        q = select_next(ctx.bank(tid, ("quiz",)), ctx.asked, step.get("difficulty", 2), focus, need_ho, covered, solved_skills=solved)
    if q is None:
        return False
    step.setdefault("quizAsked", []).append(q["id"])
    limit = REMEDIATION_QUIZ if step["stage"] == "remediate" else QUIZ_MAX
    ask(ctx, q, "quiz", len(step["quizAsked"]), limit)
    return True


def quiz_decision(ctx: Ctx) -> str:
    """continue | pass | fail — from the evidence, never from a fixed count alone."""
    tid = ctx.progress["currentTopicId"]
    step = ctx.progress["step"]
    asked = step.get("quizAsked") or []
    ev = _topic_evidence(ctx, tid)
    this_quiz = [e for e in ev if e.get("qid") in asked]
    a = mastery.assess(ev)
    n = len(this_quiz)
    acc = sum(e.get("credit", 0) for e in this_quiz) / n if n else 0
    limit = REMEDIATION_QUIZ if step.get("stage") == "remediate" else QUIZ_MAX
    if n >= (REMEDIATION_MIN if step.get("stage") == "remediate" else QUIZ_MIN):
        if a["mastered"]:
            return "pass"
        if acc < 0.5 and sum(1 for e in this_quiz if not e.get("correct")) >= 2:
            return "fail"
    if n >= limit:
        return "pass" if a["mastered"] else "fail"
    return "continue"


def close_topic(ctx: Ctx, mastered: bool, note: str = "") -> None:
    tid = ctx.progress["currentTopicId"]
    topic = ctx.topic(tid)
    ts = ctx.tstate(tid)
    ts["closedAt"] = ctx.iso
    ev = ts.get("evidence") or []
    a = mastery.assess(ev)
    if a["mastered"]:
        mastery.start_review_schedule(ts, ctx.today)
    ctx.progress["step"] = {"stage": "closed"}
    ctx.progress["pending"] = None
    names = {c["id"]: c["name"] for c in topic.get("concepts") or []}
    breakdown = mastery.concept_breakdown([e for e in ev if e.get("kind") != "check"] or ev)
    strong = [names.get(c, c) for c, v in breakdown.items() if (v["score"] or 0) >= 0.8]
    weak = [names.get(c, c) for c in mastery.weak_concepts(ev)]
    ctx.say(
        {
            "type": "topic_summary",
            "topicId": tid,
            "title": topic["title"],
            "mastered": a["mastered"],
            "score": a["score"],
            "confidence": a["confidence"],
            "met": a["met"],
            "missing": a["missing"],
            "strengths": strong[:5],
            "toReview": weak[:5],
            "reviewDue": ts.get("reviewDue"),
            "note": note,
            "keyTerms": topic.get("key_terms") or [],
            "calibration": mastery.calibration(ev),
        },
        actions=_after_topic_actions(ctx),
    )
    ctx.events.append({
        "type": "topic_closed",
        "topic": topic["title"],
        "mastered": a["mastered"],
        "minutes": int(ts.get("activeSec") or 0) / 60,
        "rounds": int(ts.get("remediationRounds") or 0),
    })


def _after_topic_actions(ctx: Ctx) -> list[dict]:
    nxt = _first_open_topic(ctx)
    acts = [_act("next", "الموضوع التالي" if nxt else "إلى الاختبار الشامل")]
    acts.append(_act("save_cards", "أضف مصطلحاته لبطاقات المراجعة"))
    return acts


async def remediate(ctx: Ctx) -> None:
    tid = ctx.progress["currentTopicId"]
    topic = ctx.topic(tid)
    step = ctx.progress["step"]
    ts = ctx.tstate(tid)
    ev = ts.get("evidence") or []
    weak = mastery.weak_concepts(ev) or [c["id"] for c in topic.get("concepts") or []][:2]
    prereq_gap = []
    for pid in topic.get("prerequisites") or []:
        pts = ctx.progress["topics"].get(pid) or {}
        pa = mastery.assess(pts.get("evidence") or [])
        if mastery.status_of(pts, ctx.today) in ("needs_review", "not_started", "in_progress") or (pa["score"] is not None and pa["score"] < 0.6):
            prereq_gap.append(pid)
    diag = diagnose([e for e in ev if e.get("kind") != "check"] or ev, weak, prereq_gap)
    step["stage"] = "remediate"
    step["round"] = int(step.get("round") or 0) + 1
    step["weak"] = weak
    step["strategy"] = diag["strategy"]
    step["quizAsked"] = []
    step["preScore"] = mastery.assess(ev)["score"]
    ts["remediationRounds"] = int(ts.get("remediationRounds") or 0) + 1
    names = {c["id"]: c["name"] for c in topic.get("concepts") or []}
    weak_names = [names.get(c, c) for c in weak]
    reason = mastery.assess(ev)["missing"]
    ctx.say({
        "type": "diagnosis",
        "topicId": tid,
        "weak": weak_names,
        "misconceptions": diag["misconceptions"],
        "strategy": diag["label"],
        "reasons": reason[:3],
        "prerequisites": [ctx.topic(p)["title"] for p in prereq_gap if ctx.topic(p)],
    })
    md, pages, qs = await teach_again(ctx, topic, diag["strategy"], weak, diag["misconceptions"], prereq_topics=[ctx.topic(p) for p in prereq_gap if ctx.topic(p)], n_questions=3)
    ctx.add_extras(tid, qs)
    ctx.say({"type": "lesson", "topicId": tid, "segment": None, "title": "شرح موجّه لنقاط الضعف", "md": md, "pages": pages, "remedial": True})
    ok = await ask_next_quiz(ctx, weak)
    if not ok:
        close_topic(ctx, False, "لم تتوفر أسئلة كافية لإعادة الاختبار الآن.")


async def teach_again(ctx: Ctx, topic: dict, strategy: str, concept_ids: list[str], misconceptions: list[str], prereq_topics: list[dict] | None = None, previous: str = "", n_questions: int = 0) -> tuple[str, list[int], list[dict]]:
    ctx.charge(COST_SMALL)
    names = {c["id"]: c["name"] for c in topic.get("concepts") or []}
    raw = await ai.ask_json(
        prompts.TEACH_AGAIN.format(
            title=topic["title"],
            lecture=ctx.lecture.get("title", ""),
            situation="needs another explanation" if strategy == "alternative" else "did not reach mastery in the quiz",
            strategy=prompts.STRATEGY_TEXT.get(strategy, prompts.STRATEGY_TEXT["reexplain"]),
            concepts=", ".join(f"{c} ({names.get(c, c)})" for c in concept_ids) or "all concepts of the topic",
            misconceptions="؛ ".join(misconceptions) or "—",
            previous=clip(previous, 1500) or "—",
            pages=ctx.topic_pages_text(topic, prereq_topics),
            n_questions=n_questions,
            question_spec=prompts.QUESTION_SPEC.format() if n_questions else "",
        ),
        "Teach it again.",
        schema=schemas.TEACH,
        kind="teach_again",
        temperature=0.5,
        max_tokens=8000,
    )
    raw = raw if isinstance(raw, dict) else {}
    allowed = ctx.all_page_numbers()
    md = strip_bad_refs(clip(raw.get("markdown"), 6000), allowed)
    if len(md) < 30:
        raise TutorError("تعذّر تجهيز شرح بديل الآن. حاول مرة أخرى بعد قليل.", 502)
    pages = valid_pages(raw.get("pages"), allowed) or cited_pages(md)[:6]
    qs = []
    if n_questions:
        qs = _normalize_questions(raw.get("questions"), topic, allowed, "quiz", salt=f"r{int(ctx.progress.get('seq') or 0)}")
        for q in qs:
            q["pool"], q["segment"] = "quiz", None
    return md, pages, qs


# ══════════════════════════════════════════════════════════════════
#  Answers
# ══════════════════════════════════════════════════════════════════


async def grade_text(ctx: Ctx, q: dict, answer: str, attempt: int) -> dict:
    topic = ctx.topic(q["topic_id"])
    ctx.charge(COST_SMALL)
    raw = await ai.ask_json(
        prompts.GRADE.format(
            prompt=q["prompt"],
            model_answer=q.get("model_answer", ""),
            rubric=q.get("rubric") or "—",
            pages=ctx.topic_pages_text(topic)[:8000],
            answer=answer,
            concept_ids=", ".join(q.get("concept_ids") or []) or "—",
            reveal_rule="Do NOT reveal the full expected answer; point to what to rethink."
            if attempt == 1 and q.get("context_check")
            else "You may state the key point of the expected answer.",
        ),
        "Grade the answer.",
        schema=schemas.GRADE,
        kind="grade",
        temperature=0.1,
        max_tokens=3000,
    )
    raw = raw if isinstance(raw, dict) else {}
    try:
        score = max(0.0, min(1.0, float(raw.get("score"))))
    except (TypeError, ValueError):
        raise TutorError("تعذّر تصحيح إجابتك الآن. أعد الإرسال بعد قليل.", 502)
    verdict = raw.get("verdict") if raw.get("verdict") in ("correct", "partial", "incorrect") else ("correct" if score >= 0.8 else "partial" if score >= 0.4 else "incorrect")
    return {
        "valid": True,
        "correct": score >= 0.8,
        "credit": round(score, 2),
        "verdict": verdict,
        "misconception": clip(raw.get("misconception"), 80) if score < 0.8 else "",
        "note": clip(raw.get("feedback"), 1200),
        "missing": [c for c in raw.get("missing_concepts") or [] if c in (q.get("concept_ids") or [])],
    }


def _evidence(q: dict, g: dict, kind: str, hints: int, now: str, confidence: str | None = None) -> dict:
    credit = float(g.get("credit", 1.0 if g["correct"] else 0.0))
    if g["correct"] and hints:
        credit = max(0.5, credit - 0.25 * hints)
    if g["correct"] and confidence == "guess":
        credit = min(credit, 0.5)  # right by luck is not yet knowledge
    concepts = list(q.get("concept_ids") or [])
    return {
        "qid": q["id"],
        "kind": kind,
        "correct": bool(g["correct"]),
        "credit": round(credit, 2),
        "difficulty": q["difficulty"],
        "bloom": q["bloom"],
        "skill": q["skill"],
        "concept_ids": g.get("missing") or concepts if not g["correct"] else concepts,
        "hints": hints,
        "misconception": g.get("misconception") or "",
        "confidence": confidence,
        "ts": now,
    }


async def handle_answer(ctx: Ctx, payload: dict) -> None:
    p = ctx.progress
    pending = p.get("pending")
    qid = str(payload.get("questionId") or "")
    if not pending or pending.get("qid") != qid:
        raise TutorError("هذا السؤال لم يعد مفتوحاً — حدّثت الصفحة؟ تابع من آخر سؤال.", 409)
    q = ctx.question(qid)
    if not q:
        raise TutorError("تعذّر العثور على السؤال. تابع من الزر «التالي».", 409)
    context = pending["context"]
    attempt = int(pending.get("attempts") or 0) + 1
    # How sure the student was (one tap with the answer): separates a lucky
    # guess from knowledge, and a confident mistake from a gap.
    confidence = payload.get("confidence") if payload.get("confidence") in CONFIDENCE else None

    if q["format"] == "choice":
        g = grade_choice(q, payload.get("choice"))
        if not g.get("valid"):
            raise TutorError("اختر إجابة من الخيارات.")
        ctx.student({"type": "answer", "questionId": qid, "text": q["options"][g["picked"]], "choice": g["picked"], "confidence": confidence})
    else:
        text = str(payload.get("text") or "").strip()
        if len(text) < 2:
            raise TutorError("اكتب إجابتك أولاً.")
        text = text[:MAX_ANSWER_CHARS]
        ctx.student({"type": "answer", "questionId": qid, "text": text, "code": q["format"] == "code", "confidence": confidence})
        if match_accepted(q, text):
            g = {"valid": True, "correct": True, "credit": 1.0, "verdict": "correct", "misconception": "", "note": "", "exact": True}
        elif context == "final":
            g = await grade_text(ctx, q, text, attempt)
        else:
            g = await grade_text(ctx, {**q, "context_check": context == "check"}, text, attempt)

    hints = int(pending.get("hints") or 0)
    pending["attempts"] = attempt
    tid = q["topic_id"]
    topic = ctx.topic(tid)

    if context == "final":
        g["confidence"] = confidence
        await _final_answer(ctx, q, g)
        return

    first = attempt == 1
    if first:
        kind = {"check": "check", "quiz": "quiz", "review": "review", "warmup": "review"}[context]
        ev = _evidence(q, g, kind, hints, ctx.iso, confidence)
        mastery.add_evidence(ctx.tstate(tid), ev)
        p["points"] = int(p.get("points") or 0) + mastery.points_for(g["correct"], q["difficulty"], hints, kind)
        names = {c["id"]: c["name"] for c in topic.get("concepts") or []}
        ctx.events.append({
            "type": "answer",
            "topic": topic["title"],
            "concepts": [names.get(c, c) for c in q.get("concept_ids") or []],
            "qid": q["id"],
            "shared": ctx.is_shared(q["id"]),
            "skill": q["skill"],
            "difficulty": q["difficulty"],
            "prompt": q["prompt"],
            "correct": g["correct"],
            "kind": kind,
        })
        if p.get("answeredAny") is not True:
            p["answeredAny"] = True
            ctx.events.append({"type": "new_student"})

    fb = {
        "type": "feedback",
        "questionId": qid,
        "correct": g["correct"],
        "verdict": g.get("verdict") or ("correct" if g["correct"] else "incorrect"),
        "md": g.get("note") or "",
        "misconception": g.get("misconception") or "",
        "confidence": confidence,
    }
    if confidence == "sure" and not g["correct"]:
        fb["confidentError"] = True  # the UI flags it: a belief worth correcting now
    if confidence == "guess" and g["correct"]:
        fb["luckyGuess"] = True

    if context == "check":
        if g["correct"]:
            fb["md"] = (fb["md"] + "\n\n" if fb["md"] and q["format"] != "choice" else "") + (q.get("explanation") or "إجابة صحيحة.")
            p["pending"] = None
            ctx.say(fb, actions=[A_NEXT])
        elif attempt == 1:
            # Not the answer yet: say what is wrong with that reasoning and let them try again.
            fb["md"] = fb["md"] or "ليست هذه الإجابة."
            fb["retry"] = True
            acts = [_act("hint", "تلميح")] if q.get("hints") and hints < len(q["hints"]) else []
            acts.append(_act("reexplain", "اشرحه بطريقة ثانية"))
            acts.append(_act("reveal", "أظهر الإجابة"))
            ctx.say(fb, {"type": "text", "md": "فكّر فيها مرة ثانية وجرّب. أسئلة الشرح للتعلّم، ووزنها في حساب الإتقان أقل من أسئلة الاختبار."}, actions=acts)
        else:
            fb.update(_reveal(q))
            p["pending"] = None
            ctx.say(fb, actions=[A_NEXT, _act("reexplain", "اشرح لي هذا الجزء مرة ثانية")])
        return

    # quiz / review: one attempt, then the answer is shown with the reasoning.
    fb.update(_reveal(q))
    p["pending"] = None
    if context in ("review", "warmup"):
        ts = ctx.tstate(tid)
        try:
            days = (dt.date.fromisoformat(ctx.today) - dt.date.fromisoformat(ts.get("lastReviewedAt") or ctx.today)).days
        except ValueError:
            days = 0
        mastery.schedule_after_review(ts, g["correct"], ctx.today)
        ctx.events.append({"type": "review", "bucket": analytics.retention_bucket(days), "correct": g["correct"]})
        if not g["correct"]:
            fb["md"] = (fb["md"] + "\n\n" if fb["md"] else "") + f"سأعيد «{topic['title']}» لقائمة المراجعة القريبة."
        ctx.say(fb, actions=[A_NEXT])
        return

    step = p["step"]
    step["difficulty"] = next_difficulty(int(step.get("difficulty") or 2), g["correct"])
    # A right answer marked as a guess: probe the same concept in another form.
    step["probe"] = list(q.get("concept_ids") or []) if (g["correct"] and confidence == "guess") else []
    decision = quiz_decision(ctx)
    step["decision"] = decision
    if decision == "continue":
        ctx.say(fb, actions=[_act("next", "السؤال التالي")])
    elif decision == "pass":
        ctx.say(fb, actions=[_act("next", "النتيجة")])
    else:
        ctx.say(fb, actions=[_act("next", "لنعالج نقاط الضعف")])


def _reveal(q: dict) -> dict:
    out: dict[str, Any] = {"explanation": q.get("explanation") or ""}
    if q["format"] == "choice":
        out["correctIndex"] = q["answer_index"]
        out["correctText"] = q["options"][q["answer_index"]]
    else:
        out["modelAnswer"] = q.get("model_answer", "")
    return out


# ══════════════════════════════════════════════════════════════════
#  "next" — what happens after the student is ready to move on
# ══════════════════════════════════════════════════════════════════


async def handle_next(ctx: Ctx) -> None:
    p = ctx.progress
    if p.get("pending"):
        if p["pending"]["context"] == "check" and p["pending"].get("attempts"):
            # Wrong once and chose to move on: count nothing more, show the answer.
            q = ctx.question(p["pending"]["qid"])
            p["pending"] = None
            if q:
                ctx.say({"type": "feedback", "questionId": q["id"], "correct": False, "verdict": "skipped", "md": "", **_reveal(q)})
        else:
            raise TutorError("أجب عن السؤال أولاً، أو اطلب تلميحاً.")

    phase = p.get("phase")
    if phase == "review" and p.get("review"):
        await continue_review(ctx)
        return
    if phase in ("overview", None):
        tid = _first_open_topic(ctx)
        if tid:
            enter_topic(ctx, tid)
        else:
            offer_final(ctx)
        return
    if phase == "final_ready":
        await start_final(ctx)
        return
    if phase == "final":
        raise TutorError("أنت داخل الاختبار الشامل — أجب عن السؤال الحالي.")
    if phase == "done":
        tid = _first_open_topic(ctx)
        if tid:
            enter_topic(ctx, tid)
        else:
            ctx.say({"type": "text", "md": "أنهيت المحاضرة. راجع خطة المراجعة أعلاه، أو أعد الاختبار الشامل بأسئلة جديدة."}, actions=[_act("final", "اختبار شامل جديد")])
        return

    step = p.get("step") or {}
    stage = step.get("stage")
    if stage == "warmup":
        queue = list(step.get("warmup") or [])
        nxt = ctx.question(queue.pop(0)) if queue else None
        step["warmup"] = queue
        if nxt:
            total = int((p.get("pending") or {}).get("total") or 2)
            ask(ctx, nxt, "warmup", total - len(queue), total)
        else:
            show_goal(ctx, p["currentTopicId"])
    elif stage == "goal":
        await show_segment(ctx, 0)
    elif stage in ("explain", "check"):
        lesson = await ensure_lesson(ctx, p["currentTopicId"])
        seg = int(step.get("segment") or 0)
        if seg + 1 < len(lesson["segments"]):
            await show_segment(ctx, seg + 1)
        else:
            await start_quiz(ctx)
    elif stage in ("quiz", "remediate"):
        decision = step.get("decision") or "continue"
        if decision == "continue":
            if not await ask_next_quiz(ctx, step.get("weak")):
                close_topic(ctx, mastery.assess(_topic_evidence(ctx, p["currentTopicId"]))["mastered"], "انتهت الأسئلة المتاحة لهذا الموضوع.")
            step["decision"] = None
            return
        tid = p["currentTopicId"]
        if stage == "remediate":
            pre = step.get("preScore")
            post = mastery.assess(_topic_evidence(ctx, tid))["score"]
            ctx.events.append({"type": "remediation_result", "strategy": step.get("strategy") or "reexplain", "improved": decision == "pass" or (pre is not None and post is not None and post > pre + 0.05)})
        if decision == "pass":
            close_topic(ctx, True)
        elif int(step.get("round") or 0) >= MAX_ROUNDS:
            close_topic(ctx, False, "جرّبنا أكثر من طريقة ولم يكتمل الإتقان بعد — لن أوقفك هنا: سنكمل، وسيعود هذا الموضوع في المراجعة والاختبار الشامل.")
        else:
            await remediate(ctx)
    elif stage == "closed":
        tid = _next_topic_after(ctx, p.get("currentTopicId"))
        if tid:
            enter_topic(ctx, tid)
        else:
            offer_final(ctx)
    else:
        tid = _first_open_topic(ctx)
        enter_topic(ctx, tid) if tid else offer_final(ctx)


def _next_topic_after(ctx: Ctx, tid: str | None) -> str | None:
    ids = ctx.topic_ids
    start = ids.index(tid) + 1 if tid in ids else 0
    for x in ids[start:] + ids[:start]:
        if mastery.status_of(ctx.progress["topics"].get(x) or {}, ctx.today) in ("not_started", "in_progress"):
            return x
    return None


async def handle_test_out(ctx: Ctx) -> None:
    step = ctx.progress.get("step") or {}
    if ctx.progress.get("phase") != "topic" or step.get("stage") not in ("goal", "explain", "check"):
        raise TutorError("يمكنك طلب الاختبار المباشر في بداية الموضوع فقط.")
    if ctx.progress.get("pending"):
        ctx.progress["pending"] = None
    ctx.student({"type": "request", "text": "أعرف هذا الموضوع — اختبرني مباشرة"})
    await ensure_lesson(ctx, ctx.progress["currentTopicId"])
    step["testOut"] = True
    await start_quiz(ctx)


# ══════════════════════════════════════════════════════════════════
#  Hints, re-explanations, questions, navigation
# ══════════════════════════════════════════════════════════════════


def handle_hint(ctx: Ctx) -> None:
    pending = ctx.progress.get("pending")
    if not pending or pending["context"] == "final":
        raise TutorError("لا يوجد سؤال مفتوح يقبل التلميح الآن.")
    q = ctx.question(pending["qid"])
    hints = q.get("hints") or [] if q else []
    used = int(pending.get("hints") or 0)
    ctx.student({"type": "request", "text": "تلميح من فضلك"})
    if used >= len(hints):
        ctx.say({"type": "hint", "md": "استخدمت كل التلميحات المتاحة. ارجع لصفحات الشرح المشار إليها في السؤال، أو اطلب شرحاً بطريقة ثانية.", "last": True})
        return
    pending["hints"] = used + 1
    acts = [_act("hint", "تلميح أقوى")] if used + 1 < len(hints) else None
    ctx.say({"type": "hint", "md": hints[used], "index": used + 1, "total": len(hints)}, actions=acts)


def handle_reveal(ctx: Ctx) -> None:
    pending = ctx.progress.get("pending")
    if not pending or pending["context"] != "check" or not pending.get("attempts"):
        raise TutorError("تظهر الإجابة بعد محاولتك الأولى في أسئلة الشرح فقط.")
    q = ctx.question(pending["qid"])
    ctx.progress["pending"] = None
    ctx.student({"type": "request", "text": "أظهر الإجابة"})
    ctx.say({"type": "feedback", "questionId": q["id"], "correct": False, "verdict": "revealed", "md": "", **_reveal(q)}, actions=[A_NEXT, _act("reexplain", "اشرح لي هذا الجزء مرة ثانية")])


async def handle_reexplain(ctx: Ctx) -> None:
    p = ctx.progress
    step = p.get("step") or {}
    tid = p.get("currentTopicId")
    if p.get("phase") != "topic" or not tid or step.get("stage") not in ("explain", "check", "goal", "closed", "quiz", "remediate"):
        raise TutorError("اطلب إعادة الشرح أثناء دراسة موضوع.")
    if step.get("stage") in ("quiz", "remediate") and p.get("pending"):
        raise TutorError("أنت داخل اختبار الإتقان — أجب أولاً، وسأعيد الشرح إذا احتجت.")
    lesson = await ensure_lesson(ctx, tid)
    seg = max(0, int(step.get("segment") or 0))
    seg = min(seg, len(lesson["segments"]) - 1)
    ctx.student({"type": "request", "text": "اشرحه بطريقة ثانية"})
    seen = list(step.get("variantsSeen") or [])
    variants = (lesson.get("variants") or {}).get(str(seg)) or []
    unseen = [i for i in range(len(variants)) if f"{seg}:{i}" not in seen]
    if unseen:  # an alternative explanation made earlier for this file — free
        i = unseen[0]
        md, pages = variants[i]["md"], variants[i]["pages"]
        seen.append(f"{seg}:{i}")
    else:
        topic = ctx.topic(tid)
        s = lesson["segments"][seg]
        md, pages, _ = await teach_again(ctx, topic, "alternative", s.get("concept_ids") or [], [], previous=s["markdown"])
        variants = variants + [{"md": md, "pages": pages}]
        lesson.setdefault("variants", {})[str(seg)] = variants[-4:]
        store.save_lesson(ctx.db, ctx.lecture["fileHash"], tid, lesson)
        seen.append(f"{seg}:{len(variants) - 1}")
    step["variantsSeen"] = seen[-20:]
    ts = ctx.tstate(tid)
    ts["reexplains"] = int(ts.get("reexplains") or 0) + 1
    acts = None if p.get("pending") else [A_NEXT]
    ctx.say({"type": "lesson", "topicId": tid, "segment": seg, "total": len(lesson["segments"]), "title": "بطريقة ثانية", "md": md, "pages": pages, "alternative": True}, actions=acts)
    if p.get("pending"):
        q = ctx.question(p["pending"]["qid"])
        if q:
            ctx.say({"type": "text", "md": "الآن جرّب السؤال مرة ثانية 👇"}, question_block(q, p["pending"]["context"]))


async def handle_ask(ctx: Ctx, payload: dict) -> None:
    text = str(payload.get("text") or "").strip()
    if len(text) < 2:
        raise TutorError("اكتب سؤالك.")
    text = text[:1500]
    topic = ctx.topic(ctx.progress.get("currentTopicId")) or ctx.lecture["topics"][0]
    ctx.student({"type": "text", "md": text})
    ctx.charge(COST_SMALL)
    outline = "؛ ".join(f"{t['title']} (ص {t['pages'][0]}–{t['pages'][1]})" for t in ctx.lecture["topics"])
    # The current topic's pages plus any page whose text shares words with the question.
    words = {w for w in text.replace("؟", " ").split() if len(w) > 3}
    related = []
    for pg in ctx.pages():
        if pg.n < topic["pages"][0] or pg.n > topic["pages"][1]:
            hits = sum(1 for w in words if w in (pg.text or ""))
            if hits >= 2:
                related.append((hits, pg.n))
    extra = [ctx.pages()[n - 1] for _, n in sorted(related, reverse=True)[:3]]
    pages_text = ctx.topic_pages_text(topic) + ("\n\n" + "\n\n".join(page_block(pg, 3000) for pg in extra) if extra else "")
    raw = await ai.ask_json(
        prompts.ASK.format(lecture=ctx.lecture.get("title", ""), title=topic["title"], outline=outline, pages=pages_text, question=text),
        "Answer the student's question.",
        schema=schemas.ASK,
        kind="ask",
        temperature=0.3,
        max_tokens=4000,
    )
    raw = raw if isinstance(raw, dict) else {}
    allowed = ctx.all_page_numbers()
    md = strip_bad_refs(clip(raw.get("markdown"), 5000), allowed)
    if not md:
        raise TutorError("تعذّر الإجابة الآن. أعد السؤال بعد قليل.", 502)
    ctx.say(
        {"type": "answer_text", "md": md, "pages": valid_pages(raw.get("pages"), allowed) or cited_pages(md)[:6], "inLecture": raw.get("in_lecture") is not False},
    )
    ts = ctx.tstate(topic["id"]) if ctx.progress.get("currentTopicId") else None
    if ts is not None:
        ts["questionsAsked"] = int(ts.get("questionsAsked") or 0) + 1
    pending = ctx.progress.get("pending")
    if pending:
        q = ctx.question(pending["qid"])
        if q:
            ctx.say({"type": "text", "md": "نرجع للسؤال المفتوح 👇"}, question_block(q, pending["context"], pending.get("index"), pending.get("total")))


REPORT_REASONS = {
    "wrong_key": "الإجابة المعتمدة خاطئة",
    "unclear": "السؤال غير واضح",
    "off_lecture": "ليس من المحاضرة",
}
QUARANTINE_AFTER = 3  # reports from different students before a shared question is retired


def handle_report(ctx: Ctx, payload: dict) -> None:
    """A student flags a question. It stops counting for them at once (its
    answer leaves the mastery evidence) and is never asked to them again;
    after QUARANTINE_AFTER students report it, nobody gets it any more."""
    p = ctx.progress
    qid = str(payload.get("questionId") or "")
    reason = payload.get("reason") if payload.get("reason") in REPORT_REASONS else "unclear"
    q = ctx.question(qid)
    if not q or qid not in ctx.asked:
        raise TutorError("لا يمكن الإبلاغ عن سؤال لم يُعرض عليك.")
    reported = list(p.get("reported") or [])
    if qid in reported:
        raise TutorError("أبلغت عن هذا السؤال من قبل — شكراً لك.")
    p["reported"] = reported + [qid]
    ctx.student({"type": "request", "text": f"إبلاغ عن السؤال: {REPORT_REASONS[reason]}"})

    # Its answer no longer counts towards mastery.
    ts = ctx.tstate(q["topic_id"])
    kept = [e for e in ts.get("evidence") or [] if e.get("qid") != qid]
    removed = len(ts.get("evidence") or []) - len(kept)
    if removed:
        ts["evidence"] = kept
        ts["attempts"] = sum(1 for _ in kept)
        ts["correct"] = sum(1 for e in kept if e.get("correct"))
        ts["wrong"] = ts["attempts"] - ts["correct"]

    # Anonymous count on the shared question; retire it after enough reports.
    if ctx.is_shared(qid):
        lesson = ctx.lesson(q["topic_id"])
        for item in lesson.get("questions") or []:
            if item["id"] == qid:
                item["reports"] = int(item.get("reports") or 0) + 1
                item.setdefault("reportReasons", {})[reason] = int(item.get("reportReasons", {}).get(reason, 0)) + 1
                if item["reports"] >= QUARANTINE_AFTER:
                    item["disabled"] = True
        store.save_lesson(ctx.db, ctx.lecture["fileHash"], q["topic_id"], lesson)
    ctx.events.append({"type": "report", "qid": qid, "topic": ctx.topic(q["topic_id"])["title"], "prompt": q["prompt"], "reason": reason})

    pending = p.get("pending")
    note = "شكراً — استبعدت هذا السؤال" + (" وأزلت إجابتك عنه من حساب الإتقان." if removed else ".")
    if pending and pending.get("qid") == qid:
        p["pending"] = None
        ctx_ = pending["context"]
        if ctx_ == "final":
            f = p["final"]
            f["questionIds"] = [x for x in f["questionIds"] if x != qid]
            f["total"] = len(f["questionIds"])
            ctx.say({"type": "text", "md": note + " ننتقل للسؤال التالي في الاختبار."})
            if f["index"] < f["total"]:
                nxt = ctx.question(f["questionIds"][f["index"]])
                ask(ctx, nxt, "final", f["index"] + 1, f["total"])
            else:
                _finish_final(ctx)
            return
        if ctx_ == "quiz":
            step = p.get("step") or {}
            step["quizAsked"] = [x for x in step.get("quizAsked") or [] if x != qid]
            step["decision"] = "continue"
        ctx.say({"type": "text", "md": note}, actions=[A_NEXT])
        return
    ctx.say({"type": "text", "md": note})


def handle_goto(ctx: Ctx, payload: dict) -> None:
    tid = str(payload.get("topicId") or "")
    if not ctx.topic(tid):
        raise TutorError("الموضوع غير موجود.")
    if ctx.progress.get("phase") == "final":
        raise TutorError("أنهِ الاختبار الشامل أولاً، أو أوقفه من زر «إيقاف الاختبار».")
    pending = ctx.progress.get("pending")
    ctx.student({"type": "request", "text": f"انتقل إلى: {ctx.topic(tid)['title']}"})
    if pending and pending["context"] in ("quiz",):
        ctx.say({"type": "notice", "tone": "info", "md": "أوقفنا اختبار الإتقان للموضوع السابق؛ يبقى «قيد الدراسة» وتكمله متى رجعت له."})
    ts = ctx.tstate(tid)
    if mastery.status_of(ts, ctx.today) != "in_progress":
        ts.pop("closedAt", None)  # restudying a closed topic reopens it; its evidence stays
    enter_topic(ctx, tid)


# ══════════════════════════════════════════════════════════════════
#  Spaced review
# ══════════════════════════════════════════════════════════════════


async def start_review(ctx: Ctx) -> None:
    due = mastery.due_reviews(ctx.progress.get("topics") or {}, ctx.today)
    if not due:
        raise TutorError("لا توجد مراجعات مستحقة الآن.")
    p = ctx.progress
    if p.get("pending") and p["pending"]["context"] in ("quiz", "final"):
        raise TutorError("أكمل السؤال الحالي أولاً.")
    p["review"] = {"queue": due[:4], "returnPhase": p.get("phase"), "returnTopic": p.get("currentTopicId"), "returnStep": p.get("step"), "returnPending": p.get("pending")}
    p["pending"] = None
    p["phase"] = "review"
    ctx.say({"type": "text", "md": f"**مراجعة سريعة ({len(p['review']['queue'])})** — سؤال واحد من كل موضوع أتقنته سابقاً، حتى لا يضيع مع الوقت."})
    await continue_review(ctx)


async def continue_review(ctx: Ctx) -> None:
    p = ctx.progress
    r = p["review"]
    while r["queue"]:
        tid = r["queue"].pop(0)
        if not ctx.lesson(tid):
            continue
        pool = ctx.bank(tid, ("quiz",))
        q = select_next(pool, ctx.asked, 2, need_higher_order=True)
        if q is None:
            used = [x for x in pool if x["id"] in ctx.asked]
            q = used[0] if used else None  # retrieval practice may reuse an old question
        if q is None:
            continue
        p["currentTopicId"] = tid
        ctx.say({"type": "text", "md": f"من موضوع: **{ctx.topic(tid)['title']}**"})
        ask(ctx, q, "review")
        return
    # Back to where the student was.
    p["phase"] = r.get("returnPhase") or "overview"
    p["currentTopicId"] = r.get("returnTopic")
    p["step"] = r.get("returnStep") or {}
    p["pending"] = r.get("returnPending")
    p["review"] = None
    ctx.say({"type": "text", "md": "انتهت المراجعة. نكمل من حيث توقفنا."}, actions=[A_NEXT] if not p.get("pending") else None)
    if p.get("pending"):
        q = ctx.question(p["pending"]["qid"])
        if q:
            ctx.say(question_block(q, p["pending"]["context"], p["pending"].get("index"), p["pending"].get("total")))


# ══════════════════════════════════════════════════════════════════
#  Final exam
# ══════════════════════════════════════════════════════════════════


def offer_final(ctx: Ctx) -> None:
    p = ctx.progress
    p["phase"] = "final_ready"
    p["pending"] = None
    p["currentTopicId"] = None
    view = progress_view(ctx)
    weak = [ctx.topic(t)["title"] for t, v in view.items() if v["status"] == "needs_review"]
    md = "أنهيت كل موضوعات المحاضرة 👏 الآن **الاختبار الشامل**: أسئلة جديدة موزّعة حسب أهمية الموضوعات، بدون تلميحات، والنتيجة تظهر في النهاية مع خطة مراجعة."
    if weak:
        md += f"\n\nموضوعات ما زالت تحتاج مراجعة: {'، '.join(weak)} — سيشملها الاختبار."
    ctx.say({"type": "text", "md": md}, actions=[_act("final", "ابدأ الاختبار الشامل")])


async def start_final(ctx: Ctx) -> None:
    p = ctx.progress
    if p.get("pending") and p["pending"]["context"] != "final":
        p["pending"] = None
    plan = exam_blueprint(ctx.lecture["topics"])
    chosen: list[dict] = []
    for t in ctx.lecture["topics"]:
        need = plan.get(t["id"], 1)
        pool = ctx.bank(t["id"], ("final", "quiz"))
        picked = pick_for_exam(pool, ctx.asked, need)
        if len(picked) < need:
            await more_questions(ctx, t["id"], max(2, need - len(picked) + 1), "final")
            picked = pick_for_exam(ctx.bank(t["id"], ("final", "quiz")), ctx.asked, need)
        chosen += picked
    if not chosen:
        raise TutorError("تعذّر تجهيز أسئلة الاختبار الآن. حاول بعد قليل.", 502)
    # Interleave topics (not all questions of one topic in a row).
    by_topic: dict[str, list[dict]] = {}
    for q in chosen:
        by_topic.setdefault(q["topic_id"], []).append(q)
    order: list[dict] = []
    while any(by_topic.values()):
        for tid in list(by_topic):
            if by_topic[tid]:
                order.append(by_topic[tid].pop(0))
    attempt = int((p.get("final") or {}).get("attempt") or 0) + 1
    history = list((p.get("final") or {}).get("history") or [])
    p["final"] = {"status": "running", "questionIds": [q["id"] for q in order], "index": 0, "total": len(order), "answers": {}, "attempt": attempt, "startedAt": ctx.iso, "history": history}
    p["phase"] = "final"
    p["currentTopicId"] = None
    ctx.say({"type": "text", "md": f"**الاختبار الشامل — المحاولة {attempt}** · {len(order)} سؤالاً. خذ وقتك، ولن تظهر الإجابات إلا في النهاية."})
    ask(ctx, order[0], "final", 1, len(order))


async def _final_answer(ctx: Ctx, q: dict, g: dict) -> None:
    p = ctx.progress
    f = p["final"]
    f["answers"][q["id"]] = {"correct": bool(g["correct"]), "credit": float(g.get("credit", 1.0 if g["correct"] else 0.0)), "misconception": g.get("misconception") or "", "note": g.get("note") or "", "picked": g.get("picked"), "confidence": g.get("confidence")}
    tid = q["topic_id"]
    topic = ctx.topic(tid)
    mastery.add_evidence(ctx.tstate(tid), _evidence(q, g, "final", 0, ctx.iso, g.get("confidence")))
    p["points"] = int(p.get("points") or 0) + mastery.points_for(g["correct"], q["difficulty"], 0, "final")
    names = {c["id"]: c["name"] for c in topic.get("concepts") or []}
    ctx.events.append({"type": "answer", "topic": topic["title"], "concepts": [names.get(c, c) for c in q.get("concept_ids") or []], "qid": q["id"], "shared": ctx.is_shared(q["id"]), "skill": q["skill"], "difficulty": q["difficulty"], "prompt": q["prompt"], "correct": g["correct"], "kind": "final"})
    f["index"] = int(f.get("index") or 0) + 1
    p["pending"] = None
    if f["index"] < f["total"]:
        nxt = ctx.question(f["questionIds"][f["index"]])
        ctx.say({"type": "text", "md": "سُجّلت إجابتك ✓"})
        ask(ctx, nxt, "final", f["index"] + 1, f["total"])
        return
    _finish_final(ctx)


def _finish_final(ctx: Ctx) -> None:
    p = ctx.progress
    f = p["final"]
    report = final_report(ctx)
    f["status"] = "done"
    f["result"] = {"score": report["score"], "byTopic": {t["topicId"]: t["score"] for t in report["topics"]}}
    f["history"] = (f.get("history") or []) + [{"attempt": f["attempt"], "score": report["score"], "at": ctx.iso}]
    p["phase"] = "done"
    ctx.events.append({"type": "final", "attempt": f["attempt"], "score": report["score"]})
    ctx.say(report, actions=[_act("final", "اختبار شامل جديد بأسئلة مختلفة"), _act("save_cards", "أضف مصطلحات المحاضرة لبطاقات المراجعة")])


def final_report(ctx: Ctx) -> dict:
    p = ctx.progress
    f = p["final"]
    answers = f["answers"]
    rows = []
    total_w = got_w = 0.0
    plan = []
    bloom_tot: dict[str, list[int]] = {}
    for t in ctx.lecture["topics"]:
        qs = [ctx.question(qid) for qid in f["questionIds"]]
        qs = [q for q in qs if q and q["topic_id"] == t["id"]]
        if not qs:
            continue
        w = sum(1 + 0.25 * (q["difficulty"] - 1) for q in qs)
        got = sum((1 + 0.25 * (q["difficulty"] - 1)) * answers.get(q["id"], {}).get("credit", 0) for q in qs)
        total_w += w * t["importance"]
        got_w += got * t["importance"]
        score = round(got / w, 3) if w else None
        names = {c["id"]: c["name"] for c in t.get("concepts") or []}
        wrong = [q for q in qs if not answers.get(q["id"], {}).get("correct")]
        missed = sorted({names.get(c, c) for q in wrong for c in q.get("concept_ids") or []})
        misconceptions = sorted({answers[q["id"]]["misconception"] for q in wrong if answers.get(q["id"], {}).get("misconception")})
        for q in qs:
            b = bloom_tot.setdefault(q["bloom"], [0, 0])
            b[0] += 1
            b[1] += 1 if answers.get(q["id"], {}).get("correct") else 0
        # Why — from the evidence, in words.
        why = []
        low = [q for q in qs if q["bloom"] in ("remember", "understand")]
        high = [q for q in qs if q["bloom"] in ("apply", "analyze")]
        if wrong and high and all(not answers.get(q["id"], {}).get("correct") for q in high) and any(answers.get(q["id"], {}).get("correct") for q in low):
            why.append("تفهم التعريفات لكن التطبيق على مواقف جديدة لم يثبت بعد")
        if misconceptions:
            why.append("خلط متكرر: " + "؛ ".join(misconceptions[:2]))
        if missed:
            why.append("المفاهيم التي فاتتك: " + "، ".join(missed[:4]))
        ts = p["topics"].get(t["id"]) or {}
        earlier = [e for e in ts.get("evidence") or [] if e.get("kind") in ("quiz", "review")]
        earlier_score = mastery.score_of(earlier)
        if earlier_score is not None and score is not None and earlier_score >= 0.8 and score < 0.6:
            why.append("كنت متقناً له أثناء الدراسة ثم تراجع — علامة نسيان، والحل مراجعة متباعدة")
        if not earlier and not ts.get("visitedAt"):
            why.append("لم تدرس هذا الموضوع داخل الجلسة")
        a, b = t["pages"]
        if score is not None and score < 0.6:
            action, due = f"أعد دراسة الموضوع (ص {a}–{b}) مع الشرح الموجّه ثم أسئلة تطبيق", ctx.today
            ts.pop("closedAt", None) if not mastery.assess(ts.get("evidence") or [])["mastered"] else None
            ts["reviewDue"] = ctx.today
        elif score is not None and score < 0.8:
            action, due = "تدريب مستقل: أعد أسئلة الإتقان وراجع بطاقات المصطلحات", mastery.add_days(ctx.today, 1)
            ts["reviewDue"] = due
        else:
            mastery.schedule_after_review(ts, True, ctx.today)
            action, due = "مراجعة متباعدة فقط", ts.get("reviewDue")
        rows.append({"topicId": t["id"], "title": t["title"], "score": score, "questions": len(qs), "correct": len(qs) - len(wrong), "why": why, "missedConcepts": missed[:6], "misconceptions": misconceptions[:3]})
        plan.append({"topicId": t["id"], "title": t["title"], "action": action, "due": due, "pages": t["pages"], "priority": 0 if score is not None and score < 0.6 else 1 if score is not None and score < 0.8 else 2})
    plan.sort(key=lambda x: (x["priority"], x["due"] or ""))
    overall = round(got_w / total_w, 3) if total_w else 0.0
    history = f.get("history") or []
    change = None
    if history:
        change = round(overall - float(history[-1].get("score") or 0), 3)
    return {
        "type": "final_report",
        "score": overall,
        "attempt": f["attempt"],
        "change": change,
        "topics": rows,
        "strengths": [r["title"] for r in rows if (r["score"] or 0) >= 0.8],
        "weaknesses": [r["title"] for r in rows if (r["score"] or 0) < 0.6],
        "byLevel": {k: {"label": mastery.BLOOM_AR.get(k, k), "total": v[0], "correct": v[1]} for k, v in bloom_tot.items()},
        "calibration": mastery.calibration([
            {"confidence": a.get("confidence"), "correct": a.get("correct")} for a in answers.values()
        ]),
        "plan": plan,
    }


# ══════════════════════════════════════════════════════════════════
#  Entry point
# ══════════════════════════════════════════════════════════════════

ACTIONS = ("begin", "next", "answer", "hint", "reveal", "reexplain", "ask", "goto", "test_out", "review", "final", "abort_final", "save_cards", "report")


async def run_action(ctx: Ctx, action: str, payload: dict) -> None:
    if action not in ACTIONS:
        raise TutorError("إجراء غير معروف.")
    _track_time(ctx)
    p = ctx.progress
    if action == "begin":
        if p.get("seq"):
            return  # already started — the client just reloads the state
        ctx.say({"type": "text", "md": f"أهلاً 👋 قرأت المحاضرة **{ctx.lecture.get('title', '')}** ورتّبتها في موضوعات. سندرسها موضوعاً موضوعاً: شرح قصير، سؤال للتأكد، ثم اختبار إتقان. ما ننتقل إلا إذا ثبت فهمك."})
        notice = extraction_notice(ctx.lecture)
        ctx.say(map_block(ctx), notice, actions=[_act("next", "ابدأ الموضوع الأول")])
        return
    if action == "next":
        await handle_next(ctx)
    elif action == "answer":
        await handle_answer(ctx, payload)
    elif action == "hint":
        handle_hint(ctx)
    elif action == "reveal":
        handle_reveal(ctx)
    elif action == "reexplain":
        await handle_reexplain(ctx)
    elif action == "ask":
        await handle_ask(ctx, payload)
    elif action == "goto":
        handle_goto(ctx, payload)
    elif action == "report":
        handle_report(ctx, payload)
    elif action == "test_out":
        await handle_test_out(ctx)
    elif action == "review":
        await start_review(ctx)
    elif action == "final":
        if p.get("phase") == "final":
            raise TutorError("الاختبار الشامل جارٍ بالفعل.")
        if p.get("pending") and p["pending"]["context"] in ("quiz", "review"):
            raise TutorError("أكمل السؤال الحالي أولاً.")
        ctx.student({"type": "request", "text": "ابدأ الاختبار الشامل"})
        await start_final(ctx)
    elif action == "abort_final":
        if p.get("phase") != "final":
            raise TutorError("لا يوجد اختبار شامل جارٍ.")
        p["final"]["status"] = "aborted"
        p["phase"] = "final_ready"
        p["pending"] = None
        ctx.say({"type": "text", "md": "أوقفت الاختبار. الإجابات التي سجلتها تبقى ضمن أدلة الإتقان، وتقدر تبدأ اختباراً جديداً متى ما حبيت."}, actions=[_act("final", "ابدأ الاختبار الشامل")])
    elif action == "save_cards":
        pass  # handled in the browser (studyStore); nothing to change server-side


def snapshot(ctx: Ctx, messages: list[dict]) -> dict:
    return {"lecture": store.public_lecture(ctx.lecture), "state": public_state(ctx), "messages": messages}
