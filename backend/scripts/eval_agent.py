"""
Live evaluation of the chat agent against real Gemini (run locally, not in CI).

    cd backend
    python scripts/eval_agent.py              # all cases
    python scripts/eval_agent.py reg-honors   # one case (by id prefix)

Uses an in-memory demo student (no Firestore, nothing is written anywhere),
the same prompt/tool routing as /api/chat, and evals/agent_cases.json.
Prints a table and saves evals/last_run.json so runs can be compared.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# In-memory Firestore from the test-suite (same behaviour the tests rely on).
_spec = importlib.util.spec_from_file_location("fake_conftest", BACKEND / "tests" / "conftest.py")
_conf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_conf)  # type: ignore[union-attr]

from agent.intent import classify_intent  # noqa: E402
from agent.loop import run_agent_loop  # noqa: E402
from agent.prompts import build_system_prompt  # noqa: E402
from agent.tool_policy import tools_for_intent  # noqa: E402
from config import get_settings  # noqa: E402
from schemas.chat import ChatMessage  # noqa: E402
from services import memory, news, student_tools  # noqa: E402
from services.llm import make_llm_client  # noqa: E402

UID = "eval-student"
DELAY = float(os.getenv("EVAL_DELAY", "6"))  # seconds between cases (free-tier RPM)

COMPLETED = [
    {"code": "CS1301", "nameAr": "برمجة الحاسب 1", "grade": "A", "gradePoints": 3.75, "creditHours": 4},
    {"code": "MATH1101", "nameAr": "تفاضل وتكامل 1", "grade": "C", "gradePoints": 2.0, "creditHours": 4},
    {"code": "CS2302", "nameAr": "هياكل البيانات", "grade": "B+", "gradePoints": 3.5, "creditHours": 3},
    {"code": "STAT1201", "nameAr": "مبادئ الإحصاء", "grade": "D+", "gradePoints": 1.5, "creditHours": 3},
]
CURRENT = [
    {"code": "CS4510", "nameAr": "تعلم الآلة", "creditHours": 3, "grade": None, "gradePoints": None},
    {"code": "CS4520", "nameAr": "أمن الشبكات", "creditHours": 3, "grade": None, "gradePoints": None},
    {"code": "CS4999", "nameAr": "مشروع التخرج", "creditHours": 4, "grade": None, "gradePoints": None},
]
SCHEDULE = [
    {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الثلاثاء", "start_time": "10:00", "end_time": "11:50", "type": "نظري"},
    {"course_code": "CS4510", "course_name": "تعلم الآلة", "day": "الأحد", "start_time": "10:00", "end_time": "11:50", "type": "نظري"},
    {"course_code": "CS4520", "course_name": "أمن الشبكات", "day": "الإثنين", "start_time": "11:00", "end_time": "12:50", "type": "نظري"},
    {"course_code": "CS4999", "course_name": "مشروع التخرج", "day": "الخميس", "start_time": "14:00", "end_time": "16:00", "type": "نظري"},
]


def seed(db) -> None:
    s = db.store
    s[("users", UID)] = {"profile": {"name": "طالب تجريبي", "major": "علوم الحاسب", "currentGpa": 3.05, "targetGpa": 3.5, "earnedHours": 96}}
    s[("users", UID, "academic_record", "main")] = {"gpa": 3.05, "earnedHours": 96, "planHours": 132, "completedCourses": COMPLETED, "currentCourses": CURRENT}
    s[("users", UID, "academic_record", "schedule")] = {"schedule": SCHEDULE}
    s[("users", UID, "academic_record", "attendance")] = {"courses": {
        "CS4999": {"entries": [{"id": f"x{i}", "date": "2026-09-1%d" % i, "excused": False} for i in range(3)], "totalOverride": None},
        "CS4510": {"entries": [{"id": "y1", "date": "2026-09-14", "excused": False}], "totalOverride": None},
    }}
    s[("course_reviews", "CS4510")] = {"code": "CS4510", "name": "تعلم الآلة", "count": 3, "recommend_yes": 2,
                                        "sum_difficulty": 12, "sum_workload": 11, "sum_usefulness": 14}


async def fake_news(limit: int = 8) -> dict:
    items = [
        {"title": "جامعة أم القرى تختتم برنامج «روّاد بكرة»", "link": "https://uqu.edu.sa/App/News/179693", "published": "2026-10-10T00:15:18+03:00", "summary": "", "image": None},
        {"title": "جدول الاختبارات النصفية لقسم علوم التأهيل الطبي", "link": "https://uqu.edu.sa/App/News/179689", "published": "2026-10-08T12:22:35+03:00", "summary": "", "image": None},
    ]
    return {"items": items[:limit], "source": news.FEED_URL, "stale": False}


async def run_case(case: dict, client, db) -> dict:
    msgs = [ChatMessage(role="user", content=case["q"])]
    info = await classify_intent(msgs, client)
    intent = info["intent"]
    if info.get("direct_response") and isinstance(info["direct_response"], str):
        return {"intent": intent, "tools": [], "content": info["direct_response"], "seconds": 0.0}
    record = db.store[("users", UID, "academic_record", "main")]
    prompt = build_system_prompt(
        db.store[("users", UID)], {"courses": COMPLETED, "semesters": []}, [], None,
        academic_record=record, schedule=SCHEDULE, required_blocks=["all"], intent=intent,
    ) + memory.prompt_block(memory.load_items(db, UID))
    fast = get_settings().llm_fast_model if intent in ("GENERAL_QA", "COURSE_INFO", "ACADEMIC_CALENDAR", "UNIVERSITY_NEWS") else None
    start = time.perf_counter()
    out = await run_agent_loop(
        [{"role": "system", "content": prompt}, {"role": "user", "content": case["q"]}],
        UID, db, client, with_tools_enabled=True, override_model=fast, tools_override=tools_for_intent(intent),
    )
    return {"intent": intent, "tools": [a["tool"] for a in out["actions_log"]], "content": out["content"], "seconds": time.perf_counter() - start}


def grade(case: dict, res: dict) -> tuple[bool, bool]:
    if case.get("no_tools"):
        tools_ok = not res["tools"]
    else:
        tools_ok = not case["tools"] or bool(set(case["tools"]) & set(res["tools"]))
    kws = case.get("keywords") or []
    kw_ok = not kws or any(k in (res["content"] or "") for k in kws)
    return tools_ok, kw_ok


async def main(argv: list[str]) -> int:
    cases = json.loads((BACKEND / "evals" / "agent_cases.json").read_text("utf-8"))
    if argv:
        cases = [c for c in cases if any(c["id"].startswith(a) for a in argv)]
    db = _conf.FakeFirestore()
    seed(db)
    student_tools.today_riyadh = lambda: dt.date(2026, 10, 12)  # a Monday in term 1
    news.get_news = fake_news
    import services.community as community
    community.get_db = lambda: db

    s = get_settings()
    print(f"model={s.llm_model} fast={s.llm_fast_model} cases={len(cases)}\n")
    client = make_llm_client()
    results = []
    for n, case in enumerate(cases, 1):
        try:
            res = await run_case(case, client, db)
            t_ok, k_ok = grade(case, res)
            err = None
        except Exception as exc:  # keep going; report at the end
            res, t_ok, k_ok, err = {"intent": "?", "tools": [], "content": "", "seconds": 0.0}, False, False, f"{type(exc).__name__}: {str(exc)[:160]}"
        mark = "✅" if t_ok and k_ok else ("🟡" if t_ok or k_ok else "❌")
        print(f"{mark} {case['id']:<20} intent={res['intent']:<22} tools={','.join(res['tools']) or '—':<40} {res['seconds']:.1f}s")
        if err:
            print(f"     error: {err}")
        elif not (t_ok and k_ok):
            print(f"     expected tools={case['tools']} keywords={case.get('keywords')}")
            print(f"     answer: {(res['content'] or '')[:220]!r}")
        results.append({"id": case["id"], "tools_ok": t_ok, "keywords_ok": k_ok, "error": err, **res})
        if n < len(cases):
            await asyncio.sleep(DELAY)
    await client.close()

    tools_pass = sum(r["tools_ok"] for r in results)
    both_pass = sum(r["tools_ok"] and r["keywords_ok"] for r in results)
    avg = sum(r["seconds"] for r in results) / max(1, len(results))
    print(f"\nTool choice: {tools_pass}/{len(results)}   Full pass: {both_pass}/{len(results)}   Avg time: {avg:.1f}s")
    out = BACKEND / "evals" / "last_run.json"
    out.write_text(json.dumps({"at": dt.datetime.now().isoformat(timespec="seconds"), "model": s.llm_model,
                               "results": results}, ensure_ascii=False, indent=2), "utf-8")
    print(f"Saved {out.relative_to(BACKEND)}")
    return 0 if both_pass == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
