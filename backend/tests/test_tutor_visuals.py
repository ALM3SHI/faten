"""Lesson pictures: the model's description is validated, photos come only from
freely licensed Commons files that the model has looked at, and a lesson
never shows a wrong picture (services/tutor/visuals.py)."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from services.tutor import visuals


PAGES = set(range(1, 11))


def norm(raw, left=None):
    return visuals.normalize_visual(raw, PAGES, left if left is not None else [2])


# ── the model's description ───────────────────────────────────────


def test_flow_diagram_is_parsed_from_text_lines():
    v = norm({
        "kind": "diagram", "caption": "مسار الطلب", "diagram_type": "flow", "direction": "lr",
        "nodes": ["app | Client App", "db | PostgreSQL | db", "x | بدون شكل | nonsense"],
        "edges": ["app -> db | SQL Query", "db --> app | rows", "app -> ghost"],
    })
    assert v["kind"] == "diagram"
    d = v["diagram"]
    assert [n["id"] for n in d["nodes"]] == ["app", "db", "x"]
    assert d["nodes"][1]["shape"] == "db" and d["nodes"][2]["shape"] == "box"
    # the edge to an unknown node is dropped; "-->" is a reply
    assert d["edges"] == [
        {"from": "app", "to": "db", "label": "SQL Query", "reply": False},
        {"from": "db", "to": "app", "label": "rows", "reply": True},
    ]


def test_a_diagram_without_connections_is_not_shown():
    assert norm({"kind": "diagram", "diagram_type": "flow", "nodes": ["a | A", "b | B"], "edges": []}) is None
    assert norm({"kind": "diagram", "nodes": ["a | A"], "edges": ["a -> a"]}) is None


def test_a_cycle_closes_itself_when_edges_are_missing():
    v = norm({"kind": "diagram", "diagram_type": "cycle", "nodes": ["a | كتابة", "b | تنفيذ", "c | مراجعة"]})
    assert [(e["from"], e["to"]) for e in v["diagram"]["edges"]] == [("a", "b"), ("b", "c"), ("c", "a")]


def test_labels_are_kept_short():
    v = norm({"kind": "diagram", "nodes": ["a | " + "طويل " * 40, "b | B"], "edges": ["a -> b"]})
    assert len(v["diagram"]["nodes"][0]["label"]) <= visuals.LABEL_CHARS


def test_slide_must_be_a_page_of_the_lecture():
    assert norm({"kind": "slide", "page": 4, "caption": "الجدول"}) == {"kind": "slide", "caption": "الجدول", "page": 4}
    assert norm({"kind": "slide", "page": 99}) is None
    assert norm({"kind": "slide", "page": "x"}) is None


def test_at_most_two_photos_per_lesson():
    left = [visuals.MAX_PHOTOS_PER_LESSON]
    raw = {"kind": "photo", "caption": "خادم", "queries": ["server rack"]}
    assert norm(raw, left)["status"] == "pending"
    assert norm(raw, left) is not None
    assert norm(raw, left) is None
    assert norm({"kind": "photo", "queries": []}, [2]) is None


def test_none_and_garbage_mean_no_picture():
    for raw in ({"kind": "none"}, {"kind": "video"}, None, "diagram", []):
        assert norm(raw) is None


# ── Wikimedia Commons ─────────────────────────────────────────────


def commons_reply(pages):
    return {"query": {"pages": pages}}


def commons_page(title, licence, desc="", thumb=True):
    info = {"descriptionurl": f"https://commons.wikimedia.org/wiki/File:{title}", "extmetadata": {
        "LicenseShortName": {"value": licence}, "ImageDescription": {"value": f"<b>{desc}</b>"}, "Artist": {"value": "<a>Someone</a>"},
    }}
    if thumb:
        info.update(thumburl=f"https://upload.wikimedia.org/thumb/{title}", thumbwidth=800, thumbheight=600)
    return {"title": f"File:{title}", "imageinfo": [info]}


def client_for(pages, image_type="image/jpeg"):
    seen = {"search": 0, "image": 0}

    def handler(request: httpx.Request):
        if request.url.host == "commons.wikimedia.org":
            seen["search"] += 1
            assert request.url.params["gsrnamespace"] == "6"
            return httpx.Response(200, json=commons_reply(pages))
        seen["image"] += 1
        return httpx.Response(200, content=b"\xff\xd8 fake jpeg", headers={"content-type": image_type})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), seen


def test_only_freely_licensed_files_with_a_thumbnail_are_candidates():
    pages = [
        commons_page("rack.jpg", "CC BY-SA 3.0", "A server rack"),
        commons_page("pd.png", "Public domain"),
        commons_page("zero.jpg", "CC0"),
        commons_page("logo.png", "Fair use"),
        commons_page("nothumb.jpg", "CC BY 4.0", thumb=False),
    ]

    async def go():
        client, _ = client_for(pages)
        async with client:
            return await visuals.commons_candidates(client, "server rack")

    got = asyncio.run(go())
    assert [c["title"] for c in got] == ["rack.jpg", "pd.png", "zero.jpg"]
    assert got[0]["description"] == "A server rack" and got[0]["artist"] == "Someone"
    assert got[0]["license"] == "CC BY-SA 3.0"


class FakeAsk:
    def __init__(self, ranked, fits):
        self.ranked, self.fits, self.calls = ranked, list(fits), []

    async def __call__(self, prompt, user, **kw):
        self.calls.append(kw.get("kind"))
        if kw.get("kind") == "visual_rank":
            return {"ranked": self.ranked}
        assert kw.get("image") and kw["image"][1] == "image/jpeg"  # the model really looks at it
        return {"fits": self.fits.pop(0), "reason": "test"}


def test_the_model_looks_at_the_picture_before_it_is_accepted():
    pages = [commons_page("a.jpg", "CC BY 4.0"), commons_page("b.jpg", "CC BY 4.0")]

    async def go(ask):
        client, seen = client_for(pages)
        async with client:
            got = await visuals.find_photo("الخوادم", {"caption": "رف خوادم", "queries": ["server rack"]}, ask=ask, client=client)
        return got, seen

    # first choice rejected on sight, second accepted
    ask = FakeAsk([0, 1], [False, True])
    got, seen = asyncio.run(go(ask))
    assert got["title"] == "b.jpg"
    assert ask.calls == ["visual_rank", "visual_check", "visual_check"]
    assert seen["image"] == 2

    # nothing fits → no picture at all
    got, _ = asyncio.run(go(FakeAsk([0, 1], [False, False])))
    assert got is None
    got, _ = asyncio.run(go(FakeAsk([], [])))
    assert got is None


def test_a_non_image_reply_is_never_shown():
    pages = [commons_page("a.jpg", "CC BY 4.0")]

    async def go():
        client, _ = client_for(pages, image_type="text/html")
        async with client:
            return await visuals.find_photo("x", {"caption": "y", "queries": ["q"]}, ask=FakeAsk([0], [True]), client=client)

    assert asyncio.run(go()) is None


# ── storing the outcome ───────────────────────────────────────────


def lesson_with_photos():
    return {
        "topicId": "t1",
        "segments": [
            {"title": "خوادم", "markdown": "...", "pages": [1], "visual": {"kind": "photo", "caption": "رف", "queries": ["rack"], "status": "pending"}},
            {"title": "مسار", "markdown": "...", "pages": [2], "visual": {"kind": "diagram", "caption": "", "diagram": {}}},
            {"title": "تبريد", "markdown": "...", "pages": [3], "visual": {"kind": "photo", "caption": "تبريد", "queries": ["cooling"], "status": "pending"}},
        ],
        "questions": [{"id": "t1-q1"}],
    }


def test_resolve_photos_records_found_and_missing_without_touching_questions(fake_db):
    from services.tutor import store

    lesson = lesson_with_photos()
    store.save_lesson(fake_db, "hash1", "t1", lesson)
    photo = {"url": "https://upload.wikimedia.org/x.jpg", "title": "rack", "license": "CC BY 4.0", "artist": "A", "page": "p", "width": 800, "height": 600}

    async def finder(heading, visual):
        return photo if visual["queries"] == ["rack"] else None

    asyncio.run(visuals.resolve_photos(fake_db, "hash1", "t1", lesson, finder=finder))
    saved = store.get_lesson(fake_db, "hash1", "t1")
    assert saved["photos"] == {"0": {"status": "ready", "photo": photo}, "2": {"status": "none"}}
    assert saved["questions"] == [{"id": "t1-q1"}]
    assert visuals.pending_photos(saved) == []

    shown = visuals.public_visual(saved["segments"][0], saved["photos"], 0)
    assert shown["status"] == "ready" and shown["photo"]["url"].startswith("https://upload.wikimedia.org/")
    # a photo that was not found is simply not shown
    assert visuals.public_visual(saved["segments"][2], saved["photos"], 2) is None
    # diagrams pass through unchanged
    assert visuals.public_visual(saved["segments"][1], saved["photos"], 1)["kind"] == "diagram"


def test_a_failed_lookup_is_retried_later_not_recorded(fake_db):
    from services.tutor import store

    lesson = lesson_with_photos()
    store.save_lesson(fake_db, "hash2", "t1", lesson)

    async def finder(heading, visual):
        raise httpx.ConnectError("offline")

    asyncio.run(visuals.resolve_photos(fake_db, "hash2", "t1", lesson, finder=finder))
    assert visuals.pending_photos(store.get_lesson(fake_db, "hash2", "t1")) == [0, 2]


def test_background_work_is_off_in_tests_and_respects_the_daily_limit(settings, fake_db, monkeypatch):
    lesson = lesson_with_photos()
    assert settings.COURSE_BACKGROUND is False
    assert visuals.schedule_photos(fake_db, "h", "t1", lesson) is False

    monkeypatch.setattr(settings, "COURSE_BACKGROUND", True)
    monkeypatch.setattr(settings, "COURSE_PHOTO_LESSONS_PER_DAY", 1)
    monkeypatch.setitem(visuals._photo_day, "day", "")
    ran = []

    async def fake_resolve(db, fh, tid, les, **kw):
        ran.append(tid)

    monkeypatch.setattr(visuals, "resolve_photos", fake_resolve)

    async def go():
        first = visuals.schedule_photos(fake_db, "h", "t1", lesson)
        second = visuals.schedule_photos(fake_db, "h", "t2", lesson)  # over today's limit
        await asyncio.sleep(0)
        await asyncio.gather(*list(visuals._tasks))
        return first, second

    assert asyncio.run(go()) == (True, False)
    assert ran == ["t1"]


def test_lesson_json_schema_stays_small_and_flat():
    from services.tutor import schemas

    v = schemas.VISUAL
    assert set(v["properties"]) == {"kind", "caption", "diagram_type", "direction", "nodes", "edges", "queries", "page"}
    # nodes/edges are plain strings (the API rejects deeply nested schemas)
    assert v["properties"]["nodes"]["items"] == {"type": "string"}
    assert len(json.dumps(schemas.LESSON)) < 4000
