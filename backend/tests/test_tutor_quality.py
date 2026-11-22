"""Fixes from measuring real lectures (evals/course_eval.py, 2026-11-22):
a 13-page topic explained 4 of its pages, almost nothing was labelled as added
help, and the review passed claims an independent check flagged."""

import asyncio
import datetime as dt

from services.tutor import engine
from services.tutor.extract import PageContent
from test_tutor_flow import Session, api, upload  # noqa: F401  (the same fixture as the study journey)


def test_the_lesson_is_told_every_page_and_left_out_pages_get_their_own_part(api, monkeypatch):
    http, db, fake, _ = api
    prompts_seen = []
    real = fake.__call__

    async def spy(prompt, user, **kw):
        prompts_seen.append(prompt)
        return await real(prompt, user, **kw)

    monkeypatch.setattr("services.tutor.ai.ask_json", spy)
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")  # topic 1 (pages 1-2): its lesson covers both pages
    lesson_prompt = next(p for p in prompts_seen if "Teach ONE topic" in p)
    assert "The pages of this topic are: 1, 2" in lesson_prompt and "EVERY one of them" in lesson_prompt
    assert "at least one \"added\" piece" in lesson_prompt
    t1 = db.store[("tutor_cache", s.hash, "lessons", "t1")]
    assert t1["coverage"] == {"readable": 2, "missing": [], "filled": []} and fake.calls["cover"] == 0

    # topic 2 (pages 3-4): the (fake) lesson only cites pages 1-2 — the missing pages get a part of their own
    s.step("goto", topicId="t2")
    s.finish_warmup()
    s.step("next")
    t2 = db.store[("tutor_cache", s.hash, "lessons", "t2")]
    assert fake.calls["cover"] == 1
    assert t2["coverage"]["filled"] == [3, 4] and t2["coverage"]["missing"] == []
    assert t2["segments"][-1]["title"] == "ما تبقّى من الموضوع"
    assert set(engine.pages_used(t2["segments"])) >= {3, 4}


def ctx_for(db, pages_text):
    lecture = {"id": "Lq", "fileHash": "hq", "title": "L", "pageCount": len(pages_text),
               "topics": [{"id": "t1", "title": "T", "pages": [1, len(pages_text)], "concepts": []}]}
    pages = [PageContent(n=i + 1, text=t) for i, t in enumerate(pages_text)]
    now = dt.datetime.now(dt.timezone.utc)
    return engine.Ctx(db=db, uid="u", lecture=lecture, progress={"topics": {}}, now=now, charge=lambda _n: None, _pages=pages)


def test_a_part_the_reviewer_cannot_quote_the_pages_for_is_not_labelled_from_the_file(fake_db, monkeypatch):
    from tests_helpers import fake_ai

    fake_ai(monkeypatch)
    ctx = ctx_for(fake_db, ["المكدس آخر داخل أول خارج"])
    segments = [{"parts": [
        {"role": "idea", "origin": "lecture", "markdown": "آخر داخل أول خارج [ص 1]", "pages": [1]},
        {"role": "why", "origin": "lecture", "markdown": "يحمي البيانات — بلا اقتباس", "pages": [1]},
    ]}]
    review = asyncio.run(engine.review_lesson(ctx, ctx.lecture["topics"][0], segments))
    assert review["relabelled"] == 1
    assert segments[0]["parts"][0]["origin"] == "lecture"
    assert segments[0]["parts"][1]["origin"] == "added" and segments[0]["parts"][1]["unsupported"]
