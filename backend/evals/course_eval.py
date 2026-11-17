"""
Measure «ذاكر محاضرة» on real lectures — before trusting it with students.

Runs the REAL pipeline (reading the file, the lecture structure, every topic's
lesson, its pictures) on each PDF in a folder, with an in-memory database, and
writes a report:

  speed      time to the course outline, to the first lesson, to everything
  grounding  page citations that point at real pages; optionally (--judge) a
             second model call per lesson part that lists any claim NOT
             supported by the lecture pages (the "invented facts" rate)
  pictures   how many parts got a diagram / slide / photo, how many photos were
             found and accepted after the model looked at them
  failures   any step that failed, with its reason

It spends real model calls. Use a SEPARATE key from the live site's, so a run
never eats the students' daily quota:

    set GEMINI_API_KEY=<a key for testing>      (PowerShell: $env:GEMINI_API_KEY=...)
    python evals/course_eval.py <folder-with-pdfs> [--judge] [--max-topics N] [--out report.md]

Nothing is uploaded anywhere except to the model API and Wikimedia Commons.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "tests"))

import datetime as dt  # noqa: E402

from conftest import FakeFirestore  # noqa: E402
from services.tutor import ai, engine, store, visuals  # noqa: E402
from services.tutor.extract import page_block  # noqa: E402
from services.tutor.ingest import IngestError, build_lecture  # noqa: E402
from services.tutor.questions import cited_pages  # noqa: E402

JUDGE = """You check a tutor's explanation against the lecture pages it must be based on.
List every factual claim in the EXPLANATION that the PAGES do not support
(general background that any textbook states is fine; numbers, names, steps,
definitions and code that are not in the pages are NOT).
Return {{"unsupported": ["short quote of the claim", ...]}} — [] when everything is supported.

PAGES:
{pages}

EXPLANATION:
{text}"""


async def judge_segment(pages_text: str, md: str) -> list[str]:
    got = await ai.ask_json(JUDGE.format(pages=pages_text[:24000], text=md[:6000]), "Check it.", kind="eval_judge", temperature=0.0, max_tokens=2048, timeout=120.0)
    items = (got or {}).get("unsupported") if isinstance(got, dict) else None
    return [str(x) for x in items or []][:20]


async def evaluate(pdf_path: Path, judge: bool, max_topics: int) -> dict:
    out: dict = {"file": pdf_path.name, "failures": [], "topics": []}
    db = FakeFirestore()
    data = pdf_path.read_bytes()
    t0 = time.perf_counter()
    try:
        lecture, pages = await build_lecture(data, pdf_path.name)
    except IngestError as exc:
        out["failures"].append(f"reading: {exc}")
        return out
    except Exception as exc:  # report, keep going with the next file
        out["failures"].append(f"reading: {type(exc).__name__}: {exc}")
        return out
    out["outline_seconds"] = round(time.perf_counter() - t0, 1)
    out["pages"] = lecture["pageCount"]
    out["vision_pages"] = len((lecture.get("extraction") or {}).get("visionPages") or [])
    out["unreadable_pages"] = len((lecture.get("extraction") or {}).get("unreadablePages") or [])
    out["title"] = lecture.get("title")
    store.save_cache(db, lecture, pages)
    lecture["id"] = "Leval"
    ctx = engine.Ctx(db=db, uid="eval", lecture=lecture, progress=engine.new_progress(lecture, dt.datetime.now(dt.timezone.utc)), now=dt.datetime.now(dt.timezone.utc), charge=lambda _n: None)
    allowed = ctx.all_page_numbers()

    for i, topic in enumerate(lecture["topics"][:max_topics]):
        row: dict = {"title": topic["title"], "pages": topic["pages"]}
        t1 = time.perf_counter()
        try:
            lesson = await engine.ensure_lesson(ctx, topic["id"])
        except Exception as exc:
            out["failures"].append(f"lesson «{topic['title']}»: {getattr(exc, 'detail', exc)}")
            out["topics"].append(row)
            continue
        row["lesson_seconds"] = round(time.perf_counter() - t1, 1)
        if i == 0:
            out["first_lesson_seconds"] = round(out["outline_seconds"] + row["lesson_seconds"], 1)
        segs = lesson["segments"]
        row["segments"] = len(segs)
        row["questions"] = len(lesson["questions"])
        cites = [p for s in segs for p in cited_pages(s["markdown"])]
        row["citations"] = len(cites)
        row["bad_citations"] = sum(1 for p in cites if p not in allowed)
        row["visuals"] = [((s.get("visual") or {}).get("kind") or "none") for s in segs]

        t2 = time.perf_counter()
        try:
            found = await visuals.resolve_photos(db, lecture["fileHash"], topic["id"], lesson)
        except Exception as exc:
            found = {}
            out["failures"].append(f"photos «{topic['title']}»: {exc}")
        row["photos_asked"] = sum(1 for k in row["visuals"] if k == "photo")
        row["photos_found"] = sum(1 for v in found.values() if v.get("status") == "ready")
        row["photo_titles"] = [v["photo"]["title"] for v in found.values() if v.get("status") == "ready"]
        row["photo_seconds"] = round(time.perf_counter() - t2, 1)

        if judge:
            text = "\n\n".join(page_block(pages[n - 1], 4000) for n in range(topic["pages"][0], topic["pages"][1] + 1) if 0 < n <= len(pages))
            claims: list[str] = []
            for s in segs:
                try:
                    claims += await judge_segment(text, s["markdown"])
                except Exception as exc:
                    out["failures"].append(f"judge «{topic['title']}»: {exc}")
            row["unsupported_claims"] = claims
        out["topics"].append(row)

    out["total_seconds"] = round(time.perf_counter() - t0, 1)
    return out


def report_md(results: list[dict], judge: bool) -> str:
    lines = ["# «ذاكر محاضرة» on real lectures", ""]
    lines.append("| File | Pages (vision) | Outline s | First lesson s | Total s | Parts | Diagram / slide / photo / none | Photos found | Bad citations" + (" | Unsupported claims" if judge else "") + " | Failures |")
    lines.append("|---" * (10 + (1 if judge else 0)) + "|")
    for r in results:
        ts = r.get("topics") or []
        kinds = [k for t in ts for k in t.get("visuals") or []]
        count = lambda k: sum(1 for x in kinds if x == k)  # noqa: E731
        asked = sum(t.get("photos_asked", 0) for t in ts)
        found = sum(t.get("photos_found", 0) for t in ts)
        row = [
            r["file"][:40],
            f"{r.get('pages', '–')} ({r.get('vision_pages', 0)})",
            str(r.get("outline_seconds", "–")),
            str(r.get("first_lesson_seconds", "–")),
            str(r.get("total_seconds", "–")),
            str(sum(t.get("segments", 0) for t in ts)),
            f"{count('diagram')} / {count('slide')} / {count('photo')} / {count('none')}",
            f"{found}/{asked}",
            str(sum(t.get("bad_citations", 0) for t in ts)),
        ]
        if judge:
            row.append(str(sum(len(t.get("unsupported_claims") or []) for t in ts)))
        row.append(str(len(r.get("failures") or [])))
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    for r in results:
        if r.get("failures") or any(t.get("unsupported_claims") for t in r.get("topics") or []):
            lines.append(f"## {r['file']}")
            for f in r.get("failures") or []:
                lines.append(f"- failure: {f}")
            for t in r.get("topics") or []:
                for c in t.get("unsupported_claims") or []:
                    lines.append(f"- unsupported in «{t['title']}»: {c}")
            lines.append("")
    return "\n".join(lines)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder")
    ap.add_argument("--judge", action="store_true", help="check every lesson part for claims the pages do not support")
    ap.add_argument("--max-topics", type=int, default=12)
    ap.add_argument("--out", default="course_eval_report.md")
    args = ap.parse_args()
    # Only when run as a tool (importing it in tests must change nothing):
    os.environ.setdefault("ENABLE_INTERNAL_SCHEDULER", "false")
    os.environ["DAILY_AI_CREDITS"] = "0"
    os.environ["COURSE_BACKGROUND"] = "false"  # photos are resolved inline here, and timed
    from config import get_settings

    get_settings.cache_clear()
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("Set GEMINI_API_KEY to a key for testing (not the live site's).")
    pdfs = sorted(Path(args.folder).glob("*.pdf"))
    if not pdfs:
        sys.exit(f"No PDF files in {args.folder}")
    results = []
    for pdf in pdfs:
        print(f"→ {pdf.name}", flush=True)
        r = await evaluate(pdf, args.judge, args.max_topics)
        print(f"  outline {r.get('outline_seconds')}s · first lesson {r.get('first_lesson_seconds')}s · total {r.get('total_seconds')}s · failures {len(r['failures'])}", flush=True)
        results.append(r)
    Path(args.out).write_text(report_md(results, args.judge), encoding="utf-8")
    Path(args.out).with_suffix(".json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"report: {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
