"""A new lecture is prepared in the background: the upload answers at once,
the page follows the progress, a lost job is resumed without paying twice,
and a failure is refunded (services/tutor/prepare.py)."""

import asyncio
import datetime as dt

import pytest
from fastapi.testclient import TestClient

import main
from auth.dependencies import get_current_user
from pdf_factory import make_pdf
from services.tutor import prepare, visuals
from tests_helpers import fake_ai

UID = "stu-prepare"
PDF = make_pdf([
    ["Stacks", "A stack is a LIFO structure. Push adds on top, pop removes from the top."],
    ["Queues", "A queue is FIFO: enqueue at the rear and dequeue from the front of the line."],
])


@pytest.fixture
def api(fake_db, monkeypatch, settings):
    main.app.dependency_overrides[get_current_user] = lambda: UID
    fake = fake_ai(monkeypatch)
    try:
        yield TestClient(main.app), fake_db, fake, settings
    finally:
        main.app.dependency_overrides.clear()


def upload(http, pdf=PDF, background=True):
    data = {"background": "true"} if background else {}
    return http.post("/api/tutor/lectures", files={"file": ("ds.pdf", pdf, "application/pdf")}, data=data)


def credits(db):
    return (db.store.get(("ai_usage", UID)) or {}).get("used", 0)


@pytest.fixture
def captured(monkeypatch, api):
    """Background work is kept here instead of running, so a test can look
    at the job while it is 'working' and then let it finish."""
    _, _, _, settings = api
    monkeypatch.setattr(settings, "COURSE_BACKGROUND", True)
    jobs = {}

    def spawn(key, coro):
        jobs[key] = coro
        return True

    monkeypatch.setattr(visuals, "spawn", spawn)
    monkeypatch.setattr(visuals, "is_running", lambda key: key in jobs)
    return jobs


def test_without_background_work_the_upload_prepares_inline_and_opens(api):
    http, db, fake, _ = api
    r = upload(http)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lecture"]["topics"] and body["messages"]
    assert fake.calls["structure"] == 1
    assert ("users", UID, "tutor_jobs", body["lecture"]["id"]) not in db.store


def test_a_new_lecture_answers_at_once_and_reports_its_progress(api, captured):
    http, db, fake, _ = api
    r = upload(http)
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["status"] == "working" and job["stage"] == "reading" and job["stalled"] is False
    lid = job["id"]
    assert fake.calls["structure"] == 0  # nothing has run yet
    charged = credits(db)
    assert charged > 0

    # the page follows it; a second upload of the same file does not start it twice or pay twice
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]["status"] == "working"
    assert upload(http).status_code == 202
    assert credits(db) == charged and len(captured) == 1
    listed = http.get("/api/tutor/lectures").json()
    assert [p["id"] for p in listed["preparing"]] == [lid] and listed["lectures"] == []

    asyncio.run(captured.popitem()[1])  # the background work runs to the end
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"] == {"id": lid, "status": "ready", "stalled": False}
    session = http.get(f"/api/tutor/lectures/{lid}").json()
    assert session["lecture"]["fileName"] == "ds.pdf" and session["messages"]
    assert http.get("/api/tutor/lectures").json()["preparing"] == []
    assert credits(db) >= charged


def test_progress_moves_through_the_stages(api, captured, fake_db):
    http, db, _, _ = api
    lid = upload(http).json()["job"]["id"]
    seen = []
    original = prepare.store.save_job

    def spy(db_, uid, lid_, fields, merge=True):
        if "stage" in fields:
            seen.append(fields["stage"])
        return original(db_, uid, lid_, fields, merge)

    prepare.store.save_job = spy
    try:
        asyncio.run(captured.popitem()[1])
    finally:
        prepare.store.save_job = original
    assert seen[0] == "reading" and "structure" in seen and seen[-1] == "saving"


def test_a_lost_job_is_resumed_without_paying_again(api, captured):
    http, db, _, _ = api
    lid = upload(http).json()["job"]["id"]
    charged = credits(db)
    # the server restarted: the work is gone and the job went quiet
    for lost in captured.values():
        lost.close()
    captured.clear()
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)).isoformat()
    db.store[("users", UID, "tutor_jobs", lid)]["updatedAt"] = old
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]["stalled"] is True

    r = upload(http)  # the page sends the file again
    assert r.status_code == 202 and r.json()["job"]["stalled"] is False
    assert credits(db) == charged
    asyncio.run(captured.popitem()[1])
    assert http.get(f"/api/tutor/lectures/{lid}").status_code == 200


def test_a_failed_preparation_is_refunded_and_can_be_dismissed(api, captured, monkeypatch):
    http, db, fake, _ = api

    async def broken(*a, **kw):
        raise prepare.IngestError("unreadable")

    monkeypatch.setattr(prepare, "build_lecture", broken)
    lid = upload(http).json()["job"]["id"]
    asyncio.run(captured.popitem()[1])
    job = http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]
    assert job["status"] == "failed" and "ما لقيت في الملف" in job["error"]
    assert credits(db) == 0
    assert http.get("/api/tutor/lectures").json()["preparing"][0]["status"] == "failed"
    assert http.delete(f"/api/tutor/lectures/{lid}").status_code == 200
    assert http.get("/api/tutor/lectures").json()["preparing"] == []


def test_a_model_outage_is_explained_and_refunded(api, captured, monkeypatch):
    http, db, _, _ = api
    from fastapi import HTTPException

    async def down(*a, **kw):
        raise HTTPException(status_code=502, detail="خدمة الذكاء الاصطناعي متعطلة مؤقتاً. حاول بعد قليل.")

    monkeypatch.setattr(prepare, "build_lecture", down)
    lid = upload(http).json()["job"]["id"]
    asyncio.run(captured.popitem()[1])
    job = http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]
    assert job["status"] == "failed" and "متعطلة مؤقتاً" in job["error"]
    assert credits(db) == 0
    # trying again charges again (the first attempt was refunded)
    monkeypatch.undo()


def test_an_already_prepared_file_still_opens_at_once(api, captured):
    http, db, _, settings = api
    lid = upload(http).json()["job"]["id"]
    asyncio.run(captured.popitem()[1])
    r = upload(http)
    assert r.status_code == 200 and r.json()["reused"] == "mine"
    assert r.json()["lecture"]["id"] == lid


def test_scanned_pages_are_read_in_small_batches_and_a_failed_batch_loses_only_its_pages(monkeypatch):
    from services.tutor import ingest
    from services.tutor.extract import extract_pages

    pdf = make_pdf([{"image": True} for _ in range(14)])
    pages = extract_pages(pdf)
    assert sum(p.needs_vision for p in pages) == 14
    asked: list[str] = []

    async def ask(prompt, user, **kw):
        nums = [int(n) for n in __import__("re").findall(r"صفحة (\d+)", prompt)]
        asked.append(nums)
        if 7 in nums:
            raise RuntimeError("timeout on a dense batch")
        return {"pages": [{"index": i + 1, "text": "Diagram of a stack", "visual": "", "readable": True} for i in range(len(nums))]}

    monkeypatch.setattr(ingest.ai, "ask_json", ask)
    stages = []
    report = asyncio.run(ingest.read_visual_pages(pdf, pages, lambda s, d, t: stages.append((s, d, t))))
    assert [len(b) for b in asked] == [6, 6, 2]
    assert report["failed"] == list(range(7, 13))
    assert report["read"] == [1, 2, 3, 4, 5, 6, 13, 14]
    assert stages == [("vision", 0, 14), ("vision", 6, 14), ("vision", 12, 14)]


def test_the_first_unit_is_written_during_preparation_and_opens_ready(api, captured):
    """The course opens on a ready lesson: unit 1 is written while preparing
    (part of what the student paid for), not when they press start."""
    http, db, fake, _ = api
    lid = upload(http).json()["job"]["id"]
    seen = []
    original = prepare.store.save_job

    def spy(db_, uid, lid_, fields, merge=True):
        if "stage" in fields:
            seen.append(fields["stage"])
        return original(db_, uid, lid_, fields, merge)

    prepare.store.save_job = spy
    try:
        asyncio.run(captured.pop(next(k for k in captured if k.startswith("ingest:"))))
    finally:
        prepare.store.save_job = original
    assert seen.index("lesson") < seen.index("saving")
    assert fake.calls["lesson"] == 1
    lecture = http.get(f"/api/tutor/lectures/{lid}").json()["lecture"]
    digest = lecture["fileHash"]
    assert ("tutor_cache", digest, "lessons", "t1") in db.store
    assert ("tutor_cache", digest, "prep", "main") not in db.store  # the work-in-progress is tidied away

    # the student starts: the lesson is already there — no wait, no model call, no charge
    before = credits(db)
    body = http.post(f"/api/tutor/lectures/{lid}/step", json={"action": "next", "payload": {}, "version": 1}).json()
    body = http.post(f"/api/tutor/lectures/{lid}/step", json={"action": "next", "payload": {}, "version": body["state"]["version"]}).json()
    assert any(b["type"] == "lesson" for m in body["messages"] for b in m["blocks"])
    assert fake.calls["lesson"] == 1 and credits(db) == before


def test_a_failed_first_lesson_does_not_hold_the_lecture_back(api, captured, monkeypatch):
    http, db, fake, _ = api

    async def busy(ctx, tid):
        raise RuntimeError("model busy")

    monkeypatch.setattr(prepare.engine, "ensure_lesson", busy)
    lid = upload(http).json()["job"]["id"]
    asyncio.run(captured.popitem()[1])
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]["status"] == "ready"
    monkeypatch.undo()


def test_a_restart_while_writing_the_first_lesson_resumes_without_reorganising(api, captured, monkeypatch):
    http, db, fake, _ = api
    real = prepare.engine.ensure_lesson
    state = {"killed": False}

    async def dies_once(ctx, tid):
        if not state["killed"]:
            state["killed"] = True
            raise asyncio.CancelledError()  # the process stops: nothing catches this
        return await real(ctx, tid)

    monkeypatch.setattr(prepare.engine, "ensure_lesson", dies_once)
    lid = upload(http).json()["job"]["id"]
    charged = credits(db)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(captured.popitem()[1])
    assert fake.calls["structure"] == 1
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)).isoformat()
    db.store[("users", UID, "tutor_jobs", lid)]["updatedAt"] = old
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]["stalled"] is True

    assert upload(http).status_code == 202  # the page sends the file again
    asyncio.run(captured.popitem()[1])
    assert fake.calls["structure"] == 1, "the lecture was organised a second time"
    assert fake.calls["lesson"] == 1 and credits(db) == charged
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]["status"] == "ready"


def test_a_job_left_behind_after_the_lecture_was_saved_is_tidied(api, captured):
    http, db, _, _ = api
    lid = upload(http).json()["job"]["id"]
    asyncio.run(captured.popitem()[1])
    db.store[("users", UID, "tutor_jobs", lid)] = {"id": lid, "status": "working", "stage": "saving", "updatedAt": "2020-01-01T00:00:00+00:00"}
    assert http.get(f"/api/tutor/lectures/{lid}/job").json()["job"]["status"] == "ready"
    assert http.get("/api/tutor/lectures").json()["preparing"] == []
