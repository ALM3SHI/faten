"""A preparation picks up where it stopped (services/tutor/ingest.py checkpoints):
pages already read, scanned pages already sent to the model and parts of the
structure already organised are not done — or paid for — twice."""

import asyncio
import dataclasses

import pytest

from pdf_factory import make_pdf
from services.tutor import ingest, source
from services.tutor.extract import PageContent
from tests_helpers import fake_ai


class Crash(Exception):
    """The server stopping in the middle of the work."""


class MemCheckpoint:
    def __init__(self):
        self.state: dict = {}
        self.pages: list[dict] = []

    def load(self) -> dict:
        return dict(self.state)

    def load_pages(self, count: int) -> list[PageContent]:
        return [PageContent.from_dict(d) for d in self.pages][:count]

    def save_pages(self, pages) -> None:
        self.pages = [p.to_dict() for p in pages]

    def save(self, fields: dict) -> None:
        self.state.update(fields)


@pytest.fixture
def reads(monkeypatch):
    """Counts how many times the file itself is read."""
    n = {"extract": 0}
    real = source.PDF.extract

    def counting(pdf):
        n["extract"] += 1
        return real(pdf)

    monkeypatch.setattr(source, "EXTRACTORS", (dataclasses.replace(source.PDF, extract=counting),))
    return n


def test_a_restart_after_the_scanned_pages_does_not_read_them_again(monkeypatch, reads):
    fake = fake_ai(monkeypatch)
    pdf = make_pdf([["Stacks", "A stack is a LIFO structure. Push adds on top and pop removes the top."]] + [{"image": True}] * 8)
    cp = MemCheckpoint()

    def dies_at_structure(stage, done, total):
        if stage == "structure":
            raise Crash()

    with pytest.raises(Crash):
        asyncio.run(ingest.build_lecture(pdf, "x.pdf", dies_at_structure, cp))
    assert reads["extract"] == 1 and fake.calls["vision"] == 2  # 8 scanned pages: batches of 6 and 2
    assert cp.state["read"] and cp.state["visionTried"] == list(range(2, 10))

    lecture, pages = asyncio.run(ingest.build_lecture(pdf, "x.pdf", None, cp))
    assert reads["extract"] == 1, "the file was read again"
    assert fake.calls["vision"] == 2, "scanned pages were sent to the model again"
    assert fake.calls["structure"] == 1
    assert lecture["extraction"]["visionPages"] == list(range(2, 10))
    assert lecture["source"] == "pdf"
    assert all(p.source == "vision" for p in pages[1:])


def test_a_restart_in_a_long_lecture_keeps_the_parts_already_organised(monkeypatch, reads):
    fake = fake_ai(monkeypatch)
    calls = {"structure": 0}

    async def flaky(prompt, user, **kw):
        if "planning how to TEACH" in prompt:
            calls["structure"] += 1
            if calls["structure"] == 2:
                raise Crash()
        return await fake(prompt, user, **kw)

    monkeypatch.setattr("services.tutor.ai.ask_json", flaky)
    pdf = make_pdf([[f"Topic {i}", f"Page {i} explains one idea about stacks and queues in enough words."] for i in range(1, 51)])
    cp = MemCheckpoint()
    with pytest.raises(Crash):
        asyncio.run(ingest.build_lecture(pdf, "long.pdf", None, cp))
    assert len(cp.state["structureParts"]) == 1  # pages 1-40 organised and kept

    lecture, _ = asyncio.run(ingest.build_lecture(pdf, "long.pdf", None, cp))
    assert calls["structure"] == 3, "only the missing part is asked again"
    assert reads["extract"] == 1
    pages = [t["pages"] for t in lecture["topics"]]
    assert pages[0][0] == 1 and pages[-1][-1] == 50


def test_only_supported_files_are_read():
    assert source.detect(make_pdf([["A", "text"]]), "a.pdf") is source.PDF
    assert source.detect(b"PK\x03\x04 not a pdf", "slides.pptx") is None
    with pytest.raises(ingest.IngestError):
        asyncio.run(ingest.build_lecture(b"PK\x03\x04", "slides.pptx"))
