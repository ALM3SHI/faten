"""
================================================================
UQU Academic Assistant — Scheduled Tasks (CRON)
================================================================
Converts: exports.dailyNotificationsCron from index.js lines 369-424
Daily proactive notifications at 8 AM Riyadh time.
"""

import asyncio
import json
import math
import logging
from datetime import datetime, timedelta, timezone

from agent.loop import get_openai_client
from agent.tools_schema import TOOLS_SCHEMA
from agent.tools_executor import execute_tool
from agent.prompts import build_system_prompt
from db.firestore import get_db
from config import get_settings
from services.exams import load_exams, upcoming
from services.workspace import load_active_plan_sync

logger = logging.getLogger(__name__)


async def load_student_context_for_cron(user_id: str, db) -> dict:
    """Lightweight context loader for cron job (no auth needed)."""
    user_ref = db.collection("users").document(user_id)

    user_snap = user_ref.get()
    user_data = user_snap.to_dict() if user_snap.exists else {}

    t_snaps = (user_ref.collection("transcripts")
               .order_by("createdAt", direction="DESCENDING")
               .limit(1).get())
    t_docs = list(t_snaps)
    transcript = t_docs[0].to_dict() if t_docs else None

    upcoming_exams = upcoming(load_exams(user_ref))[:10]

    active_plan = load_active_plan_sync(user_ref)

    return {
        "user_data": user_data,
        "transcript": transcript,
        "upcoming_exams": upcoming_exams,
        "active_plan": active_plan,
    }


async def daily_notifications_cron():
    """Send daily motivational notifications to all users.

    Mirrors: exports.dailyNotificationsCron from index.js lines 369-424
    Scheduled to run at 8:00 AM Asia/Riyadh.
    """
    logger.info("[cron] Starting daily notifications...")

    db = get_db()
    settings = get_settings()
    client = get_openai_client()

    users_snap = db.collection("users").get()

    # Only expose the one tool this job needs — smaller prompt, and the
    # model cannot wander off into other tools.
    notify_tools = [
        t for t in TOOLS_SCHEMA
        if t.get("function", {}).get("name") == "send_notification"
    ]

    for index, user_doc in enumerate(users_snap):
        user_id = user_doc.id
        if index:
            await asyncio.sleep(settings.CRON_USER_DELAY_SECONDS)
        try:
            ctx = await load_student_context_for_cron(user_id, db)
            user_ref = db.collection("users").document(user_id)

            system_p = build_system_prompt(
                ctx["user_data"],
                ctx["transcript"],
                ctx["upcoming_exams"],
                ctx["active_plan"],
            )

            completion = await client.chat.completions.create(
                model=settings.llm_fast_model,
                messages=[
                    {"role": "system", "content": system_p},
                    {"role": "user", "content": "ابعث للطالب إشعاراً تحفيزياً صباحياً مناسباً لوضعه الأكاديمي الحالي. استخدم أداة send_notification."},
                ],
                tools=notify_tools,
                tool_choice={"type": "function", "function": {"name": "send_notification"}},
                temperature=1.00,
                top_p=1.00,
                max_tokens=1024,
            )

            tool_call = None
            if completion.choices[0].message.tool_calls:
                tool_call = completion.choices[0].message.tool_calls[0]

            if tool_call:
                args = json.loads(tool_call.function.arguments)
                await execute_tool("send_notification", args, user_id, db)

            # ── Exam reminders ──
            if ctx["upcoming_exams"]:
                near_exam = ctx["upcoming_exams"][0]
                try:
                    exam_date = datetime.fromisoformat(near_exam["date"])
                    days = math.ceil((exam_date - datetime.now()).total_seconds() / 86400)

                    if 0 < days <= 3:
                        days_word = "يوم" if days == 1 else "أيام"
                        user_ref.collection("notifications").add({
                            "title": f"⏰ تنبيه اختبار: {near_exam.get('subject', '')}",
                            "message": f"بقي {days} {days_word} على اختبار {near_exam.get('subject', '')}. وقت المذاكرة! 📚",
                            "type": "reminder",
                            "read": False,
                            "createdAt": datetime.now(timezone.utc).isoformat(),
                        })
                except (ValueError, KeyError):
                    pass

        except Exception as err:
            logger.error(f"[cron] Error for user {user_id}: {err}")

    logger.info("[cron] Daily notifications complete.")
    await push_daily_reminders(db)


RIYADH = timezone(timedelta(hours=3))


async def push_daily_reminders(db=None) -> int:
    """Morning push: upcoming exams and absence limits (services/push.py)."""
    from services import push

    db = db or get_db()
    today = datetime.now(RIYADH).date()
    sent = 0
    for uid in push.users_with_devices(db):
        try:
            sent += push.send_to_user(db, uid, push.daily_items(db, uid, today))
        except Exception as err:
            logger.error("[cron] push for %s failed: %s", uid, err)
    logger.info("[cron] Daily push reminders sent: %d", sent)
    return sent


async def lecture_reminders_cron(db=None, now: datetime | None = None) -> int:
    """Every ~30 min in the day: 'محاضرة بعد ساعة' for students with push on."""
    from services import push

    db = db or get_db()
    now = now or datetime.now(RIYADH)
    sent = 0
    for uid in push.users_with_devices(db):
        try:
            sent += push.send_to_user(db, uid, push.lecture_items(db, uid, now))
        except Exception as err:
            logger.error("[cron] lecture push for %s failed: %s", uid, err)
    logger.info("[cron] Lecture reminders sent: %d", sent)
    return sent
