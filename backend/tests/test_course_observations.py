"""Every saved transcript is checked against the course catalog."""

from __future__ import annotations

from services import course_observations as co
from services.advisor.catalog import load_catalog


def _known():
    cat = load_catalog()
    code, c = next((k, v) for k, v in cat.courses.items() if v.credits and v.name_ar)
    return cat, code, c


def _record(*courses, major="علوم الحاسب الآلي"):
    return {"major": major, "completedCourses": list(courses), "currentCourses": []}


def test_new_matching_and_conflicting_courses(fake_db):
    cat, code, c = _known()
    rec = _record(
        {"code": code, "nameAr": c.name_ar, "creditHours": c.credits, "grade": "A"},
        {"code": "ZZ1234", "nameAr": "مقرر قديم", "nameEn": "Old Course", "creditHours": 3, "grade": "B"},
        {"code": "bad code", "nameAr": "x"},
    )
    s = co.observe_record(fake_db, "stu-a", rec, cat)
    assert (s["checked"], s["match"], s["missing"], s["conflict"]) == (2, 1, 1, 0)
    assert s["new_codes"] == ["ZZ1234"]
    new = fake_db.store[("course_observations", "ZZ1234")]
    assert new["catalog_status"] == "missing" and new["credits"] == 3 and new["name_ar"] == "مقرر قديم"
    # no grades, names or uids stored
    sight = next(v for k, v in fake_db.store.items() if k[:3] == ("course_observations", "ZZ1234", "sightings"))
    assert "grade" not in sight and "stu-a" not in str(fake_db.store)

    wrong = _record({"code": code, "nameAr": c.name_ar, "creditHours": c.credits + 1})
    s2 = co.observe_record(fake_db, "stu-b", wrong, cat)
    assert s2["conflict"] == 1 and s2["conflicts"][0]["issues"][0]["field"] == "credits"


def test_reuploads_count_once_and_unchanged_records_are_skipped(fake_db):
    cat, _, _ = _known()
    rec = _record({"code": "ZZ1234", "nameAr": "مقرر قديم", "creditHours": 3})
    co.observe_record(fake_db, "stu-a", rec, cat)
    again = co.observe_record(fake_db, "stu-a", rec, cat)
    assert again.get("unchanged") and again["missing"] == 1
    co.observe_record(fake_db, "stu-b", _record({"code": "ZZ1234", "nameAr": "مقرر قديم", "creditHours": 4}), cat)
    rep = co.report(fake_db)
    row = next(r for r in rep["courses"] if r["code"] == "ZZ1234")
    assert row["students"] == 2 and row["credits"] == {3: 1, 4: 1}


def test_name_spelling_differences_are_not_conflicts():
    assert co._names_agree("برمجة الحاسب ١", "برمجه الحاسب 1")
    assert co._names_agree("مقدمة في قواعد البيانات", "قواعد البيانات")
    assert not co._names_agree("تفاضل وتكامل", "برمجة الحاسب")


def test_a_broken_store_never_blocks_saving():
    class Boom:
        def collection(self, _):
            raise RuntimeError("down")
    s = co.observe_record(Boom(), "stu-a", _record({"code": "ZZ1234", "creditHours": 3}))
    assert s.get("error") and s["checked"] == 0


def test_saving_a_transcript_checks_its_courses(fake_db, monkeypatch):
    from fastapi.testclient import TestClient

    import main
    from auth.dependencies import get_current_user
    from routers import workspace as ws

    monkeypatch.setattr(ws, "get_db", lambda: fake_db)
    main.app.dependency_overrides[get_current_user] = lambda: "stu-a"
    try:
        r = TestClient(main.app).patch("/api/workspace/transcript", json={
            "major": "علوم الحاسب الآلي",
            "completedCourses": [{"code": "ZZ1234", "nameAr": "مقرر قديم", "creditHours": 3, "grade": "A"}],
        })
    finally:
        main.app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    assert r.json()["course_check"] == {"checked": 1, "match": 0, "missing": 1, "conflict": 0}
    assert ("course_observations", "ZZ1234") in fake_db.store
