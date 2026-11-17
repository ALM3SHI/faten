"""
Pictures for the lesson — the "course" layer of «ذاكر محاضرة».

The model never generates an image. For each lesson part it picks one of:

  diagram  it *describes* the diagram as short text lines (nodes / edges);
           `normalize_visual` validates them and the app draws the diagram
           (frontend: components/tutor/diagram.tsx). Accurate, because it is
           built from the lecture itself, and right-to-left Arabic just works.
  slide    a page of the student's own lecture file (rendered on the device).
  photo    a real picture, looked up on Wikimedia Commons (free licences only,
           author + licence kept for the credit line), ranked by the model on
           its title and description, then LOOKED AT by the model before it is
           accepted. If nothing fits, nothing is shown — never a wrong picture.
  none     often the right answer.

Photo lookup and preparing the next topic's lesson run in the background
(`schedule_*`), so the student never waits for them. Their results are
cached with the lecture (tutor_cache/{fileHash}/lessons/{topicId}), so a file
is prepared once for every student who uploads it.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import re
from typing import Any, Awaitable, Callable

import httpx

from config import get_settings
from services.tutor import ai, store
from services.tutor.questions import clip

logger = logging.getLogger(__name__)

KINDS = ("diagram", "slide", "photo", "none")
DIAGRAM_TYPES = ("flow", "sequence", "cycle")
SHAPES = ("box", "db", "decision")
MAX_NODES = 8
MAX_EDGES = 12
MAX_PHOTOS_PER_LESSON = 2
LABEL_CHARS = 48

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia asks automated clients to identify themselves.
USER_AGENT = "FatenStudyApp/1.0 (educational; https://fatenai.web.app)"
THUMB_WIDTH = 800
CANDIDATES_PER_QUERY = 6
# Licences we may show with a credit line. Anything else is skipped.
_FREE = re.compile(r"^(cc[ -]?0|cc[ -]by(-sa)?( \d(\.\d)?)?|public domain|pd|pdm)", re.I)


# ── validation of the model's description ─────────────────────────


def _label(text: Any) -> str:
    return clip(re.sub(r"\s+", " ", str(text or "")).strip().strip("|").strip(), LABEL_CHARS)


def _node_id(text: str) -> str:
    return re.sub(r"[^\w-]", "", text.strip(), flags=re.UNICODE)[:24]


def parse_nodes(lines: Any) -> list[dict]:
    nodes: list[dict] = []
    seen: set[str] = set()
    for line in (lines if isinstance(lines, list) else [])[: MAX_NODES * 2]:
        parts = [p.strip() for p in str(line).split("|")]
        if len(parts) < 2:
            continue
        nid, label = _node_id(parts[0]), _label(parts[1])
        shape = parts[2].lower() if len(parts) > 2 and parts[2].lower() in SHAPES else "box"
        if nid and label and nid not in seen:
            seen.add(nid)
            nodes.append({"id": nid, "label": label, "shape": shape})
        if len(nodes) == MAX_NODES:
            break
    return nodes


_EDGE = re.compile(r"^\s*([\w-]+)\s*(-->|->)\s*([\w-]+)\s*(?:\|\s*(.*))?$", re.UNICODE)


def parse_edges(lines: Any, ids: set[str]) -> list[dict]:
    edges: list[dict] = []
    for line in (lines if isinstance(lines, list) else [])[: MAX_EDGES * 2]:
        m = _EDGE.match(str(line))
        if not m:
            continue
        a, arrow, b, label = m.group(1), m.group(2), m.group(3), m.group(4)
        if a in ids and b in ids:
            edges.append({"from": a, "to": b, "label": _label(label), "reply": arrow == "-->"})
        if len(edges) == MAX_EDGES:
            break
    return edges


def normalize_visual(raw: Any, allowed_pages: set[int], photos_left: list[int]) -> dict | None:
    """The stored, trusted form of one lesson part's picture (or None).

    `photos_left` is a one-item counter shared by the lesson's parts, so a
    lesson never asks for more than MAX_PHOTOS_PER_LESSON photos."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    caption = clip(str(raw.get("caption") or "").strip(), 160)
    if kind == "diagram":
        dtype = raw.get("diagram_type") if raw.get("diagram_type") in DIAGRAM_TYPES else "flow"
        nodes = parse_nodes(raw.get("nodes"))
        edges = parse_edges(raw.get("edges"), {n["id"] for n in nodes})
        if len(nodes) < 2 or (dtype != "cycle" and not edges):
            return None
        if dtype == "cycle":  # a cycle is its nodes in order, closed
            edges = edges or [{"from": nodes[i]["id"], "to": nodes[(i + 1) % len(nodes)]["id"], "label": "", "reply": False} for i in range(len(nodes))]
        return {
            "kind": "diagram",
            "caption": caption,
            "diagram": {"type": dtype, "direction": "tb" if raw.get("direction") == "tb" else "lr", "nodes": nodes, "edges": edges},
        }
    if kind == "slide":
        try:
            page = int(raw.get("page"))
        except (TypeError, ValueError):
            return None
        return {"kind": "slide", "caption": caption, "page": page} if page in allowed_pages else None
    if kind == "photo":
        queries = [clip(str(q).strip(), 80) for q in raw.get("queries") or [] if str(q).strip()][:2]
        if not queries or photos_left[0] <= 0:
            return None
        photos_left[0] -= 1
        return {"kind": "photo", "caption": caption, "queries": queries, "status": "pending"}
    return None


# ── Wikimedia Commons ─────────────────────────────────────────────


def _strip_html(s: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str(s or ""))).strip()


async def commons_candidates(client: httpx.AsyncClient, query: str) -> list[dict]:
    """Freely licensed images on Commons for a search, with their credit."""
    r = await client.get(
        COMMONS_API,
        params={
            "action": "query", "format": "json", "formatversion": 2,
            "generator": "search", "gsrnamespace": 6, "gsrlimit": CANDIDATES_PER_QUERY,
            "gsrsearch": f"{query} filetype:bitmap|drawing",
            "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": THUMB_WIDTH,
        },
    )
    r.raise_for_status()
    out = []
    for page in (r.json().get("query") or {}).get("pages") or []:
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        licence = _strip_html((meta.get("LicenseShortName") or {}).get("value"))
        if not licence or not _FREE.match(licence) or not info.get("thumburl"):
            continue
        out.append({
            "title": str(page.get("title") or "").removeprefix("File:"),
            "description": _strip_html((meta.get("ImageDescription") or {}).get("value"))[:300],
            "url": info["thumburl"],
            "width": info.get("thumbwidth"),
            "height": info.get("thumbheight"),
            "page": info.get("descriptionurl"),
            "license": licence,
            "artist": _strip_html((meta.get("Artist") or {}).get("value"))[:80],
        })
    return out


async def _fetch_image(client: httpx.AsyncClient, url: str) -> tuple[bytes, str] | None:
    r = await client.get(url, follow_redirects=True)
    mime = r.headers.get("content-type", "").split(";")[0]
    if r.status_code != 200 or mime not in ("image/jpeg", "image/png", "image/webp") or len(r.content) > 4_000_000:
        return None
    return r.content, mime


RANK = """A university student is studying: «{heading}».
The picture should show: «{caption}».
Candidate images from Wikimedia Commons (title — description):
{lines}
Return {{"ranked": [indexes of at most 2 candidates that would truly help this student understand, best first]}}.
Return [] when none of them clearly fits — a missing picture is better than a wrong one."""

CHECK = """A university student is studying: «{heading}».
The picture is meant to show: «{caption}».
Look at the image. Does it really show this, clearly enough to help a student?
Reject logos, unrelated photos, low-quality or unreadable images, and anything inappropriate.
Return {{"fits": true|false, "reason": "short English"}}."""


async def find_photo(heading: str, visual: dict, *, ask: Callable[..., Awaitable[Any]] | None = None, client: httpx.AsyncClient | None = None) -> dict | None:
    """Search → rank by text → look at the best one or two. None when nothing fits."""
    ask = ask or ai.ask_json
    own = client is None
    client = client or httpx.AsyncClient(timeout=20.0, headers={"User-Agent": USER_AGENT})
    try:
        seen: set[str] = set()
        cands: list[dict] = []
        for q in visual.get("queries") or []:
            for c in await commons_candidates(client, q):
                if c["url"] not in seen:
                    seen.add(c["url"])
                    cands.append(c)
        if not cands:
            return None
        lines = "\n".join(f"{i}. {c['title']} — {c['description'][:200]}" for i, c in enumerate(cands))
        ranked = await ask(RANK.format(heading=heading, caption=visual.get("caption", ""), lines=lines), "Rank the candidates.", kind="visual_rank", temperature=0.0, max_tokens=512, timeout=40.0)
        order = [i for i in (ranked or {}).get("ranked") or [] if isinstance(i, int) and 0 <= i < len(cands)][:2]
        for i in order:
            img = await _fetch_image(client, cands[i]["url"])
            if not img:
                continue
            verdict = await ask(CHECK.format(heading=heading, caption=visual.get("caption", "")), "Check the image.", image=img, kind="visual_check", temperature=0.0, max_tokens=512, timeout=60.0)
            if isinstance(verdict, dict) and verdict.get("fits") is True:
                return cands[i]
            logger.info("[visuals] rejected %r: %s", cands[i]["title"], (verdict or {}).get("reason") if isinstance(verdict, dict) else verdict)
        return None
    finally:
        if own:
            await client.aclose()


# ── background work ───────────────────────────────────────────────

_tasks: set[asyncio.Task] = set()
_inflight: set[str] = set()
_photo_day = {"day": "", "count": 0}


def _spawn(key: str, coro: Awaitable[None]) -> bool:
    if key in _inflight:
        coro.close()  # type: ignore[attr-defined]
        return False
    _inflight.add(key)

    async def run():
        try:
            await coro
        except Exception as exc:  # background work must never surface to a student
            logger.warning("[visuals] background %s failed: %s", key, exc)
        finally:
            _inflight.discard(key)

    task = asyncio.get_running_loop().create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True


def spawn(key: str, coro: Awaitable[None]) -> bool:
    """Run work in the background of this server process (once per key)."""
    return _spawn(key, coro)


def is_running(key: str) -> bool:
    return key in _inflight


def _photo_budget_ok() -> bool:
    limit = get_settings().COURSE_PHOTO_LESSONS_PER_DAY
    today = dt.date.today().isoformat()
    if _photo_day["day"] != today:
        _photo_day.update(day=today, count=0)
    if limit <= 0 or _photo_day["count"] >= limit:
        return False
    _photo_day["count"] += 1
    return True


def pending_photos(lesson: dict) -> list[int]:
    photos = lesson.get("photos") or {}
    return [
        i for i, s in enumerate(lesson.get("segments") or [])
        if (s.get("visual") or {}).get("kind") == "photo" and str(i) not in photos
    ]


async def resolve_photos(db, file_hash: str, tid: str, lesson: dict, *, finder=find_photo) -> dict:
    """Look up every pending photo of a lesson and save the outcome (found or none)."""
    found: dict[str, dict] = {}
    for i in pending_photos(lesson):
        seg = lesson["segments"][i]
        try:
            photo = await finder(seg.get("title", ""), seg["visual"])
        except Exception as exc:  # a failed lookup is retried another day, not recorded
            logger.warning("[visuals] photo lookup failed (%s/%s #%d): %s", file_hash[:8], tid, i, exc)
            continue
        found[str(i)] = {"status": "ready", "photo": photo} if photo else {"status": "none"}
    if found:
        # merge: only the `photos` map is written, never the questions/segments
        store.cache_ref(db, file_hash).collection("lessons").document(tid).set({"photos": {**(lesson.get("photos") or {}), **found}}, merge=True)
        lesson["photos"] = {**(lesson.get("photos") or {}), **found}
    return found


def schedule_photos(db, file_hash: str, tid: str, lesson: dict) -> bool:
    s = get_settings()
    if not s.COURSE_BACKGROUND or not pending_photos(lesson) or not _photo_budget_ok():
        return False
    return _spawn(f"photos:{file_hash}:{tid}", resolve_photos(db, file_hash, tid, lesson))


def schedule_prefetch(tid: str, prepare: Callable[[], Awaitable[None]], file_hash: str) -> bool:
    """Prepare a lesson ahead of time (the next topic) so it opens instantly."""
    if not get_settings().COURSE_BACKGROUND:
        return False
    return _spawn(f"lesson:{file_hash}:{tid}", prepare())


def public_visual(segment: dict, photos: dict, index: int) -> dict | None:
    """What the student's screen receives for one lesson part."""
    v = segment.get("visual")
    if not v:
        return None
    if v.get("kind") != "photo":
        return v
    got = photos.get(str(index))
    if not got:
        return {"kind": "photo", "caption": v.get("caption", ""), "status": "pending"}
    if got.get("status") == "ready" and got.get("photo"):
        p = got["photo"]
        return {
            "kind": "photo", "caption": v.get("caption", ""), "status": "ready",
            "photo": {k: p.get(k) for k in ("url", "width", "height", "title", "page", "license", "artist")},
        }
    return None
