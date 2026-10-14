"""Academic advisor engine: catalog integrity, exact calculations, hard
constraints and the ten required student scenarios.

All students are synthetic (tests/advisor_fixtures.py). The catalog is the
real one ingested from uqu.edu.sa (knowledge/catalog/uqu/).
"""

from __future__ import annotations

import hashlib
import random
import shutil

import pytest

import advisor_fixtures as fx
from services.advisor import explain, instructors
from services.advisor.catalog import CATALOG_ROOT, load_catalog
from services.advisor.ingest_uqu import build_catalog
from services.advisor.majors import compare_programs
from services.advisor.planner import PlanSettings, Term, next_term, plan, validate_schedule
from services.advisor.profile import build_profile, parse_term
from services.advisor.recommend import AdvisorPreferences, analyze, gpa_what_if

CAT = load_catalog()
CS = CAT.curriculum_for("uqu-478")


def run(rec, **prefs):
    profile = build_profile(rec, prefs.pop("corrections", None))
    p = AdvisorPreferences(program_id=prefs.pop("program_id", "uqu-478"), **prefs)
    cur = CAT.curriculum_for(p.program_id)
    return profile, analyze(profile, CAT, cur, p, "student", review_stats=prefs.get("stats"), today=fx.TODAY)


# ── catalog ───────────────────────────────────────────────────────

def test_catalog_matches_raw_snapshots_and_has_no_errors():
    assert set(CAT.programs) == {"uqu-478", "uqu-1490", "uqu-1510", "uqu-1492"}
    for cur in CAT.curricula.values():
        raw = (CATALOG_ROOT / "uqu" / cur.provenance.raw_file).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == cur.provenance.raw_sha256
        assert cur.provenance.source_url.startswith("https://uqu.edu.sa/App/Degrees/")
        assert not [i for i in cur.issues if i.severity == "error"]
        codes = {c.code for c in cur.courses}
        assert len(codes) == len(cur.courses), "duplicate course in a curriculum"
        for c in cur.courses:
            assert set(c.prerequisites) <= codes
            assert c.prereq_relation_status == "inferred"  # AND is our assumption, labelled
        assert cur.listed_hours == sum(c.credits for c in cur.courses)


def test_unpublished_electives_are_flagged_not_invented():
    assert (CS.stated_total_hours, CS.listed_hours, CS.unlisted_hours) == (137, 126, 11)
    assert CS.verification == "incomplete"
    assert any(i.code == "unlisted_hours" for i in CS.issues)
    assert not any(c.code.startswith("ELECTIVE") for c in CS.courses)


def test_known_official_facts():
    assert CS.course("CS1704").prerequisites == ["CS1701"]
    assert sorted(CS.course("CS3809").prerequisites) == ["DS2201", "SE1201"]
    assert CS.course("CS3901").kind == "coop" and CS.course("CS3901").credits == 6
    # Same course, different prerequisites per program — stored per curriculum.
    assert CS.course("DS2201").prerequisites == []
    assert CAT.curriculum_for("uqu-1490").course("DS2201").prerequisites == ["CS1012"]


def test_curriculum_versions_are_kept_apart(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    src = CATALOG_ROOT / "uqu" / "raw" / "degree-478.psv"
    shutil.copy(src, raw / "degree-478.psv")
    newer = src.read_text(encoding="utf-8").replace("2026-10-14T19:32:05.039Z", "2027-09-01T10:00:00.000Z")
    newer = newer.replace("8|CS4216|الطرق العلمية|3 ساعات||39370|Scientific Methods|3 hours/English|0|\n", "")
    (raw / "degree-478@2027.psv").write_text(newer, encoding="utf-8")
    cat = build_catalog(raw)
    prog = cat.programs["uqu-478"]
    assert prog.curricula == ["uqu-478@2026-10-14", "uqu-478@2027-09-01"]
    old, new = (cat.curricula[c] for c in prog.curricula)
    assert old.course("CS4216") and not new.course("CS4216")
    assert any(i.code == "plan_changed" and "CS4216" in i.message for i in new.issues)
    assert cat.curriculum_for("uqu-478", "uqu-478@2026-10-14").id == old.id
    assert cat.curriculum_for("uqu-478").id == new.id  # default: latest


def test_ingest_flags_conflicts(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    text = (CATALOG_ROOT / "uqu" / "raw" / "degree-478.psv").read_text(encoding="utf-8")
    text = text.replace("|CS1704|البرمجة الشيئية بلغة جافا|3 ساعات|متطلب واحد|", "|CS1704|البرمجة الشيئية بلغة جافا|3 ساعات|متطلبين|")
    text += "8|CS1701|برمجة الحاسب بلغة جافا|3 ساعات||1|Dup|3 hours/English|0|\n"
    text += "8|XX9999|مقرر|4 ساعات||2|X|3 hours/English|1|CS1701~A~3 hours\n"
    (raw / "degree-478.psv").write_text(text, encoding="utf-8")
    cur = build_catalog(raw).curricula["uqu-478@2026-10-14"]
    kinds = {i.code for i in cur.issues}
    assert {"prereq_count_mismatch", "duplicate_course", "hours_ar_en_mismatch"} <= kinds
    assert cur.verification == "conflicting"


# ── profile & exact calculations ─────────────────────────────────

def test_gpa_counts_every_attempt_and_skips_non_gpa_grades():
    rec = fx.record([
        fx.course("CS1701", 3, "A+", fx.T1),   # 12
        fx.course("CS1302", 3, "F", fx.T1),    # 0
        fx.course("ELIE1201", 4, "B", fx.T1),  # 12
        fx.course("MTH1141", 3, "W", fx.T1),   # excluded
        fx.course("CUR1101", 0, "NP", fx.T1),  # excluded, passed
        fx.course("QR1101", 2, "DN", fx.T2),   # 0
        fx.course("CS1302", 3, "C", fx.T2),    # 6 — repeat, both attempts count
    ])
    p = build_profile(rec)
    assert p.gpa_hours == 15 and p.gpa_points == 30.0 and p.computed_gpa == 2.0
    assert set(p.passed) == {"CS1701", "ELIE1201", "CUR1101", "CS1302"}
    assert p.earned_hours == 3 + 4 + 0 + 3
    assert p.repeated == {"CS1302": 2}
    assert "QR1101" in p.failed_unresolved and "MTH1141" in p.withdrawn
    assert [t["gpa"] for t in p.term_gpas] == [2.4, 1.2]  # T1: 24/10, T2: 6/5


def test_duplicate_rows_count_once_and_stated_gpa_wins():
    row = fx.course("CS1701", 3, "B", fx.T1)
    p = build_profile(fx.record([row, dict(row)], gpa=3.4))
    assert p.gpa_hours == 3 and any("مرة واحدة" in n for n in p.notes)
    assert p.gpa_discrepancy == 0.4 and any("يختلف" in n for n in p.notes)


@pytest.mark.parametrize("label,expected", [
    ("الفصل الأول 1445/1446", (1445, 1)), ("الفصل الثاني 1446/1447", (1446, 2)),
    ("الفصل الصيفي 1446", (1446, 3)), ("Second Semester 2023/2024", (2023, 2)), ("", None),
])
def test_parse_term(label, expected):
    assert parse_term(label) == expected


def test_gpa_what_if_is_exact():
    p = build_profile(fx.record([fx.course("CS1701", 3, "B", fx.T1), fx.course("CS1302", 3, "C", fx.T1)]))
    w = gpa_what_if(p, 6, target=3.0)
    rows = {r["term_average"]: r["resulting_gpa"] for r in w["rows"]}
    assert w["current_gpa"] == 2.5 and rows["A+"] == round((15 + 24) / 12, 2) and rows["C"] == round((15 + 12) / 12, 2)
    assert w["target"]["term_average_needed"] == 3.5


# ── hard constraints (randomised synthetic students) ─────────────

def _check_plan(result, profile, cur, settings):
    done = set(profile.passed) | set(profile.in_progress)
    seen = set()
    cap = result.load_cap
    for term in result.terms:
        codes = [c.code for c in term.courses]
        assert len(codes) == len(set(codes))
        real = [c for c in term.courses if c.kind != "elective"]
        if any(c.kind == "coop" for c in real):
            assert len(term.courses) == 1, "co-op must be alone"
        limit = settings.max_summer_load if term.summer else cap
        assert term.credits <= limit
        assert term.credits == sum(c.credits for c in term.courses)
        for c in real:
            assert c.code not in done and c.code not in seen
            for p in cur.course(c.code).prerequisites:
                assert p in done or p in seen, f"{c.code} before its prerequisite {p}"
            for u in settings.unavailable:
                if u["code"] == c.code:
                    assert u["term"] not in (term.term, "all")
        seen |= {c.code for c in real}
    if result.complete:
        assert seen | done >= {c.code for c in cur.courses}
        assert sum(c.credits for t in result.terms for c in t.courses if c.kind == "elective") == cur.unlisted_hours


@pytest.mark.parametrize("seed", range(40))
def test_random_students_never_get_a_plan_that_breaks_hard_rules(seed):
    rnd = random.Random(seed)
    pid = rnd.choice(sorted(CAT.programs))
    cur = CAT.curriculum_for(pid)
    rows = []
    for c in sorted(cur.courses, key=lambda c: c.level):
        if c.level <= rnd.randint(0, cur.levels) and all(any(r["code"] == p and r["grade"] != "F" for r in rows) for p in c.prerequisites):
            rows.append(fx.course(c.code, c.credits, rnd.choice(["A+", "B", "C", "D", "F"]), fx.T1))
    profile = build_profile(fx.record(rows))
    unavailable = [{"code": c.code, "term": rnd.choice(["1448-2", "1449-1"])} for c in rnd.sample(cur.courses, 3)]
    settings = PlanSettings(max_regular_load=rnd.choice([12, 15, 18, 21]), summer=rnd.random() < 0.5,
                            start_term="1448-2", unavailable=unavailable)
    for strategy in ("fastest", "balanced", "recovery"):
        result = plan(profile, CAT, cur, settings.model_copy(update={"heavy_limit": rnd.choice([None, 1, 2])}),
                      strategy, settings.max_regular_load)
        _check_plan(result, profile, cur, settings)
        assert result.complete
        # No schedule can finish before the proven earliest term.
        assert result.graduation_term >= result.lower_bound["earliest_term"]


def test_same_inputs_give_the_same_result():
    rec = fx.failed_prerequisites()
    _, a = run(rec)
    _, b = run(rec)
    assert a == b and a["inputs_fingerprint"] == b["inputs_fingerprint"]


def test_terms_cycle_with_and_without_summer():
    assert next_term(Term(1448, 2), summer=False) == Term(1449, 1)
    assert next_term(Term(1448, 2), summer=True) == Term(1448, 3)
    assert Term(1448, 3).label == "الفصل الصيفي 1448"


# ── the ten required scenarios ───────────────────────────────────

def test_1_high_performer_can_accelerate():
    profile, r = run(fx.high_performer(), priority="graduate_fast", summer=True)
    assert r["load"]["mode"] == "strong" and r["recommended_strategy"] == "fastest"
    fast, bal = r["scenarios"]["fastest"], r["scenarios"]["balanced"]
    assert fast["terms_needed"] <= bal["terms_needed"]
    assert r["next_term"]["credits"] >= 15
    _, no_summer = run(fx.high_performer(), priority="graduate_fast", summer=False)
    assert fast["graduation_term"] <= no_summer["scenarios"]["fastest"]["graduation_term"]
    assert not [x for x in r["risks"] if x["severity"] == "high"]


def test_2_several_failed_prerequisites_are_prioritised():
    _, r = run(fx.failed_prerequisites())
    assert r["recommended_strategy"] == "recovery"
    codes = [c["code"] for c in r["next_term"]["courses"]]
    assert "CS1701" in codes  # failed twice and gates the most courses → first
    assert "CS1704" not in codes and "CS1303" not in codes  # their prerequisites are not passed
    # Recovery does not stack two previously failed courses; the student is told why.
    alt = next(a for a in r["next_term"]["alternatives"] if a["code"] == "CS1302")
    assert "سبق رسوبك" in alt["why_not_now"]
    balanced_first = {c["code"] for c in r["scenarios"]["balanced"]["terms"][0]["courses"]}
    assert {"CS1701", "CS1302"} <= balanced_first
    high = [x for x in r["risks"] if x["severity"] == "high" and x["basis"] == "fact"]
    assert any("CS1701" in x["message"] and "مرتين" in x["message"] for x in high)
    cs1701 = next(c for c in r["next_term"]["courses"] if c["code"] == "CS1701")
    assert any("إعادة" in why for why in cs1701["reasons"]) and cs1701["unlocks"]


def test_3_low_gpa_gets_a_recovery_plan():
    profile, r = run(fx.low_gpa_recovery(), program_grad_gpa=2.0)
    assert r["load"]["mode"] == "recovery" and r["recommended_strategy"] == "recovery"
    assert r["next_term"]["credits"] <= 12
    assert all(t["credits"] <= 12 for t in r["scenarios"]["recovery"]["terms"] if not t["summer"])
    assert any(x["kind"] == "academic_warning" and x["basis"] == "fact" for x in r["risks"])
    first = [c["code"] for c in r["next_term"]["courses"]]
    assert "CS1704" in first  # failed, and gates five later courses


def test_3b_warning_status_is_not_claimed_without_the_program_threshold():
    _, r = run(fx.low_gpa_recovery())  # GPA 1.55, program graduation GPA not given
    kinds = {x["kind"]: x for x in r["risks"]}
    assert "academic_warning" not in kinds and "possible_warning" not in kinds
    assert r["standing"]["warning"]["status"] == "unknown"
    assert r["standing"]["graduation"]["program_gpa_source"] == "unknown"
    assert "2.00" not in r["standing"]["warning"]["message"]  # no invented universal threshold


def test_4_near_graduation():
    _, r = run(fx.near_graduation())
    codes = {c["code"] for c in r["next_term"]["courses"]}
    assert {"CS4902", "CS4714"} <= codes
    assert r["audit"]["remaining_required_hours"] == 5
    assert not r["next_term"]["warnings"]  # graduating: below 10 hours is allowed
    fastest = r["scenarios"]["fastest"]
    assert fastest["complete"] and fastest["terms_needed"] == 1  # 5 h + 11 elective hours fit 18


def test_5_choosing_between_majors():
    profile = build_profile(fx.python_track_student())
    out = compare_programs(profile, CAT, interests=["machine learning", "تعلم"], start_term="1448-2", today=fx.TODAY)
    rows = {r["program_id"]: r for r in out["programs"]}
    assert set(rows) == set(CAT.programs)
    assert rows["uqu-1490"]["overlap_hours"] > rows["uqu-1510"]["overlap_hours"]
    assert rows["uqu-1490"]["interest_matches"]
    assert "لا يضمن" in out["disclaimer"] and out["transfer_rules"]
    for r in rows.values():
        assert r["fastest_terms"] and r["evidence"]
    text = str(out)
    assert "راتب" not in text and "وظيفة مضمونة" not in text


def test_6_required_course_not_offered_next_term():
    rec = fx.record([fx.course(c, h, "B", fx.T1) for c, h in fx.CS_L1 + fx.CS_L2])
    _, base = run(rec)
    assert "CS2105" in {c["code"] for c in base["next_term"]["courses"]}
    _, r = run(rec, unavailable=[{"code": "CS2105", "term": "next"}])
    assert "CS2105" not in {c["code"] for c in r["next_term"]["courses"]}
    for s in r["scenarios"].values():
        first = s["terms"][0]
        assert "CS2105" not in {c["code"] for c in first["courses"]}
    assert r["scenarios"]["fastest"]["terms_needed"] >= base["scenarios"]["fastest"]["terms_needed"]


def test_7_incomplete_records_are_never_filled_in():
    _, empty = run(fx.record([]))
    assert empty["confidence"]["level"] == "low"
    assert any(g["field"] == "transcript" for g in empty["data_gaps"])
    assert empty["profile"]["gpa"] is None and empty["gpa_what_if"] == {"available": False}

    rec = fx.record([fx.course("CS1701", 3, "?", ""), fx.course("CS1302", 3, "B", "")])
    profile, r = run(rec)
    assert "CS1701" not in profile.passed  # unreadable grade ≠ passed
    fields = {g["field"] for g in r["data_gaps"]}
    assert {"grade:CS1701", "terms", "current_courses"} <= fields
    assert r["confidence"]["level"] == "medium"


def test_7b_student_corrections_are_labelled():
    rec = fx.record([fx.course("CS1701", 3, "B", fx.T1)])
    profile, r = run(rec, corrections={"courses": [fx.course("CS1302", 3, "A", fx.T1)]})
    assert profile.passed["CS1302"].source == "student"
    assert any("يدوياً" in n for n in profile.notes)
    assert any("يدوياً" in why for why in r["confidence"]["reasons"])


def test_8_schedule_that_violates_prerequisites_is_rejected():
    profile = build_profile(fx.record([fx.course(c, h, "B", fx.T1) for c, h in fx.CS_L1]))
    s = PlanSettings()
    out = validate_schedule(["CS1704", "CS2105", "MTH1602"], profile, CAT, CS, s)
    assert not out["valid"]
    by = {c["code"]: c for c in out["courses"]}
    assert by["CS1704"]["ok"] and by["MTH1602"]["ok"]
    assert not by["CS2105"]["ok"] and "نفس الفصل" in " ".join(by["CS2105"]["problems"])
    assert out["violations"][0]["cite"]["status"] == "verified"
    assert any(w["rule"] == "min_regular_load" for w in out["warnings"])

    coop = validate_schedule(["CS3901", "MTH1602"], profile, CAT, CS, s)
    assert any(v["rule"] == "coop_exclusive" for v in coop["violations"])
    summer = validate_schedule(["CS1704", "MTH1602", "PHYS1113", "CS1303"], profile, CAT, CS, s, summer_term=True)
    assert any(v["rule"] == "max_summer_load" for v in summer["violations"])
    already = validate_schedule(["CS1701"], profile, CAT, CS, s)
    assert not already["courses"][0]["ok"]


def _rev(name, q, days_ago=30, wl=3, verified=True):
    import datetime as dt

    d = (fx.TODAY - dt.timedelta(days=days_ago)).isoformat()
    return instructors.InstructorReview(instructor=name, course_code="CS2105", created_at=d, source="t", verified=verified,
                                        ratings={"clarity": q, "organization": q, "fairness": q, "workload": wl})


def test_9_sparse_and_contradictory_instructor_reviews_give_no_recommendation():
    sparse = instructors.summarize([_rev("د. أحمد", 5), _rev("أحمد", 5), _rev("خالد", 2)], fx.TODAY)
    assert sparse["verdict"] == "insufficient" and sparse["recommendation"] is None
    assert {s["instructor"] for s in sparse["instructors"]} == {"أحمد", "خالد"}  # titles normalised

    split = [_rev("سارة", q) for q in (1, 5, 1, 5, 1, 5)] + [_rev("منى", 3) for _ in range(6)]
    out = instructors.summarize(split, fx.TODAY)
    sara = next(s for s in out["instructors"] if s["instructor"] == "سارة")
    assert sara["disagreement"] and sara["confidence"] == "low"
    assert out["recommendation"] is None

    clear = [_rev("هند", 5) for _ in range(8)] + [_rev("ريم", 2) for _ in range(8)]
    rec = instructors.summarize(clear, fx.TODAY)["recommendation"]
    assert rec and rec["instructor"] == "هند"
    # Shrinkage: 3 perfect reviews do not beat 20 good ones.
    few_vs_many = [_rev("أ", 5) for _ in range(3)] + [_rev("ب", 4) for _ in range(20)]
    summ = {s["instructor"]: s for s in instructors.summarize(few_vs_many, fx.TODAY)["instructors"]}
    assert summ["أ"]["confidence"] == "low" and summ["ب"]["confidence"] == "high"
    # Unverified and stale evidence.
    assert instructors.summarize([_rev("x", 5, verified=False)] * 9, fx.TODAY)["verdict"] == "no_data"
    old = instructors.summarize([_rev("ق", 5, days_ago=1500) for _ in range(20)], fx.TODAY)["instructors"][0]
    assert old["confidence"] != "high" and old["notes"]
    q = instructors.QaymProvider()
    assert not q.status().available and q.reviews("CS2105") == []


def test_10_impossible_graduation_date_is_explained():
    rec = fx.record([fx.course(c, h, "B", fx.T1) for c, h in fx.CS_L1])
    _, r = run(rec, target_term="1449-1", summer=True)
    t = r["scenarios"]["fastest"]["target"]
    assert t["verdict"] == "impossible" and "مستحيل" in t["message"] and t["earliest_label"]
    _, ok = run(fx.near_graduation(), target_term="1449-1")
    assert ok["scenarios"]["fastest"]["target"]["verdict"] == "feasible"


# ── explanation guard ────────────────────────────────────────────

def test_llm_answers_that_leave_the_facts_are_rejected():
    _, r = run(fx.failed_prerequisites())
    facts = explain.facts_for_llm(r)
    good = {"answer": "ابدأ بإعادة CS1701 لأنه يفتح مقررات كثيرة.", "points": [], "next_step": "راجع مرشدك."}
    assert explain.validate_answer(good, facts) == []
    assert explain.validate_answer({**good, "answer": "سجّل CS9999 أيضاً."}, facts)
    assert explain.validate_answer({**good, "answer": "معدلك سيصبح 3.97."}, facts)
    assert explain.validate_answer({**good, "answer": "النجاح مضمون."}, facts)


def test_deterministic_summary_answers_the_six_questions():
    _, r = run(fx.failed_prerequisites())
    s = explain.summarize_run(r)
    assert "CS1701" in s["what"] and s["why"] and s["alternatives"] and s["effect"] and s["uncertain"] and s["next_steps"]

