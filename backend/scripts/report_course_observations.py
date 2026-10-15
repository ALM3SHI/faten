"""Courses learned from uploaded transcripts, for review (run locally).

    cd backend
    python scripts/report_course_observations.py              # conflicts + new courses
    python scripts/report_course_observations.py --json out.json

Lists, per course code, how many students' records printed it and with which
name / credit hours, and whether it is missing from the catalog or conflicts
with it. Promote reviewed courses into knowledge/catalog with provenance; this
script changes nothing. Needs the same Firebase credentials as the server.
Prints no user data.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.firestore import init_firestore  # noqa: E402
from services.course_observations import report  # noqa: E402


def _top(t: dict) -> str:
    return " | ".join(f"{k} ×{v}" for k, v in list(t.items())[:3]) or "—"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the full report to this file")
    ap.add_argument("--all", action="store_true", help="include courses that match the catalog")
    args = ap.parse_args()
    rep = report(init_firestore())
    if args.json:
        Path(args.json).write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"تعارض مع الكتالوج: {rep['conflict']} · غير موجود في الكتالوج: {rep['missing']}\n")
    for r in rep["courses"]:
        if r["catalog_status"] == "match" and not args.all:
            continue
        print(f"[{r['catalog_status']}] {r['code']} — طلاب: {r['students']} — ساعات: {_top(r['credits'])}")
        print(f"    الاسم: {_top(r['name_ar'])}")
        for i in r["issues"]:
            print(f"    {i['field']}: الكتالوج {i['catalog']} ← السجل {i['record']}")


if __name__ == "__main__":
    main()
