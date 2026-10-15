"""Course data learned from uploaded transcripts.

Every time a transcript is saved, each course on it is checked against the
course catalog (knowledge/catalog/...):

  missing   the code is not in our catalog at all → recorded as a new course
  match     code, credit hours and name agree with the catalog
  conflict  the catalog has the code but the record prints other credit
            hours (or a clearly different name) → flagged for review

UQU transcripts are printed by the registrar, so their course code, name and
credit hours are official data. Even so, nothing here edits the catalog files:
plans, levels and prerequisites can't be learned from a transcript, and one
misread PDF must not change advice for everyone. The team reviews
`scripts/report_course_observations.py` and promotes courses into the
catalog with provenance.

Firestore (server-only; clients are denied by the default rules):
  course_observations/{CODE}                    latest summary + catalog check
  course_observations/{CODE}/sightings/{hash}   one per student (re-uploads overwrite)
  course_observations_uploads/{hash}            last checked record's fingerprint

Privacy: only the course's own fields are stored — no grades, names or
student IDs. The student is a salted hash, used solely so re-uploading the
same record doesn't count twice.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone

from services.advisor.catalog import Catalog, load_catalog, normalize_code

logger = logging.getLogger(__name__)

COLLECTION = "course_observations"
SEEN_COLLECTION = "course_observations_uploads"  # {hash}: fingerprint of the last checked record
_SALT = os.getenv("COURSE_OBSERVATION_SALT", "faten-course-observations")


def _student_key(uid: str) -> str:
    return hashlib.sha256(f"{_SALT}:{uid}".encode()).hexdigest()[:20]


_AR = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي", "ـ": None})
_DIACRITICS = re.compile(r"[ً-ْٰ]")
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def normalize_name(name: str | None) -> str:
    s = _DIACRITICS.sub("", str(name or "")).translate(_AR).translate(_DIGITS).lower()
    s = re.sub(r"\b(ال)", "", s)
    s = re.sub(r"[^\w]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _names_agree(a: str, b: str) -> bool:
    """Loose: catalog and registrar spell names differently («الحاسب»/«الحاسوب»,
    «1»/«١», abbreviations). Only a clear mismatch (no shared words) counts."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb or na == nb or na in nb or nb in na:
        return True
    wa, wb = set(na.split()), set(nb.split())
    return len(wa & wb) / max(1, min(len(wa), len(wb))) >= 0.5


def _credits(c: dict) -> int | None:
    for k in ("creditHours", "credits", "hours"):
        try:
            v = int(float(c.get(k)))
            if 0 <= v <= 20:
                return v
        except (TypeError, ValueError):
            continue
    return None


def check_course(catalog: Catalog, code: str, name_ar: str, name_en: str, credits: int | None) -> dict:
    """Compare one transcript course with the catalog."""
    known = catalog.courses.get(code)
    if known is None:
        return {"status": "missing", "issues": []}
    issues = []
    if credits is not None and known.credits is not None and credits != known.credits:
        issues.append({"field": "credits", "catalog": known.credits, "record": credits})
    if name_ar and known.name_ar and not _names_agree(name_ar, known.name_ar):
        issues.append({"field": "name_ar", "catalog": known.name_ar, "record": name_ar})
    elif not name_ar and name_en and known.name_en and not _names_agree(name_en, known.name_en):
        issues.append({"field": "name_en", "catalog": known.name_en, "record": name_en})
    return {"status": "conflict" if issues else "match", "issues": issues}


def observe_record(db, uid: str, record: dict, catalog: Catalog | None = None) -> dict:
    """Check every course on a saved record and store what was seen. Never raises."""
    try:
        catalog = catalog or load_catalog()
        now = datetime.now(timezone.utc).isoformat()
        who = _student_key(uid)
        major = str(record.get("major") or "")[:80]
        seen: dict[str, dict] = {}
        for c in [*(record.get("completedCourses") or []), *(record.get("currentCourses") or [])]:
            if not isinstance(c, dict):
                continue
            code = normalize_code(c.get("code"))
            if not code:
                continue
            seen[code] = {
                "name_ar": str(c.get("nameAr") or c.get("name") or "")[:160],
                "name_en": str(c.get("nameEn") or "")[:160],
                "credits": _credits(c),
            }
        # The app re-syncs the same record often; only re-check when its courses
        # (or the catalog) changed.
        fp = hashlib.sha256(json.dumps([catalog.generated_at, major, sorted(seen.items())],
                                       ensure_ascii=False, default=str).encode()).hexdigest()[:24]
        meta = db.collection(SEEN_COLLECTION).document(who)
        prev = meta.get()
        if prev.exists and (prev.to_dict() or {}).get("fingerprint") == fp:
            return {**(prev.to_dict() or {}).get("summary", {}), "unchanged": True}
        counts = {"missing": 0, "match": 0, "conflict": 0}
        new_codes, conflicts = [], []
        col = db.collection(COLLECTION)
        for code, obs in seen.items():
            check = check_course(catalog, code, obs["name_ar"], obs["name_en"], obs["credits"])
            counts[check["status"]] += 1
            if check["status"] == "missing":
                new_codes.append(code)
            elif check["status"] == "conflict":
                conflicts.append({"code": code, "issues": check["issues"]})
            ref = col.document(code)
            ref.collection("sightings").document(who).set({**obs, "major": major, "status": check["status"],
                                                           "issues": check["issues"], "seen_at": now})
            ref.set({"code": code, **obs, "catalog_status": check["status"], "issues": check["issues"],
                     "in_catalog": check["status"] != "missing", "last_seen": now}, merge=True)
        summary = {"checked": len(seen), **counts, "new_codes": sorted(new_codes), "conflicts": conflicts}
        meta.set({"fingerprint": fp, "summary": summary, "checked_at": now})
        if new_codes or conflicts:
            logger.info("[course-observations] %d new, %d conflicting of %d courses", len(new_codes), len(conflicts), len(seen))
        return summary
    except Exception as err:  # learning must never block saving the student's record
        logger.warning("[course-observations] skipped: %s", err, exc_info=True)
        return {"checked": 0, "missing": 0, "match": 0, "conflict": 0, "new_codes": [], "conflicts": [], "error": True}


def report(db) -> dict:
    """Aggregate all sightings: how many students printed each value."""
    out = []
    for snap in db.collection(COLLECTION).stream():
        d = snap.to_dict() or {}
        sightings = [s.to_dict() or {} for s in snap.reference.collection("sightings").stream()]
        if not sightings:
            continue
        def tally(key):
            t: dict = {}
            for s in sightings:
                v = s.get(key)
                if v not in (None, ""):
                    t[v] = t.get(v, 0) + 1
            return dict(sorted(t.items(), key=lambda kv: -kv[1]))
        out.append({
            "code": d.get("code") or snap.id,
            "catalog_status": d.get("catalog_status"),
            "students": len(sightings),
            "name_ar": tally("name_ar"),
            "name_en": tally("name_en"),
            "credits": tally("credits"),
            "majors": tally("major"),
            "issues": d.get("issues") or [],
            "last_seen": d.get("last_seen"),
        })
    out.sort(key=lambda r: ({"conflict": 0, "missing": 1}.get(r["catalog_status"], 2), -r["students"], r["code"]))
    return {"courses": out,
            "missing": sum(r["catalog_status"] == "missing" for r in out),
            "conflict": sum(r["catalog_status"] == "conflict" for r in out)}
