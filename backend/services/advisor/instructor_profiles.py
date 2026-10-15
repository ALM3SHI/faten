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


def _card(p: dict, labels: dict, course: dict | None) -> dict:
    a = p["analysis"]
    out = {
        "id": p["id"],
        "name": p["name"],
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
        match = next((c for c in p["courses"] if any(link["code"] == code for link in c["links"])), None)
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
    for p in data["instructors"]:
        for c in p["courses"]:
            for link in c["links"]:
                if cur.course(link["code"]):
                    by_code.setdefault(link["code"], []).append({
                        "id": p["id"], "name": p["name"], "verdict": p["analysis"]["verdict"],
                        "verdict_label": labels.get(p["analysis"]["verdict"], p["analysis"]["verdict"]),
                        "recommendation": p["analysis"]["recommendation"],
                        "reviews": c["reviews"], "average": c["average"], "recent_reviews": c["recent_reviews"],
                        "thin": c["reviews"] < THIN_EVIDENCE, "confidence": c["confidence"],
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
