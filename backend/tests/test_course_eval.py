"""The measurement tool (evals/course_eval.py) keeps working: it runs the real
pipeline end to end — here with the scripted model and no network."""

import asyncio
import sys
from pathlib import Path

from pdf_factory import make_pdf
from tests_helpers import fake_ai

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "evals"))
import course_eval  # noqa: E402


def test_course_eval_reports_speed_grounding_and_pictures(tmp_path, monkeypatch):
    fake_ai(monkeypatch)

    async def no_photo(heading, visual):
        return None

    monkeypatch.setattr(course_eval.visuals, "find_photo", no_photo)

    async def judge(pages_text, md):
        return ["رقم غير موجود في الشرائح"] if "999" in md else []

    monkeypatch.setattr(course_eval, "judge_segment", judge)

    pdf = tmp_path / "ds.pdf"
    pdf.write_bytes(make_pdf([
        ["Stacks", "A stack is a LIFO structure. Push adds on top, pop removes from the top."],
        ["Queues", "A queue is FIFO: enqueue at the rear and dequeue from the front of the line."],
    ]))
    r = asyncio.run(course_eval.evaluate(pdf, judge=True, max_topics=2))

    assert r["failures"] == []
    assert r["outline_seconds"] >= 0 and r["first_lesson_seconds"] >= r["outline_seconds"]
    t = r["topics"][0]
    assert t["segments"] == 2 and t["visuals"] == ["diagram", "photo"]
    assert t["photos_asked"] == 1 and t["photos_found"] == 0
    md = course_eval.report_md([r], judge=True)
    assert "ds.pdf" in md and "Unsupported claims" in md
