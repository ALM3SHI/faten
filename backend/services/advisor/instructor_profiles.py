"""Instructor profiles built from the team's compiled student reviews.

Data: knowledge/instructors/<uni>/profiles.json, produced by
scripts/build_instructor_profiles.py. It holds aggregate numbers, the
course-name → plan-code links (with confidence) and the qualitative
analysis written after reading every review — never comments or raw records.

This is a separate source from Faten's verified-student ratings
(instructors.py); the two are shown side by side and never merged.
"""

from __future__ import annotations

import json
from functools import lru_cache

from services.advisor.catalog import CATALOG_ROOT, Catalog

PROFILES_ROOT = CATALOG_ROOT.parent / "instructors"
THIN_EVIDENCE = 3  # fewer reviews than this for the course → shown, but flagged


@lru_cache(maxsize=4)
def load_profiles(university: str = "uqu") -> dict:
    path = PROFILES_ROOT / university / "profiles.json"
    if not path.is_file():
        return {"instructors": [], "caveats": [], "verdict_labels": {}, "source": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def _merge_links(p: dict, code: str) -> dict | None:
    """All course families of one instructor that link to `code`, merged into one entry.

    Students write the same course several ways («برمجة 1», «بايثون عملي»); counting
    each family separately listed the same instructor twice for one plan course."""
    fams = [c for c in p["courses"] if any(link["code"] == code for link in c["links"])]
    if not fams:
        return None
    n = sum(f["reviews"] for f in fams)
    avg = [f["average"] * f["reviews"] for f in fams if f["average"] is not None]
    pos = [f["positive_share"] * f["reviews"] for f in fams if f["positive_share"] is not None]
    return {
        "family": "، ".join(dict.fromkeys(f["family"] for f in fams)),
        "confidence": "likely" if any(f["confidence"] == "likely" for f in fams) else fams[0]["confidence"],
        "reviews": n,
        "average": round(sum(avg) / n, 2) if avg and n else None,
        "positive_share": round(sum(pos) / n, 2) if pos and n else None,
        "recent_reviews": sum(f["recent_reviews"] for f in fams),
    }


def _card(p: dict, labels: dict, course: dict | None) -> dict:
    a = p["analysis"]
    out = {
        "id": p["id"],
        "name": p["name"],
        "short_name": p.get("short_name") or p["name"],
        "department": p.get("department"),
        "verdict": a["verdict"],
        "verdict_label": labels.get(a["verdict"], a["verdict"]),
        "headline": a["headline"],
        "recommendation": a["recommendation"],
        "fits": a.get("fits", []),
        "not_for": a.get("not_for", []),
        "strengths": a.get("strengths", []),
        "weaknesses": a.get("weaknesses", []),
        "modes": a.get("modes", []),
        "survival": a.get("survival", []),
        "caveats": list(a.get("caveats", [])),
        "data": {
            "reviews_analyzed": p["data"]["reviews_analyzed"],
            "reviews_stated": p["data"]["reviews_stated"],
            "complete": p["data"]["complete"],
        },
        "overall": {k: p["stats"][k] for k in ("reviews", "average", "positive_share", "recent_reviews")},
        "badges": p["stats"]["badges"][:5],
        "course": None,
    }
    if course is not None:
        out["course"] = {k: course[k] for k in ("family", "confidence", "reviews", "average", "positive_share", "recent_reviews")}
        out["course"]["thin"] = course["reviews"] < THIN_EVIDENCE
        if course["recent_reviews"] == 0:
            out["caveats"].append("كل تقييمات هذا المقرر أقدم من سنتين.")
    return out


def for_course(code: str, university: str = "uqu") -> dict:
    data = load_profiles(university)
    labels = data.get("verdict_labels", {})
    cards = []
    for p in data["instructors"]:
        match = _merge_links(p, code)
        if match:
            cards.append(_card(p, labels, match))
    cards.sort(key=lambda c: (-c["course"]["reviews"], c["name"]))
    return {
        "course_code": code,
        "profiles": cards,
        "source": data.get("source", {}),
        "caveats": data.get("caveats", []),
    }


def for_program(catalog: Catalog, program_id: str, university: str = "uqu") -> dict | None:
    cur = catalog.curriculum_for(program_id)
    if cur is None:
        return None
    data = load_profiles(university)
    labels = data.get("verdict_labels", {})
    by_code: dict[str, list[dict]] = {}
    codes = {link["code"] for p in data["instructors"] for c in p["courses"] for link in c["links"] if cur.course(link["code"])}
    for code in codes:
        for p in data["instructors"]:
            m = _merge_links(p, code)
            if m:
                by_code.setdefault(code, []).append({
                    "id": p["id"], "name": p["name"], "short_name": p.get("short_name") or p["name"],
                    "verdict": p["analysis"]["verdict"],
                    "verdict_label": labels.get(p["analysis"]["verdict"], p["analysis"]["verdict"]),
                    "recommendation": p["analysis"]["recommendation"],
                    "reviews": m["reviews"], "average": m["average"], "recent_reviews": m["recent_reviews"],
                    "thin": m["reviews"] < THIN_EVIDENCE, "confidence": m["confidence"],
                })
    courses = []
    for pc in sorted(cur.courses, key=lambda x: (x.level, x.code)):
        if pc.code in by_code:
            people = sorted(by_code[pc.code], key=lambda x: (-x["reviews"], x["name"]))
            courses.append({"code": pc.code, "name": catalog.course_name(pc.code), "level": pc.level, "instructors": people})
    return {
        "program_id": program_id,
        "courses": courses,
        "covered": len(courses),
        "plan_courses": len(cur.courses),
        "instructors_total": len(data["instructors"]),
        "source": data.get("source", {}),
        "caveats": data.get("caveats", []),
    }
