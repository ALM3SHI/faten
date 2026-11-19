"""Phase 6a: the mistakes notebook (with practice that closes mistakes) and a
timed final exam that behaves like a real one."""

import datetime as dt

from test_tutor_flow import UID, Session, api, upload  # noqa: F401  (the same fixture as the study journey)


def notebook(http, s):
    r = http.get(f"/api/tutor/lectures/{s.lid}/mistakes")
    assert r.status_code == 200, r.text
    return r.json()


def test_a_first_wrong_answer_goes_to_the_notebook_until_it_is_overcome(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    assert notebook(http, s) == {"mistakes": [], "open": 0}
    s.step("next")
    s.step("next")
    qid = s.state["pending"]["question"]["id"]
    s.answer(right=False)  # first try wrong…
    s.answer(right=True)  # …the retry is right, but a retry is not evidence
    nb = notebook(http, s)
    assert nb["open"] == 1 and s.state["mistakesOpen"] == 1
    m = nb["mistakes"][0]
    assert m["qid"] == qid and not m["fixed"] and m["kind"] == "check"
    assert m["answer"] == "خيار ج" and m["correctText"] == "خيار صحيح"  # what they said, and what is right
    assert m["misconception"] == "إغفال الشرط" and m["topicTitle"] and m["concepts"]

    # practising the mistake asks about the same concept; a right answer closes it
    body = s.step("practice_mistakes")
    assert s.state["phase"] == "review" and s.state["pending"]["context"] == "review"
    assert body["messages"][0]["blocks"][0]["text"] == "تدرّب على أخطائي"
    practice = s.answer_key(s.state["pending"]["question"]["id"])
    assert set(practice["concept_ids"]) & set(m["conceptIds"])
    s.answer(right=True)
    nb = notebook(http, s)
    assert nb["open"] == 0 and nb["mistakes"][0]["fixed"] is True
    s.step("next")
    assert s.state["phase"] == "topic" and s.state["mistakesOpen"] == 0  # back where they were

    # nothing open: nothing to practise
    r = s.step("practice_mistakes", expect=400)
    assert "ما عندك أخطاء مفتوحة" in r["detail"]


def test_a_timed_exam_runs_out_like_a_real_one(api, monkeypatch):
    http, db, fake, _ = api
    import routers.tutor as rt

    s = Session(http, db, upload(http).json())
    s.step("final", timed=True)
    f = s.state["final"]
    total = f["total"]
    assert f["timed"] is True and f["minutes"] >= 10 and f["deadline"]
    assert s.state["pending"]["question"]["has_hint"] is False
    # the time is not up: the exam cannot be closed early by asking
    r = s.step("finish_final", expect=400)
    assert "بقية" in r["detail"]
    s.answer(right=True)
    assert s.state["final"]["index"] == 1

    # the clock runs out — whatever is sent next, the exam is closed first
    after = dt.datetime.fromisoformat(f["deadline"]) + dt.timedelta(seconds=5)
    monkeypatch.setattr(rt, "_now", lambda: after)
    body = s.step("finish_final")
    assert s.state["phase"] == "done" and s.state["pending"] is None
    kinds = [b["type"] for m in body["messages"] for b in m["blocks"]]
    assert kinds[0] == "notice" and "final_report" in kinds
    report = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "final_report"][0]
    assert 0 < report["score"] < 0.5  # one right (weighted by difficulty), the rest missed
    # questions left unanswered are not evidence of misunderstanding a concept
    progress = db.store[("users", UID, "tutor_lectures", s.lid, "progress", "main")]
    finals = [e for t in progress["topics"].values() for e in t.get("evidence") or [] if e.get("kind") == "final"]
    assert len(finals) == 1
    assert progress["final"]["timedOut"] == total - 1


def test_the_untimed_exam_is_still_there(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("final")
    assert not s.state["final"].get("timed") and s.state["final"].get("deadline") is None
    assert s.step("finish_final", expect=400)
