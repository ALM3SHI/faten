"""
Preparing a new lecture in the background.

Reading a lecture (pdf text, the model reading scanned pages, organising it
into units) took 53-159 s on real lectures — too long to hold one request
open on a free server, and a student watching a spinner that long leaves.

So the upload returns at once with a job, and the work runs in this server
process. The page asks for the job's progress every few seconds, which also
keeps a free Render instance awake while it works (it only sleeps after 15
minutes without requests). If the process restarts mid-way, the job goes
quiet; the page notices and sends the file again, which restarts the work
WITHOUT charging the student a second time.

  users/{uid}/tutor_jobs/{lectureId}   live progress (deleted when ready)
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Awaitable, Callable

from fastapi import HTTPException

from config import get_settings
from services.quota import COST_TUTOR_INGEST, CreditLedger
from services.tutor import store, visuals
from services.tutor.ingest import IngestError, build_lecture

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


async def _run(db, uid: str, lid: str, data: bytes, file_name: str, ledger: CreditLedger | None) -> None:
    def progress(stage: str, done: int, total: int) -> None:
        store.save_job(db, uid, lid, {"stage": stage, "done": done, "total": total, "updatedAt": _now().isoformat()})

    try:
        lecture, pages = await build_lecture(data, file_name, progress)
        progress("saving", 0, 1)
        store.save_cache(db, lecture, pages)
        now = _now().isoformat()
        lecture["fileName"] = file_name[:200]
        lecture["createdAt"] = now
        lecture["updatedAt"] = now
        store.save_lecture(db, uid, lecture)
        store.delete_job(db, uid, lid)
    except IngestError as exc:
        if ledger:
            ledger.refund_all()
        store.save_job(db, uid, lid, {"status": "failed", "error": INGEST_MESSAGES.get(str(exc), INGEST_MESSAGES["unreadable"]), "updatedAt": _now().isoformat()})
    except Exception as exc:  # model down, network… — say so, refund, let the student retry
        if ledger:
            ledger.refund_all()
        detail = exc.detail if isinstance(exc, HTTPException) else "تعذّر تجهيز المحاضرة الآن. حاول مرة أخرى بعد قليل."
        logger.warning("[tutor.prepare] %s/%s failed: %s", uid, lid, exc)
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
