"""Course equivalence: count courses from an earlier plan toward the current one.

Plans change (new codes, new hours, courses split or merged) and students are
moved to the new plan mid-way — e.g. UQU moved whole cohorts from the
three-term system's Plan 44 to the current two-term plans. Such a student is
assessed against the CURRENT plan, with old courses counted through
equivalences. Matching by code alone made those students look like they had
passed almost nothing.

Two sources, never mixed up:

  file      knowledge/catalog/<uni>/equivalences/<program>.json, written or
            reviewed by people. Each rule maps one or more old codes to one or
            more current codes with a confidence:
              confirmed  official table or reviewed by the college/team
              likely     clear same course (name and content); not yet reviewed
              suggested  plausible but needs a human decision → NOT applied
  inferred  at run time: an old course whose name is the same as a current
            plan course (spelling-normalised), one to one. Shown as likely.

Applying never edits the student's record: earned hours and GPA stay exactly
as printed. Only "is this plan requirement met?" changes, and every mapped
requirement carries where the mapping came from.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache

from services.advisor.catalog import CATALOG_ROOT, Catalog, Curriculum, normalize_code
from services.advisor.profile import Attempt, StudentProfile

APPLIED = ("confirmed", "likely")
CONFIDENCE_AR = {"confirmed": "معادلة مؤكدة", "likely": "معادلة مرجّحة", "suggested": "مقترحة للمراجعة"}

_AR = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي", "ـ": None})
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_DIACRITICS = re.compile(r"[ً-ْٰ]")
_NOISE = {"الي", "في", "مقدمه", "حاسب", "بالحاسب"}  # «الحاسب الآلي», «مقدمة في» don't change the course
_ROMAN = {"i": "1", "ii": "2", "iii": "3"}


def _tokens(name: str) -> tuple[str, ...]:
    s = _DIACRITICS.sub("", str(name or "")).translate(_AR).translate(_DIGITS).lower()
    s = re.sub(r"[^\w]+", " ", s)
    out = []
    for w in s.split():
        if len(w) > 3 and w.startswith("و"):  # conjunction «و»: «وتكامل», «والتكامل»
            w = w[1:]
        if len(w) > 2 and w.startswith("ال"):
            w = w[2:]
        w = _ROMAN.get(w, w)
        if w and w not in _NOISE:
            out.append(w)
    return tuple(out)


def same_name(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    return bool(ta) and ta == tb


@lru_cache(maxsize=32)
def load_rules(university: str, program_id: str) -> dict | None:
    path = CATALOG_ROOT / university / "equivalences" / f"{program_id}.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    for r in data.get("rules", []):
        r["from"] = [normalize_code(c) or c for c in r["from"]]
        r["to"] = [normalize_code(c) or c for c in r["to"]]
        r.setdefault("requires", "all")
        r.setdefault("confidence", "likely")
    return data


def apply(profile: StudentProfile, catalog: Catalog, cur: Curriculum, university: str = "uqu") -> tuple[StudentProfile, dict]:
    """Return (profile with mapped plan requirements marked passed, report)."""
    plan = {c.code: c for c in cur.courses} | {o.code: o for o in cur.elective_options}
    passed = dict(profile.passed)
    old = {c: a for c, a in passed.items() if c not in plan}
    used: set[str] = set()
    satisfied: dict[str, dict] = {}
    file_rules = load_rules(university, cur.program_id)

    def mark(targets, sources, confidence, origin, note=None):
        srcs = [passed[s] for s in sources]
        for t in targets:
            if t in passed or t in satisfied or t not in plan:
                continue
            satisfied[t] = {
                "to": t, "to_name": catalog.course_name(t), "to_credits": plan[t].credits,
                "from": [{"code": a.code, "name": a.name or catalog.course_name(a.code), "credits": a.credits,
                          "grade": a.grade} for a in srcs],
                "confidence": confidence, "confidence_label": CONFIDENCE_AR[confidence], "source": origin,
                "note": note,
            }
        used.update(sources)

    suggestions = []
    for r in (file_rules or {}).get("rules", []):
        have = [c for c in r["from"] if c in passed]
        ok = (len(have) == len(r["from"])) if r["requires"] == "all" else bool(have)
        if not ok or all(t in passed for t in r["to"]):
            continue
        if r["confidence"] in APPLIED:
            mark(r["to"], have, r["confidence"], "file", r.get("note"))
        else:
            suggestions.append({"from": have, "to": r["to"], "note": r.get("note")})

    # Run-time inference: same course name, one to one, only for what the file didn't cover.
    open_targets = [c for c in plan if c not in passed and c not in satisfied]
    for code, a in sorted(old.items()):
        if code in used:
            continue
        name = a.name or catalog.course_name(code)
        hits = [t for t in open_targets if t not in satisfied and same_name(name, catalog.course_name(t))]
        if len(hits) == 1:
            mark(hits, [code], "likely", "same_name")

    no_equivalent = sorted(c for c in old if c not in used)
    mapped_profile = profile
    if satisfied:
        extra = {}
        for t, m in satisfied.items():
            src = passed[m["from"][0]["code"]]
            extra[t] = Attempt(code=t, name=m["to_name"], credits=plan[t].credits, grade=src.grade, status="passed",
                               points=None, counts_in_gpa=False, term_key=src.term_key, term_label=src.term_label,
                               source=src.source)
        # Consumed old codes leave `passed` so they aren't also listed as "outside the plan".
        new_passed = {c: a for c, a in passed.items() if c not in used} | extra
        mapped_profile = profile.model_copy(update={"passed": new_passed})
    by_conf = {k: sum(1 for m in satisfied.values() if m["confidence"] == k) for k in APPLIED}
    report = {
        "applied": sorted(satisfied.values(), key=lambda m: m["to"]),
        "counts": {**by_conf, "total": len(satisfied)},
        "hours": sum(m["to_credits"] for m in satisfied.values()),
        "no_equivalent": [{"code": c, "name": old[c].name or catalog.course_name(c), "credits": old[c].credits}
                          for c in no_equivalent],
        "suggestions": suggestions,
        "file": None if not file_rules else {
            "from_edition": file_rules.get("from_edition"), "status": file_rules.get("status"),
            "source": file_rules.get("source"), "cohort_transferred": bool(file_rules.get("cohort_transferred")),
        },
    }
    return mapped_profile, report
