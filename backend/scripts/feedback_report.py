"""
Report on students' 👍/👎 ratings of Faten's replies (run locally).

    cd backend
    python scripts/feedback_report.py            # last 30 days
    python scripts/feedback_report.py --days 7 --limit 10

Needs the same Firebase credentials as the server (backend/.env or
serviceAccountKey.json). Prints no user ids.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.firestore import init_firestore  # noqa: E402
from services.feedback import summarize_feedback  # noqa: E402


def _short(s: str | None, n: int) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()

    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.days)).isoformat()
    db = init_firestore()
    rows = [d.to_dict() for d in db.collection("feedback").where("createdAt", ">=", since).stream()]
    rep = summarize_feedback(rows, args.limit)

    print(f"آخر {args.days} يوم: {rep['total']} تقييم — 👍 {rep['up']} / 👎 {rep['down']}", end="")
    print(f" — الرضا {rep['satisfaction']}%" if rep["satisfaction"] is not None else "")
    if rep["by_tool"]:
        print("\nحسب الأداة (الأكثر 👎 أولاً):")
        for tool, s in rep["by_tool"].items():
            print(f"  {tool:<28} 👍 {s['up']:<4} 👎 {s['down']}")
    if rep["recent_down"]:
        print("\nآخر التقييمات السلبية:")
        for r in rep["recent_down"]:
            print(f"\n— {(r['createdAt'] or '')[:16]}  أدوات: {', '.join(r['tools'] or []) or '-'}")
            print(f"  السؤال : {_short(r['question'], 160)}")
            print(f"  الرد   : {_short(r['answer'], 220)}")
            if r["comment"]:
                print(f"  تعليقه : {_short(r['comment'], 300)}")


if __name__ == "__main__":
    main()
