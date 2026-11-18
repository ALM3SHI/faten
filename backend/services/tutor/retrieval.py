"""
Finding the passages of a lecture that answer a student's question — by
meaning, not by shared words.

The lecture's pages are cut into short passages (a page, or a part of a long
page). Each passage gets an embedding vector once per file (Gemini's free
embedding model) and the vectors are kept in the shared cache next to the
pages:

  tutor_cache/{fileHash}/index/{k}   {"model", "dim", "chunks": [{"page", "i", "v": [...]}]}

A question is embedded the same way and compared with every passage
(cosine similarity, in the server — a lecture has at most a few hundred
passages, so no vector database is needed). The passage text itself is not
stored twice: it is cut again from the pages, the same way, when needed.

When embeddings are not available (no key, quota used up, the model down),
search returns nothing and the tutor falls back to matching words.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from config import get_settings
from services import gemini
from services.tutor import store
from services.tutor.extract import PageContent, page_block

logger = logging.getLogger(__name__)

CHUNK_CHARS = 900
CHUNKS_PER_DOC = 120  # 120 × 256 numbers per document, well under Firestore's 1 MiB
MIN_SCORE = 0.35


@dataclass
class Passage:
    page: int
    i: int
    text: str


def passages(pages: list[PageContent]) -> list[Passage]:
    """The lecture cut into passages: each page, split on blank lines into
    pieces of at most ~CHUNK_CHARS characters. Deterministic, so the stored
    vectors line up with the text cut again later."""
    out: list[Passage] = []
    for p in pages:
        if not p.readable:
            continue
        body = page_block(p).split("\n", 1)[-1]
        pieces, cur = [], ""
        for para in body.split("\n\n"):
            if cur and len(cur) + len(para) > CHUNK_CHARS:
                pieces.append(cur)
                cur = ""
            cur = f"{cur}\n\n{para}" if cur else para
        if cur.strip():
            pieces.append(cur)
        for i, piece in enumerate(pieces):
            out.append(Passage(p.n, i, piece[: CHUNK_CHARS * 2]))
    return out


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _index_ref(db, file_hash: str):
    return store.cache_ref(db, file_hash).collection("index")


def load_index(db, file_hash: str) -> list[dict] | None:
    model = get_settings().GEMINI_EMBED_MODEL
    chunks: list[dict] = []
    k = 0
    while True:
        snap = _index_ref(db, file_hash).document(str(k)).get()
        if not snap.exists:
            break
        d = snap.to_dict() or {}
        if d.get("model") != model:
            return None  # made with another model: not comparable
        chunks += d.get("chunks") or []
        k += 1
    return chunks or None


async def build_index(db, file_hash: str, pages: list[PageContent]) -> list[dict]:
    """Embed every passage of the lecture once and keep the vectors. Raises when
    the embedding model is unavailable."""
    ps = passages(pages)
    vectors = await gemini.embed_texts([p.text for p in ps], "RETRIEVAL_DOCUMENT")
    model = get_settings().GEMINI_EMBED_MODEL
    chunks = [{"page": p.page, "i": p.i, "v": [round(x, 5) for x in v]} for p, v in zip(ps, vectors)]
    for k in range(0, len(chunks), CHUNKS_PER_DOC):
        _index_ref(db, file_hash).document(str(k // CHUNKS_PER_DOC)).set(
            {"model": model, "dim": len(chunks[0]["v"]) if chunks else 0, "chunks": chunks[k : k + CHUNKS_PER_DOC]}
        )
    return chunks


async def search(db, file_hash: str, pages: list[PageContent], query: str, k: int = 5) -> list[tuple[Passage, float]]:
    """The k passages closest in meaning to `query`, best first. Empty when
    search by meaning is not available right now."""
    if not get_settings().GEMINI_EMBED_MODEL or not query.strip():
        return []
    try:
        chunks = load_index(db, file_hash) or await build_index(db, file_hash, pages)
        q = (await gemini.embed_texts([query], "RETRIEVAL_QUERY"))[0]
    except Exception as exc:  # no key, quota, model down: fall back to words
        logger.info("[tutor.retrieval] search by meaning unavailable: %s", getattr(exc, "detail", exc))
        return []
    text = {(p.page, p.i): p for p in passages(pages)}
    scored = []
    for c in chunks:
        p = text.get((c.get("page"), c.get("i")))
        if p is None:
            continue
        s = _cosine(q, c.get("v") or [])
        if s >= MIN_SCORE:
            scored.append((p, s))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
