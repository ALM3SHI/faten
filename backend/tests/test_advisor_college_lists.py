"""The team's compiled college lists: adopted with provenance, never silently."""

import json
import shutil

from services.advisor.catalog import CATALOG_ROOT, load_catalog
from services.advisor.ingest_uqu import build_catalog

CAT = load_catalog("uqu")
LISTS = CATALOG_ROOT / "uqu" / "college-of-computing"


def test_every_listed_file_is_recorded_with_its_hash():
    cs = CAT.curriculum_for("uqu-478")
    assert cs.college_list and cs.college_list["file"] == "cs.json"
    assert cs.college_list["original_name"] == "computer_science_curriculum.json"
    for pid in ("uqu-478", "uqu-1490", "uqu-1510", "uqu-1492", "uqu-1981", "uqu-1738", "uqu-1508"):
        assert CAT.curriculum_for(pid).college_list is not None


def test_differences_keep_the_plan_page_value_and_are_reported():
    cs = CAT.curriculum_for("uqu-478")
    ai4101 = cs.course("AI4101")
    assert ai4101.prerequisites == ["AI2001"] and ai4101.plan_page_prerequisites == ["CS2107"]
    assert any(i.code == "prereq_from_college_list" and i.subject == "AI4101" for i in cs.issues)
    assert any(i.code == "college_list_applied" and i.severity == "warning" for i in cs.issues)
    same = cs.course("CS1704")
    assert same.prereq_source == "plan_page" and same.plan_page_prerequisites is None
    # Levels and hours are never taken from the list.
    assert cs.listed_hours == 126 and cs.course("CS3608").credits == 4


def test_code_alias():
    ce = CAT.curriculum_for("uqu-1492")
    # The list writes PHY1114; the plan and student records use PHYS1114.
    assert ce.course("EE1101").prereq_source == "plan_page"
    assert not any(i.subject == "PHY1114" for i in ce.issues)


def _rebuild_with(tmp_path, edit):
    root = tmp_path / "uqu"
    shutil.copytree(CATALOG_ROOT / "uqu" / "raw", root / "raw")
    shutil.copytree(LISTS, root / "college-of-computing")
    edit(root / "college-of-computing")
    return build_catalog(root / "raw")


def test_an_edited_list_is_not_applied_until_re_recorded(tmp_path):
    def edit(folder):
        data = json.loads((folder / "cs.json").read_text(encoding="utf-8"))
        data["major"]["levels"][0]["courses"][0]["prerequisites"] = ["CS1701"]
        (folder / "cs.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    cat = _rebuild_with(tmp_path, edit)
    cs = cat.curriculum_for("uqu-478")
    assert cs.college_list is None and cs.course("AI4101").prerequisites == ["CS2107"]
    assert any(i.code == "college_list_hash_mismatch" for i in cat.issues)


def test_unknown_course_and_level_difference_are_reported_not_applied(tmp_path):
    def edit(folder):
        path = folder / "cs.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["major"]["levels"][0]["courses"].append({"code": "CS9999", "credits": 3, "prerequisites": []})
        data["major"]["levels"][0]["courses"][0]["credits"] = 9  # QR1101
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        import hashlib
        m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        next(f for f in m["files"] if f["file"] == "cs.json")["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        (folder / "manifest.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")

    cs = _rebuild_with(tmp_path, edit).curriculum_for("uqu-478")
    assert cs.course("CS9999") is None and cs.course("QR1101").credits == 2
    codes = {(i.code, i.subject) for i in cs.issues}
    assert ("college_list_course_not_in_plan", "CS9999") in codes
    assert ("college_list_level_or_hours_differ", "QR1101") in codes


def test_new_programs_come_from_official_pages():
    for pid, hours in (("uqu-1981", 125), ("uqu-1508", 126), ("uqu-1738", 134)):
        cur = CAT.curriculum_for(pid)
        assert cur.provenance.source_url == f"https://uqu.edu.sa/App/Degrees/{pid[4:]}"
        assert cur.stated_total_hours == hours and cur.unlisted_hours > 0
    hci = CAT.curriculum_for("uqu-1981")
    assert hci.course("HCI4503").kind == "coop" and hci.course("HCI4503").credits == 6


def test_record_major_names_resolve_to_the_new_programs():
    from services.advisor.service import resolve_program

    for major, pid in (("تفاعل الإنسان مع الحاسب", "uqu-1981"), ("Human-Computer Interaction", "uqu-1981"),
                       ("علم البيانات", "uqu-1508"), ("Data Science", "uqu-1508"),
                       ("علوم الحاسب الآلي", "uqu-478"), ("الذكاء الاصطناعي", "uqu-1490"),
                       ("الأمن السيبراني", "uqu-1738"), ("Cybersecurity", "uqu-1738")):
        assert resolve_program({}, {"major": major}, CAT) == (pid, "record"), major


def test_rejected_files_are_reported(tmp_path):
    def edit(folder):
        m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        m["rejected"] = [{"original_name": "x.json", "program_id": "uqu-1508", "reason": "مقطوع"}]
        (folder / "manifest.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")

    cat = _rebuild_with(tmp_path, edit)
    assert any(i.code == "college_list_rejected" and i.subject == "uqu-1508" for i in cat.issues)
