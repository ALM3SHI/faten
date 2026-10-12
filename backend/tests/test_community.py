import pytest
from fastapi import HTTPException

from services import community as C


def review(d, w, u, rec, tip=""):
    return {"difficulty": d, "workload": w, "usefulness": u, "recommend": rec, "tip": tip, "semester": "الأول 1448"}


def test_aggregates_follow_add_edit_delete(fake_db, seed):
    seed.courses(fake_db, "u1", ["CS4510"])
    seed.courses(fake_db, "u2", ["CS 4510"])  # spacing in the record is normalised
    c = C.upsert_review("u1", "cs4510", review(4, 5, 5, True, "ابدأ المشروع بدري"))
    assert c["count"] == 1 and c["averages"]["difficulty"] == 4.0 and c["recommend_pct"] == 100
    c = C.upsert_review("u2", "CS4510", review(2, 3, 3, False))
    assert c["count"] == 2 and c["averages"]["difficulty"] == 3.0 and c["recommend_pct"] == 50
    c = C.upsert_review("u1", "CS4510", review(2, 5, 5, True))  # edit, not a second review
    assert c["count"] == 2 and c["averages"]["difficulty"] == 2.0
    c = C.delete_review("u2", "CS4510")
    assert c["count"] == 1 and c["averages"]["difficulty"] == 2.0


@pytest.mark.parametrize("uid,courses,payload,status", [
    ("u3", [], review(3, 3, 3, True), 403),                            # course not in record
    ("u1", ["CS4510"], review(6, 3, 3, True), 400),                    # out of range
    ("u1", ["CS4510"], review(3, 3, 3, True, "تابعني www.x.com"), 400),  # links
    ("u1", ["CS4510"], review(3, 3, 3, True, "كلمني 0551234567"), 400),  # phone numbers
])
def test_rejected_reviews(fake_db, seed, uid, courses, payload, status):
    seed.courses(fake_db, uid, courses)
    with pytest.raises(HTTPException) as e:
        C.upsert_review(uid, "CS4510", payload)
    assert e.value.status_code == status


def test_reviewer_identity_is_never_exposed(fake_db, seed):
    seed.courses(fake_db, "u1", ["CS4510"])
    C.upsert_review("u1", "CS4510", review(3, 3, 3, True, "نصيحة"))
    data = C.get_course("u9", "CS4510")
    assert all("uid" not in r for r in data["reviews"])
    assert "u1" not in str(data)


def test_three_distinct_reports_hide_a_review(fake_db, seed):
    for u in ("u1", "u2", "u3", "u4"):
        seed.courses(fake_db, u, ["CS4510"])
    C.upsert_review("u1", "CS4510", review(3, 3, 3, True, "نصيحة"))
    rid = C.review_id("u1", "CS4510")
    for reporter in ("u2", "u2", "u3"):  # duplicate report from u2 counts once
        C.report_review(reporter, "CS4510", rid)
    assert any(r["id"] == rid for r in C.get_course("u4", "CS4510")["reviews"])
    C.report_review("u4", "CS4510", rid)
    assert not any(r["id"] == rid for r in C.get_course("u4", "CS4510")["reviews"])
    assert C.get_course("u1", "CS4510")["my_review"] is not None  # author still sees it


def test_invalid_course_code_is_rejected():
    with pytest.raises(HTTPException):
        C.normalize_code("DROP;--")
