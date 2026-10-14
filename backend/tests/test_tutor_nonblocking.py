"""Reading a PDF must not freeze the server.

On Render's single small instance a synchronous pdfplumber run blocked the
event loop: /health timed out (5 s), the platform restarted the service in
the middle of the upload and the browser saw a CORS error from the proxy.
"""

import asyncio
import time

from pdf_factory import make_pdf
from services.tutor import extract, ingest
from tests_helpers import fake_ai


def test_pdf_reading_runs_off_the_event_loop(monkeypatch):
    fake_ai(monkeypatch)
    real = extract.extract_pages

    def slow_extract(pdf):
        time.sleep(0.6)  # a heavy lecture on a slow CPU
        return real(pdf)

    monkeypatch.setattr(ingest, "extract_pages", slow_extract)
    pdf = make_pdf([["Stacks", "A stack is a LIFO structure used for calls and undo history."]])

    async def scenario():
        ticks = 0

        async def health_checker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.05)
                ticks += 1

        checker = asyncio.create_task(health_checker())
        await ingest.build_lecture(pdf, "x.pdf")
        checker.cancel()
        return ticks

    ticks = asyncio.run(scenario())
    # ~12 ticks fit in 0.6 s; a blocked loop would manage at most one
    assert ticks >= 6


def test_table_search_is_skipped_on_pages_without_rules():
    calls = []

    class Page:
        width = height = 100
        images = []
        lines = []
        rects = []

        def extract_text(self, **kw):
            return "plain slide text without any table at all"

        def extract_tables(self):
            calls.append(1)
            return []

    extract._page_content(Page(), 1)
    assert calls == []
    Page.lines = [{}, {}, {}]
    extract._page_content(Page(), 2)
    assert calls == [1]
