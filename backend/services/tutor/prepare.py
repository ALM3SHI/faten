"""
Preparing a new lecture in the background.

Reading a lecture (pdf text, the model reading scanned pages, organising it
into units) took 53-159 s on real lectures — too long to hold one request
open on a free server, and a student watching a spinner that long leaves.

So the upload returns at once with a job, and the work runs in this server
process. The page asks for the job's progress every few seconds, which also
keeps a free Render instance awake while it works (it only sleeps after 15
minutes without requests). If the process restarts mid-way, the job goes
quiet; the page notices and sends the file again, which picks the work up
WHERE IT STOPPED (every finished step is saved as it ends) and does not
charge the student a second time.

Stages: reading → vision (scanned pages) → structure (units) → lesson (the
first unit is written now, so the course opens on a ready lesson; the next
one is prepared in the background while the student studies) → saving.

  users/{uid}/tutor_jobs/{lectureId}   live progress (deleted when ready)
  tutor_cache/{fileHash}/prep/main     work finished so far (deleted when ready)
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Awaitable, Callable

from fastapi import HTTPException

from config import get_settings
from services.quota import COST_TUTOR_INGEST, CreditLedger
from services.tutor import engine, store, visuals
from services.tutor.extract import PageContent
from services.tutor.ingest import IngestError, build_lecture, file_hash

logger = logging.getLogger(__name__)

# A working job with no progress for this long, and not running in this
# process, was lost (server restart): the page should send the file again.
STALE_AFTER_SECONDS = 75

INGEST_MESSAGES = {
    "broken": "الملف تالف أو محمي بكلمة مرور، فما قدرت أفتحه. جرّب نسخة أخرى من المحاضرة.",
    "too many pages": "المحاضرة أطول من 120 صفحة. قسّمها إلى ملفين وارفع كل جزء لوحده.",
    "empty": "الملف لا يحتوي صفحات.",
    "unreadable": "ما لقيت في الملف محتوى دراسياً أقدر أقرأه (ولا حتى بتحليل الصور). تأكد أنه ملف المحاضرة.",
}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _key(uid: str, lid: str) -> str:
    return f"ingest:{uid}:{lid}"


def public_job(job: dict, uid: str) -> dict:
    """What the page sees. `stalled` means: send the file again to resume."""
    out = {k: job.get(k) for k in ("id", "fileName", "status", "stage", "done", "total", "error", "startedAt", "updatedAt")}
    stalled = False
    if job.get("status") == "working" and not visuals.is_running(_key(uid, job.get("id", ""))):
        try:
            age = (_now() - dt.datetime.fromisoformat(str(job.get("updatedAt")))).total_seconds()
        except ValueError:
            age = STALE_AFTER_SECONDS + 1
        stalled = age > STALE_AFTER_SECONDS
    out["stalled"] = stalled
    return out


class CacheCheckpoint:
    """The work finished so far, kept in the shared cache under the file's hash
    (course material only), so a restarted server resumes instead of redoing it."""

    def __init__(self, db, digest: str):
        self.db, self.digest = db, digest

    def load(self) -> dict:
        return store.get_prep(self.db, self.digest)

    def load_pages(self, count: int) -> list[PageContent]:
        return store.load_pages(self.db, self.digest, count) if count else []

    def save_pages(self, pages: list[PageContent]) -> None:
        store.save_pages(self.db, self.digest, pages)

    def save(self, fields: dict) -> None:
        store.save_prep(self.db, self.digest, fields)

    def clear(self) -> None:
        store.delete_prep(self.db, self.digest)


async def write_first_lesson(db, uid: str, lecture: dict, pages: list[PageContent]) -> bool:
    """Write the first unit's lesson now, so the course opens on a ready lesson,
    and start preparing the second one in the background. Part of the
    preparation the student already paid for. A failure here does not fail the
    lecture: the lesson is then written when the student opens it, as before."""
    topics = lecture.get("topics") or []
    if not topics:
        return False
    ctx = engine.Ctx(db=db, uid=uid, lecture=lecture, progress={"topics": {}}, now=_now(), charge=lambda _n: None, _pages=pages)
    first = topics[0]["id"]
    try:
        await engine.ensure_lesson(ctx, first)
    except Exception as exc:  # model busy, a cut-off answer…
        logger.warning("[tutor.prepare] first lesson of %s not written now: %s", lecture.get("id"), getattr(exc, "detail", exc))
        return False
    engine.prefetch_next(ctx, first)
    return True


async def _run(db, uid: str, lid: str, data: bytes, file_name: str, ledger: CreditLedger | None) -> None:
    def progress(stage: str, done: int, total: int) -> None:
        store.save_job(db, uid, lid, {"stage": stage, "done": done, "total": total, "updatedAt": _now().isoformat()})

    checkpoint = CacheCheckpoint(db, file_hash(data))
    try:
        lecture, pages = await build_lecture(data, file_name, progress, checkpoint)
        progress("lesson", 0, 1)
        await write_first_lesson(db, uid, lecture, pages)
        progress("saving", 0, 1)
        store.save_cache(db, lecture, pages)
        now = _now().isoformat()
        lecture["fileName"] = file_name[:200]
        lecture["createdAt"] = now
        lecture["updatedAt"] = now
        store.save_lecture(db, uid, lecture)
        store.delete_job(db, uid, lid)
        checkpoint.clear()
    except IngestError as exc:
        if ledger:
            ledger.refund_all()
        checkpoint.clear()  # the file itself is the problem: nothing worth keeping
        store.save_job(db, uid, lid, {"status": "failed", "error": INGEST_MESSAGES.get(str(exc), INGEST_MESSAGES["unreadable"]), "updatedAt": _now().isoformat()})
    except Exception as exc:  # model down, network… — say so, refund, let the student retry
        if ledger:
            ledger.refund_all()
        # the work finished so far is kept: trying again continues from it
        detail = exc.detail if isinstance(exc, HTTPException) else "تعذّر تجهيز المحاضرة الآن. حاول مرة أخرى بعد قليل."
        logger.warning("[tutor.prepare] %s/%s failed: %s", uid, lid, exc, exc_info=True)
        store.save_job(db, uid, lid, {"status": "failed", "error": str(detail), "charged": False, "updatedAt": _now().isoformat()})


async def start(db, uid: str, lid: str, data: bytes, file_name: str, *, runner: Callable[[str, Awaitable[None]], bool] | None = None) -> dict:
    """Start (or resume) preparing a lecture; returns the job as the page sees it.

    Credits are charged once per lecture: a resumed job does not pay again."""
    job = store.get_job(db, uid, lid)
    if job and job.get("status") == "working" and visuals.is_running(_key(uid, lid)):
        return public_job(job, uid)  # already being prepared: a second tab, a double click

    ledger: CreditLedger | None = None
    if not (job and job.get("charged")):
        ledger = CreditLedger(uid)
        ledger.charge(COST_TUTOR_INGEST)
    now = _now().isoformat()
    job = {
        "id": lid, "fileName": file_name[:200], "status": "working", "stage": "reading", "done": 0, "total": 1,
        "error": None, "charged": True, "startedAt": (job or {}).get("startedAt") or now, "updatedAt": now,
    }
    store.save_job(db, uid, lid, job, merge=False)

    work = _run(db, uid, lid, data, file_name, ledger)
    if runner is not None:
        runner(_key(uid, lid), work)
    elif get_settings().COURSE_BACKGROUND:
        visuals.spawn(_key(uid, lid), work)
    else:
        await work  # background work off (tests, local runs): prepare before answering
    return public_job(store.get_job(db, uid, lid) or {**job, "status": "ready"}, uid)
