"""The contextual chat (phase 4): search by meaning over the lecture, the
passages the student selected, and hints — not answers — while a question is
open (services/tutor/retrieval.py, engine.handle_ask)."""

import asyncio
import math
import re

import pytest

from pdf_factory import make_pdf
from services import gemini
from services.tutor import retrieval
from services.tutor.extract import PageContent
from test_tutor_flow import Session, upload

# A tiny "embedding model": words that mean the same land on the same axis.
SYNONYMS = {"fifo": "queue", "طابور": "queue", "الطابور": "queue", "enqueue": "queue", "dequeue": "queue", "queue": "queue", "queues": "queue",
            "lifo": "stack", "مكدس": "stack", "push": "stack", "pop": "stack", "stack": "stack", "stacks": "stack",
            "hash": "hash", "buckets": "hash", "hashing": "hash"}
AXES = ["queue", "stack", "hash"]


def fake_vector(text: str) -> list[float]:
    words = re.findall(r"[a-z]+|[ء-ي]+", text.lower())
    v = [float(sum(1 for w in words if SYNONYMS.get(w) == a)) for a in AXES] + [0.1]
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


@pytest.fixture
def embeddings(monkeypatch, settings):
    monkeypatch.setattr(settings, "GEMINI_EMBED_MODEL", "fake-embed")
    calls = {"documents": 0, "queries": 0}

    async def embed(texts, task_type="RETRIEVAL_DOCUMENT", timeout_seconds=60.0):
        calls["documents" if task_type == "RETRIEVAL_DOCUMENT" else "queries"] += len(texts)
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(gemini, "embed_texts", embed)
    return calls


def pages_of(*texts):
    return [PageContent(n=i + 1, text=t) for i, t in enumerate(texts)]


def test_passages_are_cut_the_same_way_every_time():
    long = "\n\n".join(f"Paragraph {i} " + "word " * 60 for i in range(10))
    ps = retrieval.passages(pages_of("Short page about stacks.", long, ""))
    assert ps[0].page == 1 and ps[0].text == "Short page about stacks."
    assert len([p for p in ps if p.page == 2]) > 1 and all(len(p.text) <= retrieval.CHUNK_CHARS * 2 for p in ps)
    assert not [p for p in ps if p.page == 3]  # an unreadable page has nothing to find
    assert [(p.page, p.i) for p in retrieval.passages(pages_of("Short page about stacks.", long, ""))] == [(p.page, p.i) for p in ps]


def test_search_finds_the_page_by_meaning_and_embeds_the_lecture_once(fake_db, embeddings):
    pages = pages_of("A stack: push and pop at the top.", "A hash function maps keys to buckets.", "Enqueue at the rear, dequeue at the front.")
    found = asyncio.run(retrieval.search(fake_db, "h1", pages, "ما معنى FIFO؟"))
    assert found[0][0].page == 3  # no word in common with the question, same meaning
    assert embeddings["documents"] == 3 and embeddings["queries"] == 1
    asyncio.run(retrieval.search(fake_db, "h1", pages, "LIFO?"))
    assert embeddings["documents"] == 3, "the lecture was embedded twice"
    assert fake_db.store[("tutor_cache", "h1", "index", "0")]["model"] == "fake-embed"


def test_a_new_embedding_model_rebuilds_the_index(fake_db, embeddings, settings, monkeypatch):
    pages = pages_of("A stack: push and pop.")
    asyncio.run(retrieval.search(fake_db, "h2", pages, "stack"))
    monkeypatch.setattr(settings, "GEMINI_EMBED_MODEL", "fake-embed-2")
    asyncio.run(retrieval.search(fake_db, "h2", pages, "stack"))
    assert embeddings["documents"] == 2


def test_without_the_embedding_model_search_returns_nothing(fake_db, monkeypatch, settings):
    monkeypatch.setattr(settings, "GEMINI_EMBED_MODEL", "fake-embed")

    async def down(*a, **kw):
        raise RuntimeError("quota")

    monkeypatch.setattr(gemini, "embed_texts", down)
    assert asyncio.run(retrieval.search(fake_db, "h3", pages_of("A stack."), "stack")) == []


LECTURE = make_pdf([
    ["Stacks", "A stack is a LIFO structure. Push adds on top and pop removes the top element."],
    ["Stacks in calls", "Function calls use the call stack: each call is pushed, each return pops it."],
    ["Queues", "A queue is FIFO: enqueue at the rear and dequeue from the front of the line."],
    ["Queues in printers", "Print jobs wait in a queue and are served in the order they arrived."],
])


@pytest.fixture
def api_prompts(api, monkeypatch):
    """The tutor's prompts, as the model would see them."""
    http, db, fake, settings = api
    seen = []
    real = fake.__call__

    async def spy(prompt, user, **kw):
        seen.append(prompt)
        return await real(prompt, user, **kw)

    monkeypatch.setattr("services.tutor.ai.ask_json", spy)
    return http, db, fake, seen


from test_tutor_flow import api  # noqa: E402,F401  (the same fixture as the study journey)


def test_asking_about_selected_passages_with_a_page_found_by_meaning(api_prompts, embeddings):
    http, db, fake, seen = api_prompts
    s = Session(http, db, upload(http, LECTURE).json())
    s.step("next")  # topic 1 (pages 1-2), its goal
    body = s.step("ask", text="هل هذا مثل الطابور؟", quotes=["Push adds on top", "  Push adds on top ", "x", "pop removes the top element"])
    student = body["messages"][0]["blocks"][0]
    assert student["quotes"] == ["Push adds on top", "pop removes the top element"]  # trimmed, no repeats, no scraps
    prompt = seen[-1]
    assert "The student selected these passages" in prompt and "<<< Push adds on top >>>" in prompt
    # «الطابور» shares no word with page 3, but means the same: it is given to the model
    assert "=== صفحة 3 ===" in prompt
    assert "open question" not in prompt  # nothing waiting for an answer yet


def test_while_a_question_is_open_the_chat_guides_instead_of_answering(api_prompts):
    http, db, fake, seen = api_prompts
    s = Session(http, db, upload(http, LECTURE).json())
    s.step("next")
    s.step("next")  # a check question is now open
    q = s.state["pending"]["question"]["prompt"]
    s.step("ask", text="وش الجواب الصحيح؟")
    prompt = seen[-1]
    assert "open question they must answer themselves" in prompt and q[:40] in prompt
    assert "do NOT give its answer" in prompt
    assert s.state["pending"] is not None  # the question is still theirs to answer
