"""Old-plan courses count toward the current plan through equivalences."""

from __future__ import annotations

import datetime as dt

from services.advisor import equivalence as eq
from services.advisor.audit import audit
from services.advisor.catalog import load_catalog
from services.advisor.profile import build_profile
from services.advisor.recommend import AdvisorPreferences, analyze


def _rec(*rows, major="علوم الحاسب الآلي"):
    return {"major": major, "gpa": 3.2, "earnedHours": sum(r[2] for r in rows),
            "completedCourses": [{"code": c, "nameAr": n, "creditHours": h, "grade": "A", "semester": "الفصل الأول 1442/1443"}
                                 for c, n, h in rows]}


OLD = [("CS1101", "هياكل متقطعة ١", 4), ("CS2214", "هياكل البيانات", 3), ("CS3143", "نظم التشغيل", 3),
       ("CS3370", "تدريب تعاوني", 8), ("CS4509", "مواضيع مختارة ١", 3), ("CS1211", "برمجة الحاسب الآلي ١", 3)]


def test_spelling_variants_are_the_same_course():
    assert eq.same_name("تفاضل وتكامل ١", "التفاضل والتكامل 1")
    assert eq.same_name("شبكات الحاسب الآلي", "شبكات الحاسب")
    assert eq.same_name("مقدمة في قواعد البيانات", "قواعد البيانات")
    assert not eq.same_name("أساسيات نظم التشغيل", "نظم التشغيل")
    assert not eq.same_name("هياكل متقطعة 1", "هياكل متقطعة 2")


def test_old_plan_courses_count_without_touching_the_record():
    cat = load_catalog()
    cur = cat.curriculum_for("uqu-478")
    p = build_profile(_rec(*OLD))
    mp, rep = eq.apply(p, cat, cur)
    done = {r.code for r in audit(mp, cat, cur).courses if r.state == "done"}
    assert {"CS1302", "CS2105", "CS3608", "CS3901"} <= done
    assert {m["to"] for m in rep["applied"]} >= {"CS1302", "CS2105", "CS3608", "CS3901"}
    assert all(m["confidence"] in ("confirmed", "likely") for m in rep["applied"])
    # suggested rules (CS1211 → CS1701) are listed for review, never applied
    assert "CS1701" not in done and any("CS1701" in s["to"] for s in rep["suggestions"])
    assert "CS4509" in {c["code"] for c in rep["no_equivalent"]}
    # GPA and earned hours are the record's, untouched
    assert (mp.earned_hours, mp.computed_gpa, mp.attempts) == (p.earned_hours, p.computed_gpa, p.attempts)


def test_transferred_cohort_is_planned_on_the_current_plan():
    cat = load_catalog()
    p = build_profile(_rec(*OLD))
    r = analyze(p, cat, cat.curriculum_for("uqu-478"), AdvisorPreferences(), today=dt.date(2026, 10, 15))
    assert r["curriculum_fit"]["verdict"] == "transferred"
    assert r["plan_applicable"] and r["next_term"]["courses"]
    assert r["confidence"]["level"] != "high"
    assert r["record_status"]["training"] == "passed"  # judged on the record as printed
    assert r["equivalences"]["counts"]["total"] >= 4


def test_without_a_file_only_identical_names_are_matched():
    cat = load_catalog()
    cur = cat.curriculum_for("uqu-1490")  # no equivalence file
    assert eq.load_rules("uqu", "uqu-1490") is None
    _, rep = eq.apply(build_profile(_rec(*OLD)), cat, cur)
    assert all(m["source"] == "same_name" for m in rep["applied"])
    assert "CS3608" in {m["to"] for m in rep["applied"]}  # «نظم التشغيل» = «نظم التشغيل»
