"""Every record is accepted: enrolled, between terms, or graduated."""

import advisor_fixtures as fx

from services.advisor.catalog import load_catalog
from services.advisor.profile import build_profile
from services.advisor.recommend import AdvisorPreferences, analyze
from services.advisor.record_status import project_part

CAT = load_catalog("uqu")
CS = CAT.curriculum_for("uqu-478")


def run(rec, plan_hours=None, pid="uqu-478"):
    profile = build_profile(rec)
    return analyze(profile, CAT, CAT.curriculum_for(pid), AdvisorPreferences(program_id=pid), "student",
                   today=fx.TODAY, record_plan_hours=plan_hours)


def all_cs(grade="B+", skip=()):
    return [fx.course(c.code, c.credits, grade, fx.T3) for c in CS.courses if c.code not in skip]


def test_enrolled_student():
    rec = fx.record([fx.course(c, h, "A", fx.T1) for c, h in fx.CS_L1], current=[fx.course("CS1704", 3, None, fx.T2, "current")])
    r = run(rec)
    assert r["record_status"]["status"] == "enrolled" and r["plan_applicable"]


def test_between_terms_record_is_planned_not_rejected():
    r = run(fx.near_graduation(), plan_hours=137)
    st = r["record_status"]
    assert st["status"] == "between_terms" and st["final_project"] == "part1_only"
    assert r["plan_applicable"] and {c["code"] for c in r["next_term"]["courses"]} & {"CS4902", "CS4714"}
    gap = next(g for g in r["data_gaps"] if g["field"] == "current_courses")
    assert "بين فصلين" in gap["message"]


def test_many_terms_but_98_hours_is_not_a_graduate():
    # Changed majors → many terms, project 1 passed, still far from the plan total.
    keep = {c.code for c in CS.courses if c.level <= 6} | {"CS4901"}
    rows = [fx.course(c.code, c.credits, "B", fx.T1) for c in CS.courses if c.code in keep]
    rows += [fx.course(f"OLD{100 + i}", 3, "C", fx.T2) for i in range(6)]  # courses from the previous major
    rec = fx.record(rows, earned=98)
    st = run(rec, plan_hours=137)["record_status"]
    assert st["status"] == "between_terms"
    assert any("باقي 39 ساعة" in x for x in st["reasons"])


def test_graduate_by_covering_the_plan():
    rec = fx.record(all_cs(), earned=137, gpa=3.4)
    r = run(rec, plan_hours=137)
    assert r["record_status"]["status"] == "graduated"
    assert not r["plan_applicable"] and r["next_term"]["courses"] == [] and "مبروك" in r["withheld_reason"]
    assert r["risks"] == []


def test_graduate_from_record_signals_when_plan_differs():
    rows = [fx.course(f"XX{1000 + i}", 3, "B", fx.T1) for i in range(40)]
    rows += [{**fx.course("XX4991", 3, "A", fx.T3), "nameAr": "مشروع التخرج 1"},
             {**fx.course("XX4992", 3, "A", fx.T4), "nameAr": "مشروع التخرج 2"},
             {**fx.course("XX4993", 6, "A", fx.T4), "nameAr": "التدريب التعاوني"}]
    rec = fx.record(rows, earned=132, major=None)
    assert run(rec, plan_hours=132)["record_status"]["status"] == "graduated"
    assert run(rec, plan_hours=None)["record_status"]["status"] == "likely_graduated"
    failed = rows[:-2] + [{**rows[-2], "grade": "F"}, rows[-1]]
    assert run(fx.record(failed, earned=129, major=None), plan_hours=132)["record_status"]["status"] == "between_terms"


def test_project_parts():
    assert project_part("مشروع التخرج ٢") == 2 and project_part("Graduation Project II") == 2
    assert project_part("مشروع تخرج (1)") == 1 and project_part("مشروع التخرج") is None
