"""Phase 6b: step-by-step simulations and a YouTube video per lesson
(services/tutor/visuals.py). No real network: YouTube is a mock transport."""

import asyncio
import json

import httpx
import pytest

from services.tutor import visuals
from test_tutor_flow import Session, api, upload  # noqa: F401  (the same fixture as the study journey)

PAGES = {1, 2, 3}


# ── step-by-step simulation ─────────────────────────────────────────


def test_a_process_becomes_steps_the_student_can_play():
    v = visuals.normalize_visual(
        {"kind": "steps", "caption": "المكدس بعد كل عملية", "layout": "stack",
         "steps": ["push(3) | 3", "push(5) | 3, 5", "pop() | 3", "pop() | ", "no state here", "| x"]},
        PAGES, [2],
    )
    assert v["kind"] == "steps" and v["layout"] == "stack" and v["caption"] == "المكدس بعد كل عملية"
    assert v["steps"] == [
        {"caption": "push(3)", "items": ["3"]},
        {"caption": "push(5)", "items": ["3", "5"]},
        {"caption": "pop()", "items": ["3"]},
        {"caption": "pop()", "items": []},  # an empty state is a state
    ]
    assert visuals.normalize_visual({"kind": "steps", "steps": ["only | 1"]}, PAGES, [2]) is None
    many = visuals.parse_steps([f"s{i} | " + ", ".join(str(j) for j in range(20)) for i in range(20)])
    assert len(many) == visuals.MAX_STEPS and all(len(s["items"]) == visuals.MAX_ITEMS for s in many)
    assert visuals.normalize_visual({"kind": "steps", "steps": ["a | 1", "b | 2"]}, PAGES, [2])["layout"] == "row"


# ── YouTube ─────────────────────────────────────────────────────────


def youtube(videos: list[dict], seen: list[httpx.Request]):
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json={"items": [{"id": {"videoId": v["id"]}} for v in videos]})
        return httpx.Response(200, json={"items": [
            {"id": v["id"], "snippet": {"title": v["title"], "channelTitle": "قناة تعليمية", "description": "شرح"},
             "contentDetails": {"duration": v["duration"]},
             "status": {"embeddable": v.get("embeddable", True), "privacyStatus": v.get("privacy", "public"), "madeForKids": v.get("kids", False)}}
            for v in videos
        ]})
    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


VIDEOS = [
    {"id": "good1", "title": "شرح المكدس Stack", "duration": "PT8M30S"},
    {"id": "short", "title": "Stack in 30 seconds", "duration": "PT30S"},
    {"id": "long", "title": "Full data structures course", "duration": "PT3H"},
    {"id": "noembed", "title": "Stacks", "duration": "PT6M", "embeddable": False},
    {"id": "private", "title": "Stacks", "duration": "PT6M", "privacy": "unlisted"},
    {"id": "kids", "title": "Stacks for kids", "duration": "PT6M", "kids": True},
    {"id": "good2", "title": "Stack data structure explained", "duration": "PT12M"},
]


def test_only_public_embeddable_videos_of_a_useful_length_are_candidates():
    seen: list[httpx.Request] = []
    got = asyncio.run(visuals.youtube_candidates(youtube(VIDEOS, seen), "شرح المكدس", "KEY"))
    assert [c["id"] for c in got] == ["good1", "good2"]
    search = seen[0].url.params
    assert search["safeSearch"] == "strict" and search["videoEmbeddable"] == "true" and search["relevanceLanguage"] == "ar"


def test_the_model_picks_one_video_or_none():
    seen: list[httpx.Request] = []
    asked: list[str] = []

    async def pick(prompt, user, **kw):
        asked.append(prompt)
        return {"pick": 1}

    got = asyncio.run(visuals.find_video("المكدس", ["شرح المكدس"], ask=pick, client=youtube(VIDEOS, seen), key="KEY"))
    assert got == {"id": "good2", "title": "Stack data structure explained", "channel": "قناة تعليمية", "seconds": 720}
    assert "good1" not in asked[0] and "شرح المكدس Stack" in asked[0]

    async def none(prompt, user, **kw):
        return {"pick": -1}

    assert asyncio.run(visuals.find_video("المكدس", ["x"], ask=none, client=youtube(VIDEOS, []), key="KEY")) is None


def test_without_a_youtube_key_nothing_is_looked_up(settings):
    assert settings.YOUTUBE_API_KEY == ""
    assert asyncio.run(visuals.find_video("المكدس", ["x"], ask=None, client=None)) is None
    assert visuals.schedule_video(None, "h", "t1", {"video": {"queries": ["x"]}}, "المكدس") is False


def test_a_found_video_comes_with_the_last_part_of_the_lesson(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")
    tid = s.state["currentTopicId"]
    ref = ("tutor_cache", s.hash, "lessons", tid)
    lesson = db.store[ref]
    assert lesson["video"] == {"queries": ["stack data structure explained", "شرح المكدس هياكل البيانات"]}
    assert "video" not in s.blocks("lesson")[-1]  # not the first part

    # the background lookup found one (here: written as resolve_video would)
    async def finder(heading, queries):
        assert queries == lesson["video"]["queries"] and "—" in heading
        return {"id": "good2", "title": "Stack data structure explained", "channel": "قناة تعليمية", "seconds": 720}

    asyncio.run(visuals.resolve_video(db, s.hash, tid, db.store[ref], "المكدس — هياكل البيانات", finder=finder))
    assert db.store[ref]["videoResult"]["status"] == "ready"
    s.answer(right=True)
    s.step("next")  # the last part
    last = s.blocks("lesson")[-1]
    assert last["segment"] == last["total"] - 1
    assert last["video"] == {"id": "good2", "title": "Stack data structure explained", "channel": "قناة تعليمية", "seconds": 720}
    assert json.dumps(last).count("good2") == 1
