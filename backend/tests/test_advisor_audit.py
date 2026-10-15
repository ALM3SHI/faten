"""Correctness audit (2026-10-15): one realistic CS record traced end to end,
plus regression tests for the defects that trace found.

The record is shaped exactly like Faten's transcript parser output
(frontend/src/lib/transcript-parser.ts): the current semester sits in
completedCourses with semesterStatus "current" and no grade, and the
record's `gpa` is the parser's own recomputation (duplicates included).
"""

from __future__ import annotations

import asyncio
import datetime as dt

import pytest

import advisor_fixtures as fx
from agent.tools.advisor import _compact
from common.grade_scale import GRADE_POINTS
from services.advisor import explain
from services.advisor.catalog import load_catalog
from services.advisor.planner import PlanSettings, validate_schedule
from services.advisor.profile import build_profile, effective_gpa
from services.advisor.recommend import AdvisorPreferences, academic_standing, analyze, gpa_what_if

CAT = load_catalog()
CS = CAT.curriculum_for("uqu-478")
TODAY = dt.date(2026, 10, 14)
T1, T2, T3, T4 = "الفصل الأول 1446/1447", "الفصل الثاني 1446/1447", "الفصل الأول 1447/1448", "الفصل الأول 1448/1449"


def prow(code, h, g, sem, st="completed"):
    """One course row as the parser emits it."""
    gp = None if g is None else GRADE_POINTS.get(g, 0.0 if g == "DN" else None)
    return {"code": code, "nameAr": code, "nameEn": code, "name": code, "creditHours": h, "passHours": 0, "degree": 0,
            "grade": g, "points": 0, "gradePoints": gp, "semester": sem, "semesterEn": sem, "semesterStatus": st,
            "difficulty": "medium", "type": "theory"}


def parser_gpa(rows):
    g = [r for r in rows if r["gradePoints"] is not None and r["creditHours"] > 0]
    return round(sum(r["gradePoints"] * r["creditHours"] for r in g) / sum(r["creditHours"] for r in g), 2)


def realistic_cs_record() -> dict:
    rows = [
        prow("QR1101", 2, "A", T1), prow("IND1101", 2, "A+", T1), prow("MTH1141", 3, "B", T1), prow("ELIE1201", 4, "B+", T1),
        prow("CS1701", 3, "B+", T1), prow("CS1302", 3, "C+", T1),
        prow("QR2102", 2, "A", T2), prow("CUR1101", 0, "NP", T2), prow("CS1704", 3, "F", T2), prow("MTH1602", 3, "C", T2),
        prow("PHYS1113", 3, "B", T2), prow("ELIE1202", 4, "B", T2), prow("CS1303", 3, "C", T2),
        prow("CS1704", 3, "B", T3),              # repeated after F → passed
        prow("QR2103", 2, "A", T3), prow("AI2001", 2, "B+", T3), prow("SEC1101", 3, "B", T3),
        prow("MTH1441", 3, "W", T3),             # withdrawn …
        prow("BIO3101", 3, "C+", T3), prow("CEN2011", 3, "F", T3),   # failed, not yet passed
        prow("SEC1101", 3, "B", T3),             # duplicate row (parser artefact)
        prow("CEN2011", 3, None, T4, "current"), prow("CS2105", 3, None, T4, "current"),
        prow("SE1201", 3, None, T4, "current"), prow("DS2201", 3, None, T4, "current"),
        prow("MTH1441", 3, None, T4, "current"),  # … and retaken now
    ]
    return {"completedCourses": rows, "currentCourses": [], "gpa": parser_gpa(rows), "earnedHours": 45,
            "major": "علوم الحاسب الآلي"}


@pytest.fixture(scope="module")
def traced():
    rec = realistic_cs_record()
    p = build_profile(rec)
    r = analyze(p, CAT, CS, AdvisorPreferences(program_id="uqu-478"), "record", today=TODAY)
    return rec, p, r


# ── stage 1: profile ─────────────────────────────────────────────

def test_attempt_states_are_classified_without_double_counting(traced):
    rec, p, _ = traced
    assert rec["gpa"] == 2.70  # parser figure: counts the duplicate SEC1101 row
    # 51 graded hours: every graded attempt once (F's included, W/NP excluded, duplicate removed).
    assert (p.gpa_hours, p.gpa_points, p.computed_gpa) == (51, 137.0, 2.69)
    assert effective_gpa(p) == 2.69
    assert p.earned_hours == 45 == sum(a.credits for a in p.passed.values())  # each passed course once
    assert p.passed["CS1704"].grade == "B" and p.repeated == {"CS1704": 2}
    assert set(p.failed_unresolved) == {"CEN2011"} and "CEN2011" in p.in_progress  # failed, retaking now
    assert "MTH1441" in p.withdrawn and "MTH1441" in p.in_progress and "MTH1441" not in p.passed
    assert set(p.in_progress) == {"CEN2011", "CS2105", "SE1201", "DS2201", "MTH1441"}


def test_current_semester_stored_in_completed_courses_is_not_a_data_gap(traced):
    _, p, r = traced
    assert "current_courses" not in {g.field for g in p.data_gaps}
    assert not r["data_gaps"]


# ── stage 2: audit ───────────────────────────────────────────────

def test_audit_hours_add_up(traced):
    _, p, r = traced
    a = r["audit"]
    states = {c["code"]: c["state"] for c in a["courses"]}
    assert a["done_hours"] == 45 and a["in_progress_hours"] == 15
    assert a["remaining_required_hours"] == CS.listed_hours - 45 == 81
    assert states["CEN2011"] == "in_progress" and states["CS1704"] == "done" and states["MTH1441"] == "in_progress"
    assert a["remaining_hours_estimate"] == {"min": 92, "max": 92}  # 81 required + 11 unlisted elective hours


# ── stage 3: next term and all three plans ───────────────────────

def test_every_planned_course_satisfies_hard_constraints(traced):
    _, p, r = traced
    done0 = set(p.passed) | set(p.in_progress)
    for name, sc in r["scenarios"].items():
        seen: set[str] = set()
        for t in sc["terms"]:
            codes = [c["code"] for c in t["courses"]]
            assert len(codes) == len(set(codes))
            assert t["credits"] <= (10 if t["summer"] else sc["load_cap"])
            assert not (any(c["kind"] == "coop" for c in t["courses"]) and len(codes) > 1)
            for c in t["courses"]:
                if c["kind"] == "elective":
                    continue
                pc = CS.course(c["code"])
                assert c["code"] not in done0 | seen, (name, c["code"])
                assert all(q in done0 | seen for q in pc.prerequisites), (name, c["code"])
                assert all(q in done0 | seen | set(codes) for q in pc.corequisites)
            seen |= set(codes)
        assert sc["complete"] and {c.code for c in CS.courses} - done0 <= seen
        assert sum(c["credits"] for t in sc["terms"] for c in t["courses"] if c["kind"] == "elective") == CS.unlisted_hours
        assert sc["graduation_term"] >= sc["lower_bound"]["earliest_term"]
        assert sc["status"] == "feasible_unconfirmed"


def test_next_term_is_valid_and_marks_conditional_courses(traced):
    _, p, r = traced
    nt = {c["code"]: c for c in r["next_term"]["courses"]}
    # CEN2012 needs CEN2011 (being retaken), CS2107 needs CS2105 — both in progress.
    for code, pending in (("CEN2012", "CEN2011"), ("CS2107", "CS2105")):
        assert "conditional" in nt[code]["tags"] and pending in nt[code]["reasons"][0]
    # CS2206: the adopted college list has no prerequisite (the plan page says MTH1441) — shown, not hidden.
    assert "conditional" not in nt["CS2206"]["tags"]
    assert any("صفحة الخطة" in x and "MTH1441" in x for x in nt["CS2206"]["reasons"])
    assert "conditional" not in nt["ICC1201"]["tags"]
    check = validate_schedule(list(nt), p, CAT, CS, PlanSettings())
    assert check["valid"]
    assert any("يعتمد على نجاحك" in x for c in check["courses"] for x in c["problems"])


def test_fastest_plan_meets_the_proven_lower_bound_and_says_it_is_unconfirmed(traced):
    _, _, r = traced
    fast = r["scenarios"]["fastest"]
    assert fast["graduation_term"] == fast["lower_bound"]["earliest_term"] == "1450-2"
    text = " ".join(fast["assumptions"])
    for needle in ("ليست مؤكدة للتسجيل", "ستُجتاز", "افتراض تخطيطي", "اختيارية", "كلها لازمة"):
        assert needle in text
    s = explain.summarize_run(r)
    assert any("غير مؤكد للتسجيل" in e for e in s["effect"])
    assert "متوقع" not in " ".join(s["effect"] + s["alternatives"])


# ── regression: GPA what-if denominator ──────────────────────────

def test_gpa_what_if_weights_by_graded_hours_not_earned_hours(traced):
    _, p, _ = traced
    w = gpa_what_if(p, 12, None)
    assert w["gpa_hours"] == 51  # not the 45 earned hours
    a_plus = next(x for x in w["rows"] if x["term_average"] == "A+")["resulting_gpa"]
    assert a_plus == round((137 + 4 * 12) / (51 + 12), 2)


def test_official_earned_hours_mismatch_is_reported():
    rec = realistic_cs_record()
    rec["earnedHours"] = 51
    p = build_profile(rec)
    assert any("رأس السجل (51)" in n for n in p.notes)


# ── regression: older curriculum ─────────────────────────────────

def _plan44_record():
    rows = [fx.course(c, 3, "B", fx.T1) for c in ("CS1211", "CS1312", "CS2214", "MTH1105", "ELCE1201", "CS2102", "QR1101", "CS2315")]
    return fx.record(rows + [fx.course("QR2102", 2, "A", fx.T2)])


def _ai_plan44_record():
    """AI Plan 44 codes; the AI program has no equivalence table, so nothing maps."""
    rows = [fx.course(c, 3, "B", fx.T1) for c in ("AI2123", "AI2224", "AI2360", "AI3110", "AI3135", "AI3170")]
    return fx.record(rows, major="الذكاء الاصطناعي")


def test_older_curriculum_record_gets_no_course_or_date_advice():
    """Without an equivalence table for the program, an old-edition record still gets no plan."""
    p = build_profile(_ai_plan44_record())
    r = analyze(p, CAT, CAT.curriculum_for("uqu-1490"), AdvisorPreferences(program_id="uqu-1490"), "student", today=TODAY)
    assert r["curriculum_fit"]["verdict"] == "other_edition"
    assert r["plan_applicable"] is False and "لا يستطيع التخطيط عليها" in r["withheld_reason"]
    assert r["next_term"]["courses"] == [] and r["next_term"]["alternatives"] == [] and r["next_term"]["credits"] == 0
    assert all(sc["applicable"] is False for sc in r["scenarios"].values())
    assert r["gpa_what_if"]["available"] is False
    assert not [x for x in r["risks"] if x["kind"] in ("failed_prerequisite", "gatekeeper", "load_jump")]
    s = explain.summarize_run(r)
    assert s["what"] == r["withheld_reason"] and not s["effect"]
    assert _compact(r)["success"] is False


def test_matching_record_still_gets_advice(traced):
    _, _, r = traced
    assert r["plan_applicable"] is True and r["withheld_reason"] is None
    assert _compact(r)["success"] is True


# ── regression: academic warning certainty ───────────────────────

def test_floor_warning_is_certain_only_mathematically_and_respects_summer():
    p = build_profile(fx.record([fx.course("CS1701", 3, "F", fx.T1), fx.course("CS1302", 3, "D", fx.T1)]))
    st = academic_standing(p, AdvisorPreferences())
    assert st["warning"]["status"] == "warning" and st["warning"]["certainty"] == "mathematical"
    assert "معدلك الرسمي بنهاية فصل عادي" in st["warning"]["message"]
    summer = build_profile(fx.record([fx.course("CS1701", 3, "F", "الفصل الصيفي 1447")]))
    st2 = academic_standing(summer, AdvisorPreferences())
    assert "الصيفي لا تُمنح فيه إنذارات" in st2["warning"]["message"]
    unknown = academic_standing(build_profile(fx.record([fx.course("CS1701", 3, "D", fx.T1)])), AdvisorPreferences())
    assert unknown["warning"]["status"] == "unknown" and unknown["warning"]["certainty"] == "undetermined"


def test_chat_tool_refuses_to_advise_on_an_older_curriculum(fake_db):
    from agent.tools_executor import execute_tool

    fake_db.store[("users", "u-old", "academic_record", "main")] = _ai_plan44_record()
    out = asyncio.run(execute_tool("get_academic_plan", {}, "u-old", fake_db))
    assert out["success"] is False and out["plan_applicable"] is False


def test_transferred_cohort_record_is_planned_through_equivalences(fake_db):
    """CS Plan 44 students were all moved to the current plan: plan on it, old courses mapped."""
    from agent.tools_executor import execute_tool

    p = build_profile(_plan44_record())
    r = analyze(p, CAT, CS, AdvisorPreferences(program_id="uqu-478"), "student", today=TODAY)
    assert r["curriculum_fit"]["verdict"] == "transferred" and r["plan_applicable"] is True
    done = {c["code"] for c in r["audit"]["courses"] if c["state"] == "done"}
    assert {"CS2105", "MTH1141", "ELIE1201", "CS1303"} <= done
    assert "CS1701" not in done  # CS1211 → CS1701 is only «suggested»
    fake_db.store[("users", "u-old", "academic_record", "main")] = _plan44_record()
    out = asyncio.run(execute_tool("get_academic_plan", {}, "u-old", fake_db))
    assert out["success"] is True
