"""Write frontend/e2e/advisor-fixture.json from the real advisor engine.

    cd backend && python scripts/advisor_e2e_fixture.py

The Playwright mock server serves these responses, so the UI test renders
genuine engine output for a synthetic student (no real student data).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

import advisor_fixtures as fx  # noqa: E402
from services.advisor import explain, instructors, rules  # noqa: E402
from services.advisor.catalog import load_catalog  # noqa: E402
from services.advisor.majors import compare_programs  # noqa: E402
from services.advisor.planner import PlanSettings, validate_schedule  # noqa: E402
from services.advisor.profile import build_profile  # noqa: E402
from services.advisor.recommend import AdvisorPreferences, analyze  # noqa: E402

OUT = BACKEND.parent / "frontend" / "e2e" / "advisor-fixture.json"


def main() -> None:
    cat = load_catalog()
    cur = cat.curriculum_for("uqu-478")
    rec = fx.failed_prerequisites()
    profile = build_profile(rec)
    prefs = AdvisorPreferences(program_id="uqu-478", target_term="1449-1")
    run = analyze(profile, cat, cur, prefs, "student", today=fx.TODAY)
    run["run_id"] = run["inputs_fingerprint"][:20]
    run["created_at"] = "2026-10-14T12:00:00+00:00"
    run["summary"] = explain.summarize_run(run)
    overview = {
        "university": cat.university.model_dump(), "generated_at": cat.generated_at,
        "programs": [{**p.model_dump(), "curriculum": {
            "id": cat.curricula[p.curricula[-1]].id, "verification": cat.curricula[p.curricula[-1]].verification,
            "stated_total_hours": cat.curricula[p.curricula[-1]].stated_total_hours,
            "listed_hours": cat.curricula[p.curricula[-1]].listed_hours,
            "unlisted_hours": cat.curricula[p.curricula[-1]].unlisted_hours,
            "source_url": cat.curricula[p.curricula[-1]].provenance.source_url,
            "retrieved_at": cat.curricula[p.curricula[-1]].provenance.retrieved_at}} for p in cat.programs.values()],
        "rules": [rules.cite(r) for r in rules.RULES], "issues": [],
    }
    data = {
        "catalog": overview,
        "settings": {"program_id": "uqu-478", "priority": "balanced", "target_term": "1449-1"},
        "run": run,
        "validate": validate_schedule(["CS1704", "CS2105"], profile, cat, cur, PlanSettings()),
        "compare": compare_programs(profile, cat, start_term="1448-2", today=fx.TODAY),
        "instructors": instructors.evidence_for_course("CS1701", [instructors.QaymProvider()], fx.TODAY),
        "ask": {"source": "deterministic", "reason": "رُفضت صياغة الذكاء الاصطناعي لأنها خرجت عن الحقائق",
                "problems": ["رموز مقررات غير موجودة في الحقائق: ['CS9999']"], "summary": run["summary"]},
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
