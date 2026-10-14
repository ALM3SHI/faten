"""
Run the real FastAPI app with an in-memory Firestore, no auth and a scripted
model — for clicking through the study mode locally without keys:

    python tests/e2e_tutor_server.py            # http://localhost:8787

Point a frontend at it with NEXT_PUBLIC_AGENT_BASE_URL=http://localhost:8787
(the Playwright e2e build already does). Never use this in production.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
os.environ.setdefault("GEMINI_API_KEY", "fake")
os.environ.setdefault("ENABLE_INTERNAL_SCHEDULER", "false")
os.environ.setdefault("DAILY_AI_CREDITS", "0")

import asyncio  # noqa: E402

from google.cloud import firestore  # noqa: E402

import db.firestore as dbmod  # noqa: E402
from conftest import FakeFirestore  # noqa: E402
from tutor_fakes import FakeTutorAI  # noqa: E402

DB = FakeFirestore()
firestore.transactional = lambda fn: fn  # the fake has no server to retry
dbmod.get_db = lambda: DB
dbmod.init_firestore = lambda: DB
import services.quota as quota  # noqa: E402

quota.get_db = lambda: DB

FAKE = FakeTutorAI()
DELAY = float(os.environ.get("FAKE_AI_DELAY", "0.4"))


async def slow_fake(prompt, user, **kw):
    await asyncio.sleep(DELAY)  # feel the loading states
    return await FAKE(prompt, user, **kw)


import services.tutor.ai as tutor_ai  # noqa: E402

tutor_ai.ask_json = slow_fake

import main  # noqa: E402
from auth.dependencies import get_current_user  # noqa: E402

main.app.dependency_overrides[get_current_user] = lambda: "e2e-omar"


@main.app.get("/__tutor_answer/{qid}")
async def _answer_key(qid: str):
    """Test hook: the right option of a question (never exists in the real app)."""
    for path, doc in DB.store.items():
        qs = (doc or {}).get("questions")
        for q in qs if isinstance(qs, list) else []:
            if q.get("id") == qid:
                return {"answer_index": q.get("answer_index"), "format": q.get("format")}
    return {"answer_index": None}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(main.app, host="127.0.0.1", port=int(os.environ.get("PORT", "8787")), log_level="warning")
