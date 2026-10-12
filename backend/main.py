"""
================================================================
UQU ACADEMIC ASSISTANT — FastAPI Backend
AI Agent Backend v2.0 (Python/FastAPI)
================================================================
Endpoints:
  POST /api/chat                 — AI Agent (Gemini via OpenAI-compatible API + function calling)
  POST /api/sync-profile         — DEPRECATED (410, Phase 4C.1); dead write logic removed 4C.2
  POST /api/sync-transcript      — DEPRECATED (410, Phase 4C.1); dead write logic removed 4C.2
  POST /api/firebase/*           — DEPRECATED legacy writes (410, Phase 4C.1); dead logic removed 4C.2
  POST /api/onboarding/save-profile — DEPRECATED (410, Phase 4C.1); dead write logic removed 4C.2
  GET  /api/student-context      — Fetch full Firestore data for frontend
  POST /api/mark-notification-read — Mark notification as read
  GET  /api/news                 — University headlines (public, cached RSS)
  CRON                           — Daily proactive notifications (8 AM Riyadh)
================================================================

📌 Setup:
  1. pip install -r requirements.txt
  2. Place your Firebase serviceAccountKey.json in the backend/ folder
  3. Copy .env.example to .env and set GEMINI_API_KEY
  4. Run: uvicorn main:app --reload --port 8000
  5. Open: http://localhost:8000/docs (Swagger UI)
================================================================
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from services.llm import make_llm_client

from config import get_settings
from db.firestore import init_firestore
from observability import REQUEST_ID_HEADER, install_observability

# ── Import Routers ──
from routers.chat import router as chat_router
from routers.transcript_parser import router as transcript_parser_router
from routers.plan_ai import router as plan_ai_router
from routers.schedule_vision import router as schedule_vision_router
from routers.pomodoro import router as pomodoro_router
from routers.analytics import router as analytics_router
from routers.stt import router as stt_router
from routers.workspace import router as workspace_router
from routers.cron import router as cron_router
from routers.community import router as community_router
from routers.news import router as news_router
from routers.account import router as account_router
from routers.study import router as study_router

# ── Import CRON tasks ──
from tasks.cron import daily_notifications_cron

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── Scheduler ──
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # ── Startup ──
    logger.info("🚀 Starting UQU Academic Assistant Backend...")
    init_firestore()
    logger.info("✅ Firestore initialized")

    # Create the LLM client once and store on app.state so it shares
    # the current event loop for the lifetime of this process. This avoids the
    # @lru_cache pattern, which binds the client to a loop that closes on
    # Uvicorn --reload, causing "Event loop is closed" errors.
    settings = get_settings()
    app.state.openai_client = make_llm_client()
    if not settings.llm_api_key:
        logger.warning("⚠️  No API key set for AI_PROVIDER=%s — chat will fail", settings.ai_provider)
    logger.info("✅ LLM client initialized (provider=%s, model=%s)", settings.ai_provider, settings.llm_model)

    # Schedule daily notifications cron (8:00 AM Riyadh = UTC+3)
    if settings.ENABLE_INTERNAL_SCHEDULER:
        scheduler.add_job(
            daily_notifications_cron,
            CronTrigger(hour=8, minute=0, timezone="Asia/Riyadh"),
            id="daily_notifications",
            name="Daily Motivational Notifications",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("⏰ CRON scheduler started (daily at 8:00 AM Riyadh)")
    else:
        logger.info("⏰ Internal scheduler disabled — use POST /api/cron/daily-notifications")

    logger.info("═" * 50)
    logger.info("  UQU Academic Assistant — Backend Ready!")
    logger.info("  📖 Swagger UI: http://localhost:8000/docs")
    logger.info("═" * 50)

    yield

    # ── Shutdown ──
    try:
        if scheduler.running:
            scheduler.shutdown()
    except Exception:
        pass
    try:
        await app.state.openai_client.close()
        logger.info("👋 LLM client closed. Backend shut down.")
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════
#  FastAPI Application
# ══════════════════════════════════════════════════════════════

app = FastAPI(
    title="UQU Academic Assistant API",
    description="المساعد الأكاديمي الذكي لجامعة أم القرى — AI Agent Backend",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ──
# allow_credentials must be False when allow_origins=["*"] — browsers reject
# credentialed responses with wildcard origin (CORS spec §3.2.5).
# Bearer token auth uses Authorization header, not cookies, so credentials=False is correct.
#
# IMPORTANT: The Fetch spec explicitly excludes "Authorization" from the "*" wildcard in
# Access-Control-Allow-Headers — it must be listed explicitly regardless of credentials mode.
_origins = [o.strip() for o in get_settings().ALLOWED_ORIGINS.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With", REQUEST_ID_HEADER],
    expose_headers=[REQUEST_ID_HEADER],
)

# ── Request ids, access logs, safe 500s, gzip, optional Sentry ──
install_observability(app)

# ── Register Routers ──
app.include_router(chat_router)
app.include_router(transcript_parser_router)
app.include_router(plan_ai_router)
app.include_router(schedule_vision_router)
app.include_router(pomodoro_router)
app.include_router(analytics_router)
app.include_router(stt_router)
app.include_router(workspace_router)
app.include_router(cron_router)
app.include_router(community_router)
app.include_router(news_router)
app.include_router(account_router)
app.include_router(study_router)


# ── Health Check ──
@app.get("/health", tags=["Health"])
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "scheduler": "running" if scheduler.running else "stopped",
    }



# ══════════════════════════════════════════════════════════════
#  Run with: uvicorn main:app --reload --port 8000
# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
