"""Instructor profiles from the team's compiled reviews: aggregates + analysis only."""

import importlib.util
from pathlib import Path

from services.advisor import instructor_profiles as ip
from services.advisor.catalog import load_catalog

DATA = ip.load_profiles("uqu")
CAT = load_catalog("uqu")
_spec = importlib.util.spec_from_file_location("build_ip", Path(__file__).resolve().parents[1] / "scripts" / "build_instructor_profiles.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)


def _walk(node, path=()):
    if isinstance(node, dict):
        for k, v in node.items():
            yield path + (k,), k, v
            yield from _walk(v, path + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, path + (i,))


def test_no_comments_or_raw_reviews_are_shipped():
    keys = {k for _, k, _ in _walk(DATA)}
    assert not keys & {"comment", "comments", "replies", "votes", "ratings", "grade", "date"}
    longest = max(len(v) for _, _, v in _walk(DATA) if isinstance(v, str))
    assert longest < 300  # analysis sentences only, nothing pasted


def test_every_instructor_has_a_complete_analysis():
    assert len(DATA["instructors"]) == 10
    for p in DATA["instructors"]:
        a = p["analysis"]
        assert a["verdict"] in DATA["verdict_labels"]
        assert a["headline"] and a["recommendation"] and a["strengths"] and a["weaknesses"] and a["survival"]
        assert len(a["recommendation"]) < 200  # one line in the UI
        assert p["stats"]["reviews"] == p["data"]["reviews_analyzed"]


def test_all_files_complete_and_truncated_files_keep_whole_reviews_only(tmp_path):
    assert all(p["data"]["complete"] and p["data"]["reviews_analyzed"] == p["data"]["reviews_stated"] for p in DATA["instructors"])
    text = (
        '{"professor_profile": {"name": "د. س", "total_reviews": 3}, "reviews": ['
        '{"course": "شبكات", "ratings": {"explanation": 100}}, {"course": "شبكات", "ratings": {"explanation": 60}},'
        ' {"course": "شبكات", "comment": "مقطو'
    )
    f = tmp_path / "x.json"
    f.write_text(text, encoding="utf-8")
    data, complete = build.load(f)
    assert not complete and len(data["reviews"]) == 2


def test_course_links_point_to_real_plan_courses():
    for p in DATA["instructors"]:
        for c in p["courses"]:
            for link in c["links"]:
                assert link["code"] in CAT.courses and link["programs"]
                for pid in link["programs"]:
                    assert CAT.curriculum_for(pid).course(link["code"])


def test_wording_to_course_family():
    cases = {
        "تشفير تطبيقي": ["SEC1202"],
        "هياكل بيانات جافا نظري": ["CS2105"],
        "برمجة 2 عملي": ["CS1704", "CS1012", "CS1013", "SE1101"],
        "تنظيم وعمارة الحاسب COA": ["CEN2012"],
        "هياكل المتقطعه": ["CS1302", "DS1901", "SEC1201"],
        "اساسيات الشبكات و تطبيقاتها": ["CEN1501"],
        "هياكل حسابية ٢": ["SE3402"],
        "برمجة بلغة جافا عملي": ["CS1701"],
    }
    for label, codes in cases.items():
        assert build.family_of(label)["codes"] == codes, label
    for label in ("تدريب صيفي", "واجهة العتاد والبرمجيات", "تحسين برمجة المقيدة"):
        assert build.family_of(label)["codes"] == [], label  # no current plan course → never forced onto one
    assert build.family_of("موضوعات في الحوسبة") is None and build.family_of(None) is None
    assert build.mode_of("تنظيم وعمارة الحاسب نظري+عملي") == "both" and build.mode_of("تدريب صيفي") == "summer_training"


def test_for_course_orders_by_evidence_and_flags_thin_data():
    out = ip.for_course("SEC1202")
    assert out["profiles"][0]["name"] == "حاتم سعد براك السواط"
    top = out["profiles"][0]
    assert top["verdict"] == "recommended" and top["course"]["reviews"] >= 30 and not top["course"]["thin"]
    ds = ip.for_course("CS2105")["profiles"]
    assert len(ds) >= 2 and ds == sorted(ds, key=lambda c: (-c["course"]["reviews"], c["name"]))
    assert ip.for_course("XX9999")["profiles"] == []


def test_program_map_only_lists_courses_of_that_plan():
    cyber = ip.for_program(CAT, "uqu-1738")
    codes = {c["code"] for c in cyber["courses"]}
    assert {"SEC1202", "SEC2203", "CEN1011"} <= codes
    plan = {c.code for c in CAT.curriculum_for("uqu-1738").courses}
    assert codes <= plan
    assert ip.for_program(CAT, "uqu-0") is None


def test_language_specific_courses_are_marked_ambiguous():
    # «برمجة 1» is Java in CS and Python in AI: linking it to both is flagged, not asserted.
    assert build.family_of("برمجة ١")["confidence"] == "ambiguous"
    assert build.family_of("برمجة بلغة جافا عملي")["confidence"] == "likely"
    cards = ip.for_course("CS1701")["profiles"]
    assert cards and any(c["course"]["confidence"] == "ambiguous" for c in cards)


def test_an_instructor_appears_once_per_plan_course():
    """Several wordings of one course («برمجة 1», «بايثون») link the same code;
    they are merged, never listed twice."""
    from services.advisor import instructor_profiles as ip
    from services.advisor.catalog import load_catalog
    for pid in ("uqu-478", "uqu-1490"):
        m = ip.for_program(load_catalog(), pid)
        for c in m["courses"]:
            ids = [i["id"] for i in c["instructors"]]
            assert len(ids) == len(set(ids)), (pid, c["code"])
            assert all(i["short_name"] for i in c["instructors"])
    cards = ip.for_course("CS1011")["profiles"]
    assert len({c["id"] for c in cards}) == len(cards)
