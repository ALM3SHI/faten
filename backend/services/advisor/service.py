"""Firestore glue for the advisor (the engine modules stay pure).

Paths (all under the student's own document, plus one shared collection):
  users/{uid}/academic_record/main   READ ONLY here — the official parsed record
  users/{uid}/advisor/settings       preferences + student corrections (kept apart)
  users/{uid}/advisor_runs/{id}      saved results (server-written only)
  course_reviews/{CODE}              existing verified course reviews (read)
  instructor_reviews/{CODE}/reviews  verified instructor reviews (server-only)
"""

from __future__ import annotations

import datetime as dt
import re
from datetime import datetime, timezone

from fastapi import HTTPException

from services.advisor import rules
from services.advisor.catalog import Catalog, load_catalog, normalize_code
from services.advisor.planner import parse_term_key
from services.advisor.profile import build_profile
from services.advisor.recommend import AdvisorPreferences, analyze

MAX_RUNS_KEPT = 20


def _user(db, uid: str):
    return db.collection("users").document(uid)


def load_record(db, uid: str) -> dict:
    snap = _user(db, uid).collection("academic_record").document("main").get()
    return (snap.to_dict() or {}) if snap.exists else {}


def load_settings(db, uid: str) -> dict:
    snap = _user(db, uid).collection("advisor").document("settings").get()
    return (snap.to_dict() or {}) if snap.exists else {}


def clean_settings(payload: dict, catalog: Catalog) -> dict:
    """Validate a settings update; raises HTTP 400 with an Arabic reason."""
    out: dict = {}
    if "program_id" in payload:
        pid = payload["program_id"]
        if pid is not None and pid not in catalog.programs:
            raise HTTPException(status_code=400, detail="التخصص غير موجود في الخطط المتاحة.")
        out["program_id"] = pid
    if "priority" in payload:
        if payload["priority"] not in ("graduate_fast", "protect_gpa", "balanced"):
            raise HTTPException(status_code=400, detail="أولوية غير معروفة.")
        out["priority"] = payload["priority"]
    if "max_load" in payload:
        v = payload["max_load"]
        if v is not None and (not isinstance(v, int) or not (int(rules.rule("min_regular_load").value) <= v <= rules.ABSOLUTE_MAX_REGULAR_LOAD)):
            raise HTTPException(status_code=400, detail=f"حد العبء بين 10 و{rules.ABSOLUTE_MAX_REGULAR_LOAD} ساعة.")
        out["max_load"] = v
    if "summer" in payload:
        out["summer"] = bool(payload["summer"])
    for key in ("target_term", "start_term"):
        if key in payload:
            v = payload[key]
            if v and not parse_term_key(v):
                raise HTTPException(status_code=400, detail="صيغة الفصل غير صحيحة (مثال: 1449-2).")
            out[key] = v or None
    if "weekly_work_hours" in payload:
        v = payload["weekly_work_hours"]
        if v is not None and (not isinstance(v, int) or not 0 <= v <= 80):
            raise HTTPException(status_code=400, detail="ساعات الالتزام الأسبوعية بين 0 و80.")
        out["weekly_work_hours"] = v
    if "program_grad_gpa" in payload:
        v = payload["program_grad_gpa"]
        if v is not None and (not isinstance(v, (int, float)) or not 1.0 <= float(v) <= 4.0):
            raise HTTPException(status_code=400, detail="معدل التخرج بين 1.00 و4.00.")
        out["program_grad_gpa"] = float(v) if v is not None else None
    if "unavailable" in payload:
        items = []
        for it in payload["unavailable"] or []:
            code = normalize_code((it or {}).get("code"))
            term = str((it or {}).get("term") or "next")
            if not code or not (term in ("next", "summer", "all") or parse_term_key(term)):
                raise HTTPException(status_code=400, detail="بيانات «غير مطروح» غير صحيحة.")
            items.append({"code": code, "term": term})
        out["unavailable"] = items[:40]
    if "interests" in payload:
        out["interests"] = [re.sub(r"\s+", " ", str(w)).strip()[:40] for w in (payload["interests"] or []) if str(w).strip()][:12]
    if "corrections" in payload:
        out["corrections"] = _clean_corrections(payload["corrections"] or {})
    return out


def _clean_corrections(c: dict) -> dict:
    courses = []
    for row in (c.get("courses") or [])[:40]:
        code = normalize_code(row.get("code"))
        if not code:
            raise HTTPException(status_code=400, detail="رمز مقرر غير صالح في التصحيحات.")
        grade = (row.get("grade") or "").strip().upper() or None
        if grade and grade not in {"A+", "A", "B+", "B", "C+", "C", "D+", "D", "F", "DN", "W", "IC", "IP", "NP", "NF"}:
            raise HTTPException(status_code=400, detail=f"تقدير غير معروف: {grade}")
        credits = row.get("creditHours")
        if not isinstance(credits, int) or not 0 <= credits <= 12:
            raise HTTPException(status_code=400, detail="ساعات المقرر بين 0 و12.")
        status = row.get("semesterStatus") or ("current" if not grade else "completed")
        courses.append({"code": code, "creditHours": credits, "grade": grade, "semester": str(row.get("semester") or "")[:40],
                        "semesterStatus": status if status in ("completed", "current") else "completed"})
    exclude = [{"code": normalize_code(e.get("code")), "term": str(e.get("term") or "")[:40]}
               for e in (c.get("exclude") or [])[:40] if normalize_code(e.get("code"))]
    return {"courses": courses, "exclude": exclude}


def save_settings(db, uid: str, payload: dict) -> dict:
    catalog = load_catalog()
    clean = clean_settings(payload, catalog)
    ref = _user(db, uid).collection("advisor").document("settings")
    current = load_settings(db, uid)
    current.update(clean)
    current["updatedAt"] = datetime.now(timezone.utc).isoformat()
    ref.set(current)
    return current


_MAJOR_HINTS = [
    (re.compile(r"تفاعل\s*الإنسان|تفاعل\s*الانسان|human[-\s]*computer", re.I), "uqu-1981"),
    (re.compile(r"علم\s*البيانات|علوم\s*البيانات|data\s*science", re.I), "uqu-1508"),
    (re.compile(r"الأمن\s*السيبراني|الامن\s*السيبراني|أمن\s*سيبراني|cyber", re.I), "uqu-1738"),
    (re.compile(r"ذكاء|artificial", re.I), "uqu-1490"),
    (re.compile(r"برمجيات|software", re.I), "uqu-1510"),
    (re.compile(r"هندسة الحاسب|شبكات|computer eng|network", re.I), "uqu-1492"),
    (re.compile(r"علوم الحاسب|computer science", re.I), "uqu-478"),
]


def resolve_program(settings: dict, record: dict, catalog: Catalog) -> tuple[str | None, str]:
    pid = settings.get("program_id")
    if pid in catalog.programs:
        return pid, "student"
    major = f"{record.get('major') or ''} {record.get('majorEn') or ''}"
    for pattern, candidate in _MAJOR_HINTS:
        if pattern.search(major) and candidate in catalog.programs:
            return candidate, "record"
    return None, "none"


def review_stats(db, codes: list[str]) -> dict[str, dict]:
    out = {}
    for code in codes:
        agg = db.collection("course_reviews").document(code).get().to_dict() or {}
        count = int(agg.get("count") or 0)
        if count <= 0:
            continue
        out[code] = {"count": count, "averages": {
            f: round(agg.get(f"sum_{f}", 0) / count, 1) for f in ("difficulty", "workload", "usefulness")}}
    return out


def run_analysis(db, uid: str, overrides: dict | None = None, today: dt.date | None = None) -> dict:
    catalog = load_catalog()
    record = load_record(db, uid)
    settings = load_settings(db, uid)
    if overrides:
        settings = {**settings, **clean_settings(overrides, catalog)}
    pid, source = resolve_program(settings, record, catalog)
    if not pid:
        raise HTTPException(status_code=409, detail={
            "message": "اختر تخصصك أولاً: لم نتعرّف عليه من سجلك.",
            "programs": [{"id": p.id, "name": p.name_ar} for p in catalog.programs.values()],
        })
    cur = catalog.curriculum_for(pid, settings.get("curriculum_id"))
    profile = build_profile(record, settings.get("corrections"))
    fields = {k: v for k, v in settings.items() if k in AdvisorPreferences.model_fields}
    fields["program_id"] = pid  # resolved value wins; never pass the key twice
    prefs = AdvisorPreferences(**fields)
    plan_codes = [c.code for c in cur.courses if c.code not in profile.passed]
    stats = review_stats(db, plan_codes[:25])
    result = analyze(profile, catalog, cur, prefs, program_source=source, review_stats=stats, today=today)
    run_id = result["inputs_fingerprint"][:20]
    result["run_id"] = run_id
    result["created_at"] = datetime.now(timezone.utc).isoformat()
    runs = _user(db, uid).collection("advisor_runs")
    runs.document(run_id).set({"result": result, "createdAt": result["created_at"], "engine": result["engine_version"]})
    _prune_runs(runs)
    return result


def _prune_runs(runs) -> None:
    docs = list(runs.order_by("createdAt", direction="DESCENDING").stream())
    for d in docs[MAX_RUNS_KEPT:]:
        d.reference.delete()


def load_run(db, uid: str, run_id: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{20}", run_id or ""):
        raise HTTPException(status_code=400, detail="معرّف غير صالح.")
    snap = _user(db, uid).collection("advisor_runs").document(run_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="لم نجد هذه النتيجة؛ أعد التحليل.")
    return (snap.to_dict() or {}).get("result") or {}


def latest_run(db, uid: str) -> dict | None:
    docs = list(_user(db, uid).collection("advisor_runs").order_by("createdAt", direction="DESCENDING").limit(1).stream())
    return (docs[0].to_dict() or {}).get("result") if docs else None
