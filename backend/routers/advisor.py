"""
================================================================
UQU Academic Assistant — Academic advisor API («المرشد الأكاديمي»)
================================================================
Deterministic planning over the official study plans. Every endpoint is
scoped to the signed-in student's own data (the uid comes from the
verified token, never from the request body).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import db.firestore as dbmod
from auth.dependencies import get_current_user
from config import get_settings
from services import community
from services.advisor import explain, instructor_profiles, instructors, rules
from services.advisor import service as svc
from services.advisor.catalog import load_catalog, normalize_code
from services.advisor.majors import compare_programs
from services.advisor.planner import PlanSettings, validate_schedule
from services.advisor.profile import build_profile
from services.quota import refund_ai_credits, require_ai_credits

router = APIRouter(prefix="/api/advisor", tags=["Advisor"])

COST_ADVISOR_ASK = 1


@router.get("/catalog")
def catalog_overview(user_id: str = Depends(get_current_user)) -> dict:
    cat = load_catalog()
    return {
        "university": cat.university.model_dump(),
        "generated_at": cat.generated_at,
        "programs": [
            {**p.model_dump(), "curriculum": {
                "id": cat.curricula[p.curricula[-1]].id,
                "verification": cat.curricula[p.curricula[-1]].verification,
                "stated_total_hours": cat.curricula[p.curricula[-1]].stated_total_hours,
                "listed_hours": cat.curricula[p.curricula[-1]].listed_hours,
                "unlisted_hours": cat.curricula[p.curricula[-1]].unlisted_hours,
                "source_url": cat.curricula[p.curricula[-1]].provenance.source_url,
                "retrieved_at": cat.curricula[p.curricula[-1]].provenance.retrieved_at,
            }}
            for p in cat.programs.values()
        ],
        "rules": [rules.cite(r) for r in rules.RULES],
        "issues": [i.model_dump() for i in cat.issues],
    }


@router.get("/catalog/{program_id}")
def program_detail(program_id: str, user_id: str = Depends(get_current_user)) -> dict:
    cat = load_catalog()
    cur = cat.curriculum_for(program_id)
    if cur is None:
        raise HTTPException(status_code=404, detail="التخصص غير موجود.")
    return {
        "program": cat.programs[program_id].model_dump(),
        "curriculum": {**cur.model_dump(exclude={"courses"}),
                       "courses": [{**c.model_dump(), "name": cat.course_name(c.code),
                                    "name_en": cat.courses[c.code].name_en if c.code in cat.courses else ""}
                                   for c in sorted(cur.courses, key=lambda c: (c.level, c.code))]},
    }


@router.get("/settings")
def get_settings_(user_id: str = Depends(get_current_user)) -> dict:
    return svc.load_settings(dbmod.get_db(), user_id)


@router.put("/settings")
def put_settings(body: dict, user_id: str = Depends(get_current_user)) -> dict:
    return svc.save_settings(dbmod.get_db(), user_id, body)


class AnalyzeIn(BaseModel):
    overrides: dict = Field(default_factory=dict)  # try a what-if without saving it


@router.post("/analyze")
def analyze(body: AnalyzeIn, user_id: str = Depends(get_current_user)) -> dict:
    result = svc.run_analysis(dbmod.get_db(), user_id, body.overrides or None)
    result["summary"] = explain.summarize_run(result)
    return result


@router.get("/latest")
def latest(user_id: str = Depends(get_current_user)) -> dict:
    run = svc.latest_run(dbmod.get_db(), user_id)
    if not run:
        return {"run": None}
    run["summary"] = explain.summarize_run(run)
    return {"run": run}


class ScheduleIn(BaseModel):
    codes: list[str] = Field(min_length=1, max_length=12)
    summer: bool = False


@router.post("/validate-schedule")
def check_schedule(body: ScheduleIn, user_id: str = Depends(get_current_user)) -> dict:
    db = dbmod.get_db()
    cat = load_catalog()
    record, settings = svc.load_record(db, user_id), svc.load_settings(db, user_id)
    pid, _ = svc.resolve_program(settings, record, cat)
    if not pid:
        raise HTTPException(status_code=409, detail="اختر تخصصك أولاً.")
    cur = cat.curriculum_for(pid)
    profile = build_profile(record, settings.get("corrections"))
    ps = PlanSettings(max_regular_load=settings.get("max_load") or rules.DEFAULT_MAX_REGULAR_LOAD)
    return validate_schedule(body.codes, profile, cat, cur, ps, summer_term=body.summer)


class CompareIn(BaseModel):
    program_ids: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list, max_length=12)


@router.post("/compare-majors")
def compare(body: CompareIn, user_id: str = Depends(get_current_user)) -> dict:
    db = dbmod.get_db()
    cat = load_catalog()
    record, settings = svc.load_record(db, user_id), svc.load_settings(db, user_id)
    unknown = [p for p in body.program_ids if p not in cat.programs]
    if unknown:
        raise HTTPException(status_code=400, detail="تخصص غير موجود في الخطط المتاحة.")
    profile = build_profile(record, settings.get("corrections"))
    return compare_programs(profile, cat, body.program_ids or None, body.interests or settings.get("interests"),
                            settings.get("max_load") or rules.DEFAULT_MAX_REGULAR_LOAD, settings.get("start_term"))


class AskIn(BaseModel):
    run_id: str
    question: str = Field(min_length=2, max_length=800)
    history: list[dict] = Field(default_factory=list, max_length=12)


@router.post("/ask")
async def ask(body: AskIn, user_id: str = Depends(get_current_user)) -> dict:
    db = dbmod.get_db()
    run = svc.load_run(db, user_id, body.run_id)
    day = require_ai_credits(user_id, COST_ADVISOR_ASK)
    from agent.loop import get_openai_client

    client = get_openai_client()
    try:
        out = await explain.ask(run, body.question, client, get_settings().llm_model, body.history)
    finally:
        try:
            await client.close()
        except Exception:
            pass
    if out.get("source") != "llm_validated":
        refund_ai_credits(user_id, COST_ADVISOR_ASK, day)
    return out


@router.get("/instructors/{code}")
def instructor_evidence(code: str, user_id: str = Depends(get_current_user)) -> dict:
    c = normalize_code(code)
    if not c:
        raise HTTPException(status_code=400, detail="رمز المادة غير صالح.")
    providers = [instructors.VerifiedStudentProvider(dbmod.get_db()), instructors.QaymProvider()]
    out = instructors.evidence_for_course(c, providers)
    # Separate source, never merged into the verified-student numbers above.
    out["imported"] = instructor_profiles.for_course(c)
    return out


@router.get("/instructor-map")
def instructor_map(program_id: str, user_id: str = Depends(get_current_user)) -> dict:
    out = instructor_profiles.for_program(load_catalog(), program_id)
    if out is None:
        raise HTTPException(status_code=404, detail="التخصص غير موجود.")
    return out


@router.put("/instructors/{code}/review")
def instructor_review(code: str, body: dict, user_id: str = Depends(get_current_user)) -> dict:
    from datetime import datetime, timezone

    c = normalize_code(code)
    if not c:
        raise HTTPException(status_code=400, detail="رمز المادة غير صالح.")
    if community._taken_course(user_id, c) is None:
        raise HTTPException(status_code=403, detail="تقدر تقيّم محاضري المواد الموجودة في سجلك الأكاديمي فقط.")
    try:
        clean = instructors.validate_review_payload(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    now = datetime.now(timezone.utc).isoformat()
    rid = instructors.review_doc_id(user_id, c, clean["instructor"])
    ref = dbmod.get_db().collection("instructor_reviews").document(c).collection("reviews").document(rid)
    old = ref.get().to_dict() or {}
    ref.set({**clean, "uid": user_id, "updatedAt": now, "createdAt": old.get("createdAt", now), "hidden": False})
    return instructor_evidence(c, user_id)
