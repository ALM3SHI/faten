"""Official-document evidence: verified rules, conflicts, applicability, missing data.

Uses the real knowledge/catalog/uqu/documents.json plus small synthetic
document sets written to tmp_path for the conflict cases.
"""

from __future__ import annotations

import json
import shutil

import pytest

import advisor_fixtures as fx
from services.advisor import explain, rules
from services.advisor.catalog import CATALOG_ROOT, load_catalog
from services.advisor.evidence import load_documents
from services.advisor.ingest_uqu import build_catalog
from services.advisor.planner import PlanSettings, plan, prep_status, validate_schedule
from services.advisor.profile import build_profile
from services.advisor.recommend import AdvisorPreferences, academic_standing, analyze, curriculum_fit

CAT = load_catalog()
CS = CAT.curriculum_for("uqu-478")
AI = CAT.curriculum_for("uqu-1490")
DOCS = CATALOG_ROOT / "uqu" / "documents.json"


def run(rec, program="uqu-478", **prefs):
    profile = build_profile(rec)
    p = AdvisorPreferences(program_id=program, **prefs)
    return profile, analyze(profile, CAT, CAT.curriculum_for(program), p, "student", today=fx.TODAY)


# ── documents are recorded with provenance ───────────────────────

def test_every_document_has_provenance():
    for d in load_documents(DOCS):
        assert d.url.startswith("https://") and "uqu.edu.sa" in d.url
        assert d.retrieved_at == "2026-10-14"
        assert d.applicability in ("applicable", "not_applicable")
        if d.type in ("course_spec", "program_handbook"):
            assert d.sha256 and len(d.sha256) == 64 and d.bytes
        if d.applicability == "not_applicable":
            assert d.applicability_reason
    assert set(CAT.documents) >= {"spec-CS3809", "spec-AI3501", "uqu-regulation-1480", "handbook-cs-plan44"}


def test_cs3809_spec_corroborates_the_plan_without_changing_it():
    pc = CS.course("CS3809")
    assert sorted(pc.prerequisites) == ["DS2201", "SE1201"] and pc.level == 5 and pc.credits == 3
    assert pc.evidence == ["spec-CS3809"] and pc.prereq_list_corroborated
    assert pc.prereq_relation_status == "inferred"  # the spec lists both; it does not define AND/OR
    doc = CAT.documents["spec-CS3809"]
    assert (doc.doc_version, doc.doc_date) == ("1.0", "2025-04-22")
    assert "16TH MEETING" in doc.approval
    # A specification's revision date is not the curriculum's version.
    assert "2025" not in CS.version_label and CS.provenance.retrieved_at.startswith("2026-10-14")


def test_ai3501_department_approval_is_a_special_condition():
    pc = AI.course("AI3501")
    # Adopted college list (team decision) vs plan page + signed specification: the
    # disagreement stays visible as a spec_conflict; nothing is silently merged.
    assert sorted(pc.prerequisites) == ["AI3101", "AI3201"] and pc.level == 6
    assert sorted(pc.plan_page_prerequisites) == ["AI3101", "SE1201"]
    assert pc.verification == "conflicting" and not pc.prereq_list_corroborated
    assert any(i.code == "spec_conflict" and i.subject == "AI3501" and "يطابق صفحة الخطة" in i.message for i in AI.issues)
    assert [c["kind"] for c in pc.special_conditions] == ["department_approval"]
    assert pc.special_conditions[0]["source"] == "spec-AI3501"


def test_documented_electives_stay_a_partial_list():
    codes = {o.code for o in AI.elective_options}
    assert codes == {"AI4107", "AI4205", "AI4207", "AI4208", "AI4209", "AI4308"}
    assert not AI.elective_options_complete and AI.unlisted_hours == 8
    rl = next(o for o in AI.elective_options if o.code == "AI4209")
    assert rl.prerequisites == ["AI3201"] and rl.corequisites == ["AI3202"]
    assert not codes & {c.code for c in AI.courses}  # options are not merged into the required courses
    assert CS.elective_options == []  # no CS elective specification found → nothing invented


def test_older_handbooks_are_not_applied_to_the_current_plan():
    assert [(e["label"], e["total_hours"]) for e in CS.other_editions] == [("الخطة 44", 201)]
    assert [(e["label"], e["total_hours"]) for e in AI.other_editions] == [("الخطة 44", 185)]
    assert CS.stated_total_hours == 137 and AI.stated_total_hours == 132  # unchanged
    assert any(i.code == "total_hours_confirmed" for i in CS.issues)


def test_prep_year_matches_levels_one_and_two():
    for cur, hours in ((CS, 35), (AI, 36), (CAT.curriculum_for("uqu-1510"), 36)):
        assert cur.prep_year and cur.prep_year.matches_plan and cur.prep_year.hours == hours
        assert sum(c.credits for c in cur.courses if c.level in (1, 2)) == hours
    assert CAT.curriculum_for("uqu-1492").prep_year is None  # no prep-year program found for CE


# ── conflicts and applicability on synthetic documents ───────────

def _catalog_with(tmp_path, documents):
    raw = tmp_path / "raw"
    raw.mkdir()
    shutil.copy(CATALOG_ROOT / "uqu" / "raw" / "degree-478.psv", raw / "degree-478.psv")
    (tmp_path / "documents.json").write_text(json.dumps({"retrieved_at": "2026-10-14", "documents": documents}, ensure_ascii=False),
                                             encoding="utf-8")
    return build_catalog(raw)


def _spec(code, **facts):
    base = {"code": code, "title": "t", "credits": 3, "level": 5, "requirement": "required", "prerequisites": [],
            "corequisites": [], "special_conditions": []}
    return {"id": f"spec-{code}", "type": "course_spec", "title": f"spec {code}", "url": "https://drive.uqu.edu.sa/x.pdf",
            "sha256": "0" * 64, "bytes": 1, "applicability": "applicable", "applies_to": {"program_ids": ["uqu-478"]},
            "facts": {**base, **facts}}


def test_conflicting_spec_is_reported_and_the_plan_is_kept(tmp_path):
    cat = _catalog_with(tmp_path, [_spec("CS3809", level=6, prerequisites=["DS2201"])])
    cur = cat.curricula["uqu-478@2026-10-14"]
    pc = cur.course("CS3809")
    assert pc.level == 5 and sorted(pc.prerequisites) == ["DS2201", "SE1201"]  # untouched
    assert pc.verification == "conflicting" and not pc.evidence
    msg = next(i.message for i in cur.issues if i.code == "spec_conflict")
    assert "المستوى" in msg and "المتطلبات" in msg


def test_spec_adds_corequisite_and_flags_required_course_missing_from_plan(tmp_path):
    cat = _catalog_with(tmp_path, [
        _spec("CS3809", prerequisites=["DS2201", "SE1201"], corequisites=["CS3810"]),
        _spec("CS9990", requirement="required"),
    ])
    cur = cat.curricula["uqu-478@2026-10-14"]
    assert cur.course("CS3809").corequisites == ["CS3810"]
    assert any(i.code == "corequisite_from_spec" for i in cur.issues)
    assert any(i.code == "spec_course_not_in_plan" and i.subject == "CS9990" for i in cur.issues)
    assert cur.course("CS9990") is None


def test_not_applicable_documents_change_nothing(tmp_path):
    doc = _spec("CS3809", level=9)
    doc["applicability"] = "not_applicable"
    cur = _catalog_with(tmp_path, [doc]).curricula["uqu-478@2026-10-14"]
    assert cur.course("CS3809").verification == "verified"
    assert not [i for i in cur.issues if i.code.startswith("spec_")]


# ── verified rules in the engine ─────────────────────────────────

def test_rules_separate_regulation_from_planning_default():
    assert rules.rule("max_regular_load").status == "unavailable" and rules.rule("max_regular_load").value is None
    d = rules.rule("default_max_regular_load")
    assert (d.kind, d.status, d.value) == ("default", "assumption", 18)
    assert rules.rule("graduation_requirement").kind == rules.rule("warning_below_grad_gpa").kind == "standing"
    assert rules.cite("min_regular_load")["source_url"] == "https://uqu.edu.sa/App/Regulations/1480"
    assert "المقررات المعادلة" in rules.rule("max_summer_load").text_ar


@pytest.mark.parametrize("gpa,threshold,status,basis", [
    (0.85, None, "warning", "floor"),           # below 1.00: below every possible graduation GPA
    (1.55, None, "unknown", "threshold_unknown"),
    (1.90, 2.0, "warning", "student_threshold"),
    (2.40, 2.0, "clear", "student_threshold"),
])
def test_warning_status_uses_only_verified_or_student_given_thresholds(gpa, threshold, status, basis):
    p = build_profile(fx.record([], gpa=gpa))  # no graded rows → the record's GPA field is the only figure
    st = academic_standing(p, AdvisorPreferences(program_grad_gpa=threshold))
    assert (st["warning"]["status"], st["warning"]["basis"]) == (status, basis)
    assert st["graduation"]["floor"] == 1.0


def test_corequisite_may_be_taken_in_the_same_term(tmp_path):
    cat = _catalog_with(tmp_path, [_spec("CS3809", prerequisites=["DS2201", "SE1201"], corequisites=["CS3810"])])
    cur = cat.curricula["uqu-478@2026-10-14"]
    done = [fx.course(c.code, c.credits, "B", fx.T1) for c in cur.courses if c.level <= 4]
    profile = build_profile(fx.record(done))
    ok = validate_schedule(["CS3809", "CS3810"], profile, cat, cur, PlanSettings())
    assert ok["valid"], ok
    alone = validate_schedule(["CS3809"], profile, cat, cur, PlanSettings())
    assert not alone["valid"] and alone["violations"][0]["rule"] == "corequisites"
    result = plan(profile, cat, cur, PlanSettings(start_term="1448-2"), "fastest", 18)
    term_of = {c.code: t.term for t in result.terms for c in t.courses}
    assert term_of["CS3810"] <= term_of["CS3809"]


def test_department_approval_shows_in_plan_and_schedule_check():
    rec = fx.record([fx.course(c.code, c.credits, "B", fx.T1) for c in AI.courses if c.level <= 5])
    profile, r = run(rec, program="uqu-1490")
    ai3501 = next(c for c in r["next_term"]["courses"] if c["code"] == "AI3501")
    assert "needs_approval" in ai3501["tags"] and any("موافقة القسم" in x for x in ai3501["reasons"])
    out = validate_schedule(["AI3501"], profile, CAT, AI, PlanSettings())
    assert out["valid"] and any(w["rule"] == "special_condition" for w in out["warnings"])


def test_documented_elective_can_be_checked_and_reports_its_corequisite():
    rec = fx.record([fx.course(c.code, c.credits, "B", fx.T1) for c in AI.courses if c.level <= 5])
    profile, r = run(rec, program="uqu-1490")
    rl = next(o for o in r["elective_options"]["options"] if o["code"] == "AI4209")
    assert rl["eligible"] and rl["corequisites_to_pair"] == ["AI3202"]
    assert r["elective_options"]["complete"] is False
    check = validate_schedule(["AI4209"], profile, CAT, AI, PlanSettings())
    assert not check["valid"] and "AI3202" in check["courses"][0]["problems"][-1]
    assert validate_schedule(["AI4209", "AI3202"], profile, CAT, AI, PlanSettings())["valid"]


def test_prep_year_courses_skip_prerequisite_checks_only_inside_the_prep_year():
    first_term = fx.record([fx.course("CS1701", 3, "F", fx.T1), fx.course("QR1101", 2, "B", fx.T1)])
    profile = build_profile(first_term)
    assert prep_status(profile, CS)[0]
    out = validate_schedule(["CS1704"], profile, CAT, CS, PlanSettings())
    assert out["valid"] and out["notes"][0]["rule"] == "prep_year_registration"
    beyond = build_profile(fx.record([fx.course(c, h, "B", fx.T1) for c, h in fx.CS_L1 + fx.CS_L2]))
    assert not prep_status(beyond, CS)[0]
    assert not validate_schedule(["CS2107"], beyond, CAT, CS, PlanSettings())["valid"]


def test_record_from_an_older_plan_is_detected_and_lowers_confidence():
    old = fx.record([fx.course(c, 3, "B", fx.T1) for c in ("CS1211", "CS1312", "CS2214", "MTH1105", "ELCE1201", "QR1101")])
    p, r = run(old)
    fit = r["curriculum_fit"]
    assert fit["verdict"] == "other_edition" and fit["editions"][0]["label"] == "الخطة 44"
    assert {"CS1211", "CS2214"} <= set(fit["editions"][0]["matched_codes"])
    assert r["confidence"]["level"] == "low"
    assert any(u["topic"] == "curriculum_version" and "إصدار" in u["message"] for u in r["uncertainties"])
    assert curriculum_fit(build_profile(fx.high_performer()), CS)["verdict"] == "consistent"


def test_uncertainties_explain_their_effect_and_reach_the_summary():
    _, r = run(fx.failed_prerequisites())
    topics = {u["topic"] for u in r["uncertainties"]}
    assert {"electives", "offerings", "prerequisite_semantics", "max_load", "graduation_gpa"} <= topics
    assert all(u["effect"] for u in r["uncertainties"])
    _, with_load = run(fx.failed_prerequisites(), max_load=15)
    assert "max_load" not in {u["topic"] for u in with_load["uncertainties"]}
    s = explain.summarize_run(r)
    assert any("ساعة اختيارية" in x for x in s["uncertain"])
    assert {d["id"] for d in r["documents"]} >= {"spec-CS3809", "uqu-regulation-1480", "handbook-cs-plan44"}
