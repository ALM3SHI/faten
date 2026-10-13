"""
================================================================
UQU Academic Assistant — External CRON trigger
================================================================
Free hosts (e.g. Render's free plan) put the server to sleep when
idle, so an in-process scheduler cannot be relied on. Instead an
external scheduler (GitHub Actions, cron-job.org, …) calls:

    POST /api/cron/daily-notifications   (08:00 — motivation, exams, absences)
    POST /api/cron/lecture-reminders     (every 30 min — "محاضرة بعد ساعة")
    X-Cron-Secret: <CRON_SECRET from .env>

The job runs in the background and the call returns immediately.
================================================================
"""

import logging
import secrets

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from config import get_settings
from tasks.cron import daily_notifications_cron, lecture_reminders_cron

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cron", tags=["CRON"])

_running = False


async def _run_once() -> None:
    global _running
    try:
        await daily_notifications_cron()
    finally:
        _running = False


def _check_secret(x_cron_secret: str) -> None:
    expected = get_settings().CRON_SECRET
    if not expected:
        raise HTTPException(status_code=503, detail="مهمة الإشعارات اليومية غير مفعّلة: CRON_SECRET غير مضبوط على الخادم.")
    if not secrets.compare_digest(x_cron_secret, expected):
        raise HTTPException(status_code=401, detail="رمز مهمة الإشعارات (X-Cron-Secret) غير صحيح.")


@router.post("/daily-notifications", status_code=202)
async def trigger_daily_notifications(
    background_tasks: BackgroundTasks,
    x_cron_secret: str = Header(default=""),
) -> dict:
    global _running
    _check_secret(x_cron_secret)
    if _running:
        return {"status": "already_running"}

    _running = True
    background_tasks.add_task(_run_once)
    logger.info("[cron] Daily notifications triggered externally")
    return {"status": "started"}


@router.post("/lecture-reminders")
async def trigger_lecture_reminders(x_cron_secret: str = Header(default="")) -> dict:
    """Short job (a few reads per student with push on) — runs inline."""
    _check_secret(x_cron_secret)
    return {"status": "done", "sent": await lecture_reminders_cron()}
