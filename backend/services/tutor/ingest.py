"""
Lecture PDF → structured lecture the tutor can teach from.

  1. extract  (pdfplumber, free)   text / tables / images for every page
  2. vision   (model, only if needed) the pages without a usable text layer
              are cut into a small PDF and read by the model — never the
              whole file
  3. structure (model)              topics in order, with page ranges,
              objectives, concepts, prerequisites, importance, time
              — long lectures go in batches of pages
  4. validate (code)                page ranges clamped, every page with
              content attached to a topic, ids assigned, sizes capped

Unreadable pages are reported, never filled in.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Any, Callable, Protocol

from fastapi import HTTPException

from services.tutor import ai, prompts, schemas, source
from services.tutor.extract import (
    ExtractError,
    PageContent,
    letter_count,
    page_block,
    sub_pdf,
)
from services.tutor.questions import clip

logger = logging.getLogger(__name__)

VISION_MAX_PAGES = 30
BATCH_PAGES = 40
SINGLE_CALL_MAX_PAGES = 45
STRUCTURE_CHAR_BUDGET = 150_000
MAX_TOPICS = 12
MIN_MINUTES, MAX_MINUTES = 5, 40


class IngestError(Exception):
    """`str(exc)` is a short code mapped to an Arabic message by the router."""


def file_hash(pdf: bytes) -> str:
    return hashlib.sha256(pdf).hexdigest()


def lecture_id_for(digest: str) -> str:
    return "L" + digest[:20]


# ── 2. vision for pages without a text layer ─────────────────────


# Pages per vision request. Measured: one request with many dense scanned
# pages (code, tables) can run past the timeout, and then every page in it
# is lost. Small batches fail alone and let the progress move page by page.
VISION_BATCH = 6


async def read_visual_pages(
    pdf: bytes,
    pages: list[PageContent],
    progress: Callable[[str, int, int], None] | None = None,
    *,
    tried: set[int] | None = None,
    on_batch: Callable[[list[int]], None] | None = None,
    subset: Callable[[bytes, list[int]], bytes] = sub_pdf,
) -> dict[str, Any]:
    """Read the pages without a usable text layer, a few at a time.

    `tried`: pages already sent in an earlier run of this preparation (a
    resumed job) — they are not sent again. `on_batch(batch)` is told after
    each batch so the work done so far can be saved."""
    tried = set(tried or ())
    wanted = [p.n for p in pages if p.needs_vision]
    report = {"requested": len(wanted), "read": [], "failed": [], "skipped": []}
    if not wanted:
        return report
    todo, skipped = wanted[:VISION_MAX_PAGES], wanted[VISION_MAX_PAGES:]
    report["skipped"] = skipped
    already = [n for n in todo if n in tried]
    rest = [n for n in todo if n not in tried]
    for start in range(0, len(rest), VISION_BATCH):
        batch = rest[start : start + VISION_BATCH]
        if progress:
            progress("vision", len(already) + start, len(todo))
        await _read_vision_batch(pdf, pages, batch, subset)
        if on_batch:
            on_batch(batch)
    by_n = {p.n: p for p in pages}
    report["read"] = sorted(n for n in todo if by_n[n].source == "vision")
    report["failed"] = [n for n in todo if by_n[n].source != "vision"]
    return report


async def _read_vision_batch(pdf: bytes, pages: list[PageContent], batch: list[int], subset: Callable[[bytes, list[int]], bytes] = sub_pdf) -> list[int]:
    """Read one small batch of scanned pages; returns the pages it could read."""
    try:
        small = await asyncio.to_thread(subset, pdf, batch)
        raw = await ai.ask_json(
            prompts.VISION.format(pages=", ".join(f"صفحة {n}" for n in batch)),
            "Read the attached pages.",
            pdf=small,
            schema=schemas.VISION,
            kind="vision",
            temperature=0.1,
            max_tokens=16000,
        )
    except (HTTPException, Exception) as exc:  # vision is best-effort
        logger.warning("[tutor.ingest] vision failed for pages %s: %s", batch, getattr(exc, "detail", exc))
        return []

    by_n = {p.n: p for p in pages}
    got = raw.get("pages") if isinstance(raw, dict) else None
    seen: set[int] = set()
    for item in got or []:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if not 1 <= idx <= len(batch):
            continue
        p = by_n[batch[idx - 1]]
        text = clip(item.get("text"), 5000)
        visual = clip(item.get("visual"), 1500)
        if item.get("readable") is False or not (letter_count(text) or visual):
            continue
        if letter_count(text) > letter_count(p.text):
            p.text = text
        p.visual = visual
        p.source = "vision"
        seen.add(p.n)
    return sorted(seen)


# ── 3. structure ──────────────────────────────────────────────────


def _pages_text(pages: list[PageContent], budget: int) -> str:
    per = max(400, min(5000, budget // max(1, len(pages))))
    return "\n\n".join(page_block(p, per) for p in pages)


def _batches(pages: list[PageContent]) -> list[list[PageContent]]:
    if len(pages) <= SINGLE_CALL_MAX_PAGES:
        return [pages]
    return [pages[i : i + BATCH_PAGES] for i in range(0, len(pages), BATCH_PAGES)]


async def structure(
    pages: list[PageContent],
    progress: "Progress | None" = None,
    *,
    done_parts: list[dict] | None = None,
    on_part: Callable[[list[dict]], None] | None = None,
) -> dict[str, Any]:
    """Organise the lecture into topics, one model call per part of a long
    lecture. `done_parts`: the model's answers for the first parts from an
    earlier run (a resumed job) — not asked again. `on_part(parts)` is told
    after each new answer so it can be saved."""
    batches = _batches(pages)
    parts: list[dict] = list(done_parts or [])[: len(batches)]
    title, overview, raw_topics, unclear = "", "", [], []
    for k, batch in enumerate(batches):
        if k < len(parts):
            raw = parts[k]
        else:
            if progress:
                progress("structure", k, len(batches))
            raw = await _structure_part(batch, k, batches, raw_topics)
            parts.append(raw if isinstance(raw, dict) else {})
            if on_part:
                on_part(parts)
        if not isinstance(raw, dict):
            continue
        title = title or clip(raw.get("title"), 160)
        overview = overview or clip(raw.get("overview"), 600)
        offset = len(raw_topics)
        for t in raw.get("topics") or []:
            if isinstance(t, dict):
                t = dict(t)
                t["prerequisites"] = [
                    int(i) + offset for i in (t.get("prerequisites") or []) if isinstance(i, (int, float)) or str(i).isdigit()
                ]
                raw_topics.append(t)
        unclear += [u for u in raw.get("unclear_pages") or [] if isinstance(u, int)]
    return {"title": title, "overview": overview, "topics": raw_topics, "unclear_pages": unclear}


async def _structure_part(batch: list[PageContent], k: int, batches: list[list[PageContent]], raw_topics: list[dict]) -> Any:
    note = ""
    if len(batches) > 1:
        earlier = "، ".join(t.get("title", "") for t in raw_topics) or "—"
        note = (
            f"This is part {k + 1} of {len(batches)} of a long lecture "
            f"(pages {batch[0].n}-{batch[-1].n}). Topics already found in earlier parts: {earlier}. "
            "Return only the topics of THIS part; prerequisites may only point to topics of this part."
        )
    n_pages = sum(1 for p in batch if p.readable)
    lo = max(1, min(3, n_pages // 4 or 1))
    hi = max(lo, min(8 if len(batches) == 1 else 5, n_pages // 2 or 1))
    return await ai.ask_json(
        prompts.STRUCTURE.format(batch_note=note, topic_range=f"{lo}-{hi}"),
        _pages_text(batch, STRUCTURE_CHAR_BUDGET // len(batches)),
        schema=schemas.STRUCTURE,
        kind="structure",
        temperature=0.2,
        max_tokens=24000,
    )


# ── 4. validation ─────────────────────────────────────────────────


def _range(t: dict, n_pages: int) -> tuple[int, int] | None:
    pr = t.get("pages")
    try:
        a, b = int(pr[0]), int(pr[-1])
    except (TypeError, ValueError, IndexError, KeyError):
        return None
    a, b = sorted((a, b))
    a, b = max(1, a), min(n_pages, b)
    return (a, b) if a <= b else None


def _first_line(p: PageContent) -> str:
    for ln in (p.text or "").split("\n"):
        if letter_count(ln) >= 3:
            return clip(ln, 80)
    return f"صفحات تبدأ من {p.n}"


def fallback_topics(pages: list[PageContent], size: int = 5) -> list[dict]:
    """When the model returns no usable topics: consecutive chunks of readable pages."""
    readable = [p for p in pages if p.readable]
    out = []
    for i in range(0, len(readable), size):
        chunk = readable[i : i + size]
        out.append({"title": _first_line(chunk[0]), "pages": [chunk[0].n, chunk[-1].n], "objectives": [], "concepts": []})
    return out


def normalize_topics(raw_topics: list[dict], pages: list[PageContent]) -> list[dict]:
    n_pages = len(pages)
    readable = {p.n for p in pages if p.readable}
    items = []
    for i, t in enumerate(raw_topics):
        r = _range(t, n_pages)
        if not r or not any(n in readable for n in range(r[0], r[1] + 1)):
            continue
        items.append((r, i, t))
    if not items:
        items = [(_range(t, n_pages), i, t) for i, t in enumerate(fallback_topics(pages))]
    items.sort(key=lambda x: (x[0][0], x[0][1]))

    # Too many topics → merge the shortest neighbours.
    while len(items) > MAX_TOPICS:
        k = min(range(len(items) - 1), key=lambda j: (items[j][0][1] - items[j][0][0]) + (items[j + 1][0][1] - items[j + 1][0][0]))
        (a, _), i1, t1 = items[k]
        (_, b), _, t2 = items[k + 1]
        merged = dict(t1)
        merged["title"] = f"{clip(t1.get('title'), 70)} و{clip(t2.get('title'), 70)}"
        for key in ("objectives", "concepts", "key_terms"):
            merged[key] = list(t1.get(key) or []) + list(t2.get(key) or [])
        items[k : k + 2] = [((a, max(b, items[k][0][1])), i1, merged)]

    # Attach every readable page to a topic: extend the topic just before it.
    ranges = [list(r) for r, _, _ in items]
    for n in sorted(readable):
        if any(a <= n <= b for a, b in ranges):
            continue
        before = [j for j, (a, _) in enumerate(ranges) if a <= n]
        j = before[-1] if before else 0
        ranges[j][0], ranges[j][1] = min(ranges[j][0], n), max(ranges[j][1], n)

    old_to_new = {i: k for k, (_, i, _) in enumerate(items)}
    topics = []
    for k, ((_, _, t), (a, b)) in enumerate(zip(items, ranges)):
        tid = f"t{k + 1}"
        concepts = []
        for c in (t.get("concepts") or [])[:8]:
            if isinstance(c, dict) and clip(c.get("name"), 120):
                concepts.append({
                    "id": f"{tid}c{len(concepts) + 1}",
                    "name": clip(c.get("name"), 120),
                    "definition": clip(c.get("definition"), 400),
                })
        key_terms = [
            {"term": clip(x.get("term"), 120), "definition": clip(x.get("definition"), 400)}
            for x in (t.get("key_terms") or [])
            if isinstance(x, dict) and clip(x.get("term"), 120)
        ][:10]
        if not key_terms:
            key_terms = [{"term": c["name"], "definition": c["definition"]} for c in concepts if c["definition"]]
        prereq = []
        for p in t.get("prerequisites") or []:
            try:
                j = old_to_new.get(int(p))
            except (TypeError, ValueError):
                continue
            if j is not None and j < k and f"t{j + 1}" not in prereq:
                prereq.append(f"t{j + 1}")
        minutes = estimate_minutes([pages[n - 1] for n in range(a, b + 1)])
        try:
            importance = min(3, max(1, int(t.get("importance") or 2)))
        except (TypeError, ValueError):
            importance = 2
        topics.append({
            "id": tid,
            "title": clip(t.get("title"), 140) or f"الموضوع {k + 1}",
            "summary": clip(t.get("summary"), 300),
            "pages": [a, b],
            "objectives": [clip(o, 240) for o in (t.get("objectives") or []) if clip(o, 240)][:4],
            "concepts": concepts,
            "prerequisites": prereq,
            "importance": importance,
            "est_minutes": minutes,
            "has_code": bool(t.get("has_code")) or any("```" in (pages[n - 1].text or "") or _looks_like_code(pages[n - 1].text) for n in range(a, b + 1)),
            "key_terms": key_terms,
        })
    return topics


ESTIMATE_VERSION = 2


def estimate_minutes(pages: list[PageContent]) -> int:
    """Study time for a topic, from its material — not the model's guess
    (which put 215 minutes on a 14-slide lecture).

      4 min   goal + check questions + mastery quiz
      1.5 min per readable slide (explanation in parts)
      +1 min  per 120 words of slide text
      +1 min  per 8 lines of code (reading + predicting)
    """
    readable = [p for p in pages if p.readable]
    words = sum(len((p.text or "").split()) + len((p.visual or "").split()) for p in readable)
    code_lines = sum(1 for p in readable for ln in (p.text or "").splitlines() if _CODE_LINE.search(ln))
    minutes = 4 + 1.5 * len(readable) + words / 120 + code_lines / 8
    return int(min(MAX_MINUTES, max(MIN_MINUTES, round(minutes))))


def refresh_estimates(lecture: dict, pages: list[PageContent]) -> bool:
    """Recompute time estimates of a lecture made before ESTIMATE_VERSION. True if changed."""
    if lecture.get("estVersion") == ESTIMATE_VERSION or not pages:
        return False
    for t in lecture.get("topics") or []:
        a, b = t["pages"]
        t["est_minutes"] = estimate_minutes([pages[n - 1] for n in range(a, b + 1) if 0 < n <= len(pages)])
    lecture["estMinutes"] = sum(t["est_minutes"] for t in lecture.get("topics") or [])
    lecture["estVersion"] = ESTIMATE_VERSION
    return True


_CODE_LINE = re.compile(r"^\s*(\$ |>>> |[a-z_]+\s+-{1,2}[a-z]|.*[;{}]\s*$|.*\|\s*\w+|(def|class|for|if|while|return|import|SELECT|cd|ls|grep|cat|echo)\b)")


_CODE_HINT = re.compile(r"(^\s{2,}\S.*[;{}():=]$)|\b(def|class|return|public|void|int|printf|import|SELECT|for\s*\()\b", re.M)


def _looks_like_code(text: str) -> bool:
    return len(_CODE_HINT.findall(text or "")) >= 3


Progress = Callable[[str, int, int], None]


def _quiet(_stage: str, _done: int, _total: int) -> None:
    return None


class Checkpoint(Protocol):
    """Where a preparation keeps the work it has finished, so a restarted
    server picks up from there instead of starting over (services/tutor/prepare.py)."""

    def load(self) -> dict: ...  # {} when nothing was saved yet
    def load_pages(self, count: int) -> list[PageContent]: ...
    def save_pages(self, pages: list[PageContent]) -> None: ...
    def save(self, fields: dict) -> None: ...


class _NoCheckpoint:
    def load(self) -> dict:
        return {}

    def load_pages(self, count: int) -> list[PageContent]:
        return []

    def save_pages(self, pages: list[PageContent]) -> None:
        return None

    def save(self, fields: dict) -> None:
        return None


async def build_lecture(pdf: bytes, file_name: str, progress: Progress | None = None, checkpoint: Checkpoint | None = None) -> tuple[dict, list[PageContent]]:
    """Run the pipeline. Returns (lecture document, pages).

    `progress(stage, done, total)` is told where it is — stages: "reading",
    "vision" (pages read by the model), "structure" (parts of the lecture
    organised) — so a background preparation can show live progress.

    With a `checkpoint`, every finished step is saved as it ends (the pages
    once read, each batch of scanned pages, each part of the structure); a
    second run with the same checkpoint skips what is already done."""
    progress = progress or _quiet
    cp: Checkpoint = checkpoint or _NoCheckpoint()
    src = source.detect(pdf, file_name)
    if src is None:
        raise IngestError("broken")
    saved = cp.load() or {}

    pages = cp.load_pages(int(saved.get("pageCount") or 0)) if saved.get("read") else []
    if not pages or len(pages) != int(saved.get("pageCount") or 0):
        progress("reading", 0, 1)
        try:
            # Extraction is CPU-heavy and synchronous. Run it in a worker thread so
            # the event loop keeps answering (/health included): on Render's single
            # small instance, blocking here made the health check time out and the
            # platform restart the server in the middle of the upload.
            pages = await asyncio.to_thread(src.extract, pdf)
        except ExtractError as exc:
            raise IngestError(str(exc)) from exc
        cp.save_pages(pages)
        saved = {"read": True, "pageCount": len(pages), "visionTried": [], "structureParts": []}
        cp.save(saved)

    tried = set(saved.get("visionTried") or [])

    def vision_batch_done(batch: list[int]) -> None:
        tried.update(batch)
        cp.save_pages(pages)
        cp.save({"visionTried": sorted(tried)})

    vision = await read_visual_pages(pdf, pages, progress, tried=tried, on_batch=vision_batch_done, subset=src.subset)
    for p in pages:
        if p.needs_vision and p.source != "vision" and letter_count(p.text) == 0 and not p.tables:
            p.source = "none"
    if not any(p.readable for p in pages):
        raise IngestError("unreadable")

    raw = await structure(
        pages,
        progress,
        done_parts=saved.get("structureParts") or [],
        on_part=lambda parts: cp.save({"structureParts": parts}),
    )
    topics = normalize_topics(raw.get("topics") or [], pages)
    if not topics:
        raise IngestError("unreadable")

    unread = sorted(p.n for p in pages if not p.readable)
    digest = file_hash(pdf)
    lecture = {
        "id": lecture_id_for(digest),
        "fileHash": digest,
        "fileName": clip(file_name, 200) or "lecture.pdf",
        "source": src.kind,
        "title": raw.get("title") or _first_line(next(p for p in pages if p.readable)),
        "overview": raw.get("overview") or "",
        "pageCount": len(pages),
        "topics": topics,
        "extraction": {
            "textPages": sum(1 for p in pages if p.source == "text"),
            "visionPages": vision["read"],
            "unreadablePages": unread,
            "visionSkipped": vision["skipped"],
            "tables": sum(len(p.tables) for p in pages),
            "imagePages": sum(1 for p in pages if p.images),
        },
        "estMinutes": sum(t["est_minutes"] for t in topics),
        "estVersion": ESTIMATE_VERSION,
        "version": 1,
    }
    return lecture, pages
