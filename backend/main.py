"""
================================================================
UQU ACADEMIC ASSISTANT — FastAPI Backend
AI Agent Backend v2.0 (Python/FastAPI)
================================================================
Endpoints:
  POST /api/chat                 — AI Agent (NVIDIA kimi-k2.5 + Function Calling)
  POST /api/sync-profile         — Sync localStorage profile → Firestore
  POST /api/sync-transcript      — OCR + AI analysis of transcript
  GET  /api/student-context      — Fetch full Firestore data for frontend
  POST /api/mark-notification-read — Mark notification as read
  CRON                           — Daily proactive notifications (8 AM Riyadh)
================================================================

📌 Setup:
  1. pip install -r requirements.txt
  2. Place your Firebase serviceAccountKey.json in the backend/ folder
  3. Edit .env with your NVIDIA API key
  4. Run: uvicorn main:app --reload --port 8000
  5. Open: http://localhost:8000/docs (Swagger UI)
================================================================
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from openai import AsyncOpenAI

from config import get_settings
from db.firestore import init_firestore

# ── Import Routers ──
from routers.chat import router as chat_router
from routers.profile import router as profile_router
from routers.transcript import router as transcript_router
from routers.transcript_parser import router as transcript_parser_router
from routers.student import router as student_router
from routers.notifications import router as notifications_router
from routers.onboarding import router as onboarding_router
from routers.plan_generator import router as plan_generator_router
from routers.plan_ai import router as plan_ai_router
from routers.schedule_vision import router as schedule_vision_router
from routers.engine import router as engine_router
from routers.pomodoro import router as pomodoro_router
from routers.firebase_writes import router as firebase_writes_router
from routers.achievements import router as achievements_router
from routers.news import router as news_router
from routers.tools import router as tools_router
from routers.diagnostics import router as diagnostics_router
from routers.nav import router as nav_router
from routers.analytics import router as analytics_router
from routers.stt import router as stt_router

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

    # Create the AsyncOpenAI client once and store on app.state so it shares
    # the current event loop for the lifetime of this process. This avoids the
    # @lru_cache pattern, which binds the client to a loop that closes on
    # Uvicorn --reload, causing "Event loop is closed" errors.
    settings = get_settings()
    app.state.openai_client = AsyncOpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=settings.NVIDIA_API_KEY,
    )
    logger.info("✅ OpenAI/NVIDIA client initialized")

    # Schedule daily notifications cron (8:00 AM Riyadh = UTC+3)
    scheduler.add_job(
        daily_notifications_cron,
        CronTrigger(hour=8, minute=0, timezone="Asia/Riyadh"),
        id="daily_notifications",
        name="Daily Motivational Notifications",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("⏰ CRON scheduler started (daily at 8:00 AM Riyadh)")

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
        logger.info("👋 OpenAI client closed. Backend shut down.")
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
)

# ── Register Routers ──
app.include_router(chat_router)
app.include_router(profile_router)
app.include_router(transcript_router)
app.include_router(transcript_parser_router)
app.include_router(student_router)
app.include_router(notifications_router)
app.include_router(onboarding_router)
app.include_router(plan_generator_router)
app.include_router(plan_ai_router)
app.include_router(schedule_vision_router)
app.include_router(engine_router)
app.include_router(pomodoro_router)
app.include_router(firebase_writes_router)
app.include_router(achievements_router)
app.include_router(news_router)
app.include_router(tools_router)
app.include_router(diagnostics_router)
app.include_router(nav_router)
app.include_router(analytics_router)
app.include_router(stt_router)


# ── Health Check ──
@app.get("/health", tags=["Health"])
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "firebase": "connected",
        "scheduler": "running" if scheduler.running else "stopped",
    }


# ── Serve Frontend (HTML/CSS/JS from parent directory) ──
# Mount AFTER all other routes to avoid catching API endpoints
frontend_path = Path(__file__).parent.parent
if (frontend_path / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")
    logger.info(f"📁 Frontend mounted from: {frontend_path}")


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
