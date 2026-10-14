"""Academic advisor: the chat agent reads the deterministic planning engine."""

from fastapi import HTTPException

from agent.tools.context import ToolContext


def _compact(run: dict) -> dict:
    if run.get("plan_applicable") is False:
        return {"success": False, "plan_applicable": False, "message": run.get("withheld_reason")}
    nt = run.get("next_term") or {}
    sc = run.get("scenarios") or {}
    chosen = run.get("recommended_strategy")
    return {
        "success": True,
        "program": (run.get("program") or {}).get("name"),
        "curriculum_status": (run.get("curriculum") or {}).get("verification"),
        "next_term": nt.get("label"),
        "next_term_credits": nt.get("credits"),
        "courses": [{"code": c["code"], "name": c["name"], "credits": c["credits"], "why": (c.get("reasons") or [""])[0]}
                    for c in nt.get("courses") or []],
        "recommended_strategy": chosen,
        "strategy_reason": run.get("strategy_reason"),
        "scenarios": {k: {"graduation": v.get("graduation_label"), "terms": v.get("terms_needed"), "load_cap": v.get("load_cap")}
                      for k, v in sc.items()},
        "top_risks": [{"severity": r["severity"], "basis": r["basis"], "message": r["message"]} for r in (run.get("risks") or [])[:3]],
        "data_gaps": [g["message"] for g in run.get("data_gaps") or []],
        "confidence": (run.get("confidence") or {}).get("level"),
        "note": ("هذه نتيجة محرك حسابي يعتمد الخطة الرسمية المنشورة. الخطة ممكنة رياضياً وليست مؤكدة للتسجيل. "
                 "التفاصيل الكاملة والسيناريوهات في صفحة /advisor."),
    }


async def _get_academic_plan(ctx: ToolContext, args: dict) -> dict:
    from services.advisor import service as svc

    try:
        run = svc.run_analysis(ctx.db, ctx.user_id)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else (exc.detail or {}).get("message", "")
        return {"success": False, "message": f"{detail} افتح صفحة «المرشد الأكاديمي» (/advisor) لإكمال الإعداد."}
    return _compact(run)


HANDLERS = {"get_academic_plan": _get_academic_plan}
