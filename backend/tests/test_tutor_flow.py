"""
Dynamic study mode end to end through the HTTP API, with real PDFs and a
scripted model: upload → map → topic lesson → checks → adaptive quiz →
remediation → mastery → spaced review → final exam → restore.
"""

import datetime as dt

import pytest
from fastapi.testclient import TestClient

import main
from auth.dependencies import get_current_user
from pdf_factory import make_pdf
from tests_helpers import fake_ai

UID = "stu-tutor"

LECTURE = make_pdf([
    ["Stacks", "A stack is a LIFO structure. Push adds on top, pop removes from the top."],
    {"lines": ["stack = []", "stack.append(1)", "    # indented comment", "stack.pop()"], "mono": True},
    ["Queues", "A queue is FIFO: enqueue at the rear and dequeue from the front of the line."],
    {"image": True},
])


@pytest.fixture
def api(fake_db, monkeypatch):
    who = {"uid": UID}
    main.app.dependency_overrides[get_current_user] = lambda: who["uid"]
    fake = fake_ai(monkeypatch)
    try:
        yield TestClient(main.app), fake_db, fake, who
    finally:
        main.app.dependency_overrides.clear()


def upload(http, pdf=LECTURE, name="ds.pdf"):
    return http.post("/api/tutor/lectures", files={"file": (name, pdf, "application/pdf")})


def credits(db, uid=UID):
    return (db.store.get(("ai_usage", uid)) or {}).get("used", 0)


class Session:
    def __init__(self, http, db, data):
        self.http, self.db = http, db
        self.lid = data["lecture"]["id"]
        self.hash = data["lecture"]["fileHash"]
        self.state = data["state"]
        self.messages = list(data["messages"])

    def step(self, action, expect=200, **payload):
        r = self.http.post(f"/api/tutor/lectures/{self.lid}/step", json={"action": action, "payload": payload, "version": self.state["version"]})
        assert r.status_code == expect, r.text
        if r.status_code == 200:
            body = r.json()
            self.state = body["state"]
            self.messages += body["messages"]
            return body
        return r.json()

    def blocks(self, kind):
        return [b for m in self.messages for b in m["blocks"] if b["type"] == kind]

    def answer_key(self, qid):
        tid = qid.split("-")[0]
        for q in (self.db.store.get(("tutor_cache", self.hash, "lessons", tid)) or {}).get("questions", []):
            if q["id"] == qid:
                return q
        for q in (self.db.store.get(("users", UID, "tutor_lectures", self.lid, "extras", tid)) or {}).get("questions", []):
            if q["id"] == qid:
                return q
        raise KeyError(qid)

    def finish_warmup(self, right=True):
        """Answer the retrieval questions that open a topic, until its goal shows."""
        n = 0
        while self.state["stage"] == "warmup":
            if self.state["pending"]:
                self.answer(right=right)
                n += 1
            else:
                self.step("next")
        return n

    def answer(self, right=True, expect=200, confidence=None):
        q = self.state["pending"]["question"]
        key = self.answer_key(q["id"])
        extra = {"confidence": confidence} if confidence else {}
        if key["format"] == "choice":
            choice = key["answer_index"] if right else (key["answer_index"] + 1) % len(key["options"])
            return self.step("answer", expect, questionId=q["id"], choice=choice, **extra)
        return self.step("answer", expect, questionId=q["id"], text="هذا جواب صحيح" if right else "لا أعرف", **extra)


def test_upload_reads_pages_builds_the_map_and_charges_once(api):
    http, db, fake, _ = api
    r = upload(http)
    assert r.status_code == 200, r.text
    data = r.json()
    lec = data["lecture"]
    assert lec["pageCount"] == 4 and [t["pages"] for t in lec["topics"]] == [[1, 2], [3, 4]]
    assert lec["extraction"]["visionPages"] == [4]  # only the picture page went to vision
    assert fake.calls["vision"] == 1 and fake.calls["structure"] == 1
    assert fake.vision_pdf_sizes[0] < len(LECTURE)
    assert credits(db) == 5
    kinds = [b["type"] for m in data["messages"] for b in m["blocks"]]
    assert kinds[:2] == ["text", "map"] and "notice" in kinds  # tells the student page 4 was read from an image
    assert data["state"]["phase"] == "overview" and data["state"]["version"] == 1
    # Code from the slide is stored with its indentation.
    content = db.store[("tutor_cache", lec["fileHash"], "content", "0")]["pages"]
    assert "    # indented comment" in content[1]["text"]

    # Same file again: no reprocessing, no charge, same session.
    again = upload(http).json()
    assert again["reused"] == "mine" and fake.calls["structure"] == 1 and credits(db) == 5
    assert again["state"]["version"] == 1


def test_unreadable_pages_are_reported_not_invented(api, monkeypatch):
    http, db, fake, _ = api
    fake.vision_readable = False
    pdf = make_pdf([["Hashing", "A hash function maps keys to buckets of the table quickly."], {"image": True}])
    data = upload(http, pdf).json()
    assert data["lecture"]["extraction"]["unreadablePages"] == [2]
    notice = [b for m in data["messages"] for b in m["blocks"] if b["type"] == "notice"][0]
    assert "لم أتمكن من قراءة 1 صفحة" in notice["md"] and notice["tone"] == "warn"


def test_bad_files_cost_nothing(api):
    http, db, fake, _ = api
    assert upload(http, b"hello").status_code == 400
    r = upload(http, b"%PDF-1.4 broken")
    assert r.status_code == 400 and "تالف" in r.json()["detail"]
    fake.vision_readable = False
    r = upload(http, make_pdf([{"image": True}]))
    assert r.status_code == 400 and "محتوى دراسي" in r.json()["detail"]


def test_full_study_journey(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())

    # ── topic 1: goal → segment 1 with its check question
    s.step("next")
    assert s.state["phase"] == "topic" and s.state["stage"] == "goal"
    goal = s.blocks("goal")[-1]
    assert goal["index"] == 1 and goal["objectives"]
    s.step("next")
    assert fake.calls["lesson"] == 1 and credits(db) == 7
    lesson = s.blocks("lesson")[-1]
    assert "[ص 1]" in lesson["md"]
    assert s.state["stage"] == "check" and s.state["pending"]["context"] == "check"
    assert "answer_index" not in s.state["pending"]["question"]

    # wrong first try → why it's wrong + retry, no answer revealed
    body = s.answer(right=False)
    fb = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "feedback"][0]
    assert fb["retry"] and fb["misconception"] and "correctIndex" not in fb
    assert s.state["pending"] is not None
    hint = s.step("hint")
    assert any(b["type"] == "hint" for m in hint["messages"] for b in m["blocks"])
    s.answer(right=True)
    assert s.state["pending"] is None
    # only the first attempt counts as evidence
    t1 = db.store[("users", UID, "tutor_lectures", s.lid, "progress", "main")]["topics"]["t1"]
    assert len(t1["evidence"]) == 1 and t1["evidence"][0]["correct"] is False

    # re-explain the part differently (charged once, then reused for free)
    before = credits(db)
    s.step("reexplain")
    assert fake.calls["teach_again"] == 1 and credits(db) == before + 1
    # the second segment has invalid page 999 stripped
    s.step("next")
    seg2 = s.blocks("lesson")[-1]
    assert seg2["segment"] == 1 and "[ص 999]" not in seg2["md"] and 999 not in seg2["pages"]
    s.answer(right=True)

    # ── adaptive mastery quiz: all right → mastered after the evidence is clear
    s.step("next")
    assert s.state["stage"] == "quiz"
    asked = 0
    while s.state["stage"] == "quiz":
        s.answer(right=True)
        asked += 1
        s.step("next")
    assert 3 <= asked <= 6
    summary = s.blocks("topic_summary")[-1]
    assert summary["mastered"] and summary["reviewDue"]
    assert s.state["topics"]["t1"]["status"] == "mastered"

    # ── topic 2: goes wrong in the quiz → diagnosis + remediation → second chance
    s.step("next")
    assert s.state["currentTopicId"] == "t2"
    # a new topic opens with retrieval from the earlier one (no model call)
    lessons_before = fake.calls["lesson"]
    assert s.state["stage"] == "warmup" and s.state["pending"]["context"] == "warmup"
    assert s.state["pending"]["question"]["topic_id"] == "t1"
    assert s.finish_warmup() >= 1 and fake.calls["lesson"] == lessons_before
    assert s.state["stage"] == "goal"
    s.step("test_out")  # "I know this, test me"
    assert s.state["stage"] == "quiz"
    s.answer(right=False)
    s.step("next")
    s.answer(right=False)
    s.step("next")
    s.answer(right=False)
    assert s.state["pending"] is None
    s.step("next")  # decision = fail → remediate
    diag = s.blocks("diagnosis")[-1]
    assert diag["strategy"] and diag["weak"]
    assert s.state["stage"] == "remediate" and s.state["pending"]["context"] == "quiz"
    remedial = s.blocks("lesson")[-1]
    assert remedial.get("remedial")
    # second chance: answer right until the decision is made
    while s.state["stage"] == "remediate":
        if s.state["pending"]:
            s.answer(right=True)
        s.step("next")
    assert s.state["stage"] in ("closed", "remediate", "quiz") or s.state["phase"] != "topic"
    # whatever the decision, mastery is never granted on the remediation answers alone
    t2 = s.state["topics"]["t2"]
    assert t2["attempts"] >= 5

    # ── finish remaining topics, then the final exam
    guard = 0
    while s.state["phase"] == "topic" and guard < 40:
        guard += 1
        if s.state["pending"]:
            s.answer(right=True)
        s.step("next")
    assert s.state["phase"] == "final_ready"
    s.step("final")
    assert s.state["phase"] == "final" and s.state["final"]["total"] >= 6
    assert s.state["pending"]["question"]["has_hint"] is False
    s.step("hint", expect=400)
    total = s.state["final"]["total"]
    for i in range(total):
        s.answer(right=(i % 3 != 0))
    report = s.blocks("final_report")[-1]
    assert s.state["phase"] == "done" and 0 < report["score"] < 1
    assert {r["topicId"] for r in report["topics"]} == {"t1", "t2"}
    assert report["plan"] and all(p["action"] for p in report["plan"])
    weak_rows = [r for r in report["topics"] if r["score"] < 1]
    assert any(r["why"] for r in weak_rows)  # explains, not just a percentage

    # ── restore: a fresh GET returns the same state and history
    g = http.get(f"/api/tutor/lectures/{s.lid}").json()
    assert g["state"]["phase"] == "done" and g["state"]["version"] == s.state["version"]
    assert len(g["messages"]) == len(s.messages)
    assert g["focus"]["mode"] == "idle" and g["focus"]["serverNow"]

    # ── list shows progress
    lst = http.get("/api/tutor/lectures").json()["lectures"][0]
    assert lst["finalScore"] == report["score"] and lst["topics"] == 2

    # ── aggregate stats: anonymous counters only
    stats = db.store[("tutor_stats", s.hash[:24])]
    assert stats["students"] == 1 and stats["topics"] and "uid" not in str(stats) and UID not in str(stats)


def test_free_question_and_review_and_concurrency(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")
    # question while a check is open: answered, then the open question is shown again
    body = s.step("ask", text="ما الفرق بين المكدس والطابور؟")
    kinds = [b["type"] for m in body["messages"] for b in m["blocks"]]
    assert kinds[:2] == ["text", "answer_text"] and kinds[-1] == "question"
    assert s.state["pending"] is not None

    # stale version (another tab) → 409 without doing anything
    r = http.post(f"/api/tutor/lectures/{s.lid}/step", json={"action": "next", "payload": {}, "version": s.state["version"] - 1})
    assert r.status_code == 409 and "جهاز آخر" in r.json()["detail"]

    # answering a question that isn't open → refused
    s.step("answer", expect=409, questionId="t1-nope", choice=0)

    # can't skip an unanswered check with next
    s.step("next", expect=400)


def test_spaced_review_after_mastery(api, monkeypatch):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    while s.state["stage"] == "quiz":
        s.answer(right=True)
        s.step("next")
    assert s.state["topics"]["t1"]["status"] == "mastered"
    # two days later the review is due
    import routers.tutor as rt

    later = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)
    monkeypatch.setattr(rt, "_now", lambda: later)
    g = http.get(f"/api/tutor/lectures/{s.lid}").json()
    s.state = g["state"]
    assert g["state"]["reviewDue"] == ["t1"] and g["state"]["topics"]["t1"]["status"] == "review_due"
    s.step("review")
    assert s.state["phase"] == "review" and s.state["pending"]["context"] == "review"
    s.answer(right=True)
    s.step("next")
    assert s.state["phase"] == "topic" and s.state["reviewDue"] == []
    assert s.state["topics"]["t1"]["status"] == "mastered"


def test_same_file_from_another_student_reuses_the_analysis(api):
    http, db, fake, who = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")  # lesson for t1 generated once
    who["uid"] = "stu-other"
    other = upload(http, name="copy.pdf").json()
    assert other["reused"] == "shared" and fake.calls["structure"] == 1
    assert credits(db, "stu-other") == 0
    o = Session(http, db, other)
    o.step("next")
    o.step("next")
    assert fake.calls["lesson"] == 1  # lesson came from the shared cache
    # progress is separate
    assert db.store[("users", "stu-other", "tutor_lectures", o.lid, "progress", "main")]["topics"]["t1"].get("evidence") is None


def test_reset_delete_and_chat_independence(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    r = http.post(f"/api/tutor/lectures/{s.lid}/reset").json()
    assert r["state"]["phase"] == "overview" and r["state"]["version"] == 1
    # the tutor never writes to the normal chat's storage
    assert not any(p[:3] == ("users", UID, "chats") or "chat_history" in p for p in db.store)
    assert http.delete(f"/api/tutor/lectures/{s.lid}").status_code == 200
    assert http.get(f"/api/tutor/lectures/{s.lid}").status_code == 404
    assert http.get("/api/tutor/lectures/../../x").status_code == 404


def test_focus_timer_is_saved_with_absolute_times(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    body = {"mode": "focus", "startedAt": "2026-10-14T09:00:00+00:00", "durationSec": 1500, "pausedAt": None, "pausedTotalSec": 0, "focusMin": 25, "breakMin": 5, "completedFocus": 0}
    r = http.put(f"/api/tutor/lectures/{s.lid}/focus", json=body)
    assert r.status_code == 200 and r.json()["focus"]["serverNow"]
    assert http.get(f"/api/tutor/lectures/{s.lid}").json()["focus"]["startedAt"] == body["startedAt"]
    assert http.put(f"/api/tutor/lectures/{s.lid}/focus", json={**body, "startedAt": "nope"}).status_code == 422


def test_quota_exhausted_stops_before_the_model(api, settings):
    http, db, fake, _ = api
    settings.DAILY_AI_CREDITS = 6
    s = Session(http, db, upload(http).json())  # 5 credits
    s.step("next")
    r = http.post(f"/api/tutor/lectures/{s.lid}/step", json={"action": "next", "payload": {}, "version": s.state["version"]})
    assert r.status_code == 429 and fake.calls["lesson"] == 0
    # nothing was saved: same version, can retry later
    assert http.get(f"/api/tutor/lectures/{s.lid}").json()["state"]["version"] == s.state["version"]


def test_two_failed_remediation_rounds_move_on_as_needs_review(api):
    """The student is never trapped: after two re-teaching rounds the topic closes
    as «needs review» and comes back in the review plan and the final exam."""
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    rounds = 0
    for _ in range(40):
        if s.state["stage"] == "closed":
            break
        if s.state["pending"]:
            s.answer(right=False)
        else:
            s.step("next")
        rounds = len(s.blocks("diagnosis"))
    assert rounds == 2 and fake.calls["teach_again"] == 2
    summary = s.blocks("topic_summary")[-1]
    assert not summary["mastered"] and summary["missing"] and "لن أوقفك" in summary["note"]
    assert s.state["topics"]["t1"]["status"] == "needs_review"
    # the second diagnosis changes strategy once the same mistake repeats
    strategies = [d["strategy"] for d in s.blocks("diagnosis")]
    assert strategies[1] != strategies[0] or "خلط" in strategies[1]
    s.step("next")
    assert s.state["currentTopicId"] == "t2"


def test_vision_failure_is_reported_and_text_pages_still_work(api, monkeypatch):
    http, db, fake, _ = api
    real = fake.__call__

    async def flaky(prompt, user, **kw):
        if "little or no text layer" in prompt:
            from fastapi import HTTPException

            raise HTTPException(status_code=502, detail="Gemini INVALID_ARGUMENT")
        return await real(prompt, user, **kw)

    monkeypatch.setattr("services.tutor.ai.ask_json", flaky)
    data = upload(http).json()
    ex = data["lecture"]["extraction"]
    assert ex["visionPages"] == [] and ex["unreadablePages"] == [4]
    assert [t["pages"] for t in data["lecture"]["topics"]][0] == [1, 2]


def test_lecture_limit_and_admin_insights(api, settings, monkeypatch):
    http, db, fake, who = api
    from services.tutor import analytics, store

    monkeypatch.setattr(store, "MAX_LECTURES", 1)
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")
    s.answer(right=True)  # first answer → anonymous counters exist
    r = upload(http, make_pdf([["Graphs", "A graph has vertices and edges connecting pairs of them."]]))
    assert r.status_code == 400 and "احذف محاضرة" in r.json()["detail"]

    # admin view hides small samples and never exposes students
    out = analytics.insights(db)
    assert out["lectures"][0]["enough_data"] is False and "العينة صغيرة" in out["lectures"][0]["note"]
    h = next(iter(k for k in db.store if k[0] == "tutor_stats"))
    db.store[h]["students"] = 12
    db.store[h]["questions"] = {"q1": {"answers": 40, "correct": 39, "skill": "recall", "difficulty": 1, "topic": "x", "prompt": "سؤال سهل"}}
    db.store[h]["concepts"] = {"المكدس": {"answers": 25, "correct": 5}}
    out = analytics.insights(db)
    lec = out["lectures"][0]
    assert lec["enough_data"] and lec["question_flags"][0]["flag"] == "سهل أكثر من اللازم"
    assert "صياغة" in lec["question_flags"][0]["advice"]
    assert lec["most_missed_concepts"][0]["accuracy"] == 0.2
    assert UID not in str(out)


def test_admin_endpoint_requires_admin(api):
    http, *_ = api
    assert http.get("/api/admin/tutor-insights").status_code == 401


def test_confidence_shapes_feedback_and_mastery(api):
    """A confident mistake is flagged; a lucky guess earns half credit and is probed again."""
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    body = s.answer(right=False, confidence="sure")
    fb = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "feedback"][0]
    assert fb["confidentError"] and fb["confidence"] == "sure"
    student = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "answer"][0]
    assert student["confidence"] == "sure"
    s.step("next")
    asked_before = s.state["pending"]["question"]["id"]
    body = s.answer(right=True, confidence="guess")
    fb = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "feedback"][0]
    assert fb["luckyGuess"]
    ev = db.store[("users", UID, "tutor_lectures", s.lid, "progress", "main")]["topics"]["t1"]["evidence"]
    assert ev[-1]["confidence"] == "guess" and ev[-1]["credit"] == 0.5
    assert ev[0]["confidence"] == "sure" and not ev[0]["correct"]
    s.step("next")
    assert s.state["pending"]["question"]["id"] != asked_before


def test_report_removes_the_question_and_its_evidence(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    qid = s.state["pending"]["question"]["id"]
    s.answer(right=False)
    prog = lambda: db.store[("users", UID, "tutor_lectures", s.lid, "progress", "main")]  # noqa: E731
    assert any(e["qid"] == qid for e in prog()["topics"]["t1"]["evidence"])
    s.step("report", questionId=qid, reason="wrong_key")
    assert not any(e["qid"] == qid for e in prog()["topics"]["t1"]["evidence"])
    assert prog()["reported"] == [qid]
    s.step("report", expect=400, questionId=qid, reason="wrong_key")  # once per student
    s.step("report", expect=400, questionId="t1-neverseen", reason="unclear")
    # shared bank keeps an anonymous count, and the stats see it
    lesson = db.store[("tutor_cache", s.hash, "lessons", "t1")]
    q = next(x for x in lesson["questions"] if x["id"] == qid)
    assert q["reports"] == 1 and not q.get("disabled")
    assert db.store[("tutor_stats", s.hash[:24])]["questions"][qid]["reports"] == 1


def test_report_while_open_skips_it_and_three_reports_retire_it(api):
    http, db, fake, who = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    qid = s.state["pending"]["question"]["id"]
    s.step("report", questionId=qid, reason="unclear")
    assert s.state["pending"] is None
    s.step("next")
    assert s.state["pending"]["question"]["id"] != qid
    for other in ("stu-b", "stu-c"):
        who["uid"] = other
        o = Session(http, db, upload(http).json())
        o.step("next")
        o.step("test_out")
        # same shared bank + deterministic selection → the same first question
        assert o.state["pending"]["question"]["id"] == qid
        o.step("report", questionId=qid, reason="wrong_key")
    lesson = db.store[("tutor_cache", s.hash, "lessons", "t1")]
    q = next(x for x in lesson["questions"] if x["id"] == qid)
    assert q["reports"] == 3 and q["disabled"] is True
    who["uid"] = "stu-d"  # a fourth student never gets it
    d = Session(http, db, upload(http).json())
    d.step("next")
    d.step("test_out")
    assert d.state["pending"]["question"]["id"] != qid


def test_exact_command_answer_costs_no_model_call(api, monkeypatch):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")  # lesson generated
    # turn the open check question into a short command question with accepted answers
    key = ("tutor_cache", s.hash, "lessons", "t1")
    qid = s.state["pending"]["question"]["id"]
    for q in db.store[key]["questions"]:
        if q["id"] == qid:
            q.update({"format": "code", "model_answer": "ls -la", "accepted_answers": ["ls -la", "ls -al"]})
    before_grades, before_credits = fake.calls["grade"], credits(db)
    s.step("answer", questionId=qid, text="$ ls  -al")
    fb = s.blocks("feedback")[-1]
    assert fb["correct"] and fake.calls["grade"] == before_grades and credits(db) == before_credits


def test_due_reviews_reach_the_home_list_and_the_morning_push(api, monkeypatch):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    while s.state["stage"] == "quiz":
        s.answer(right=True)
        s.step("next")
    assert s.state["topics"]["t1"]["status"] == "mastered"
    from services import push

    today = dt.date.today()
    assert push.tutor_review_reminder(push.tutor_due(db, UID, today), today) == []  # nothing due yet
    later = today + dt.timedelta(days=2)
    items = push.tutor_review_reminder(push.tutor_due(db, UID, later), later)
    assert len(items) == 1 and "مراجعة اليوم" in items[0]["title"]
    assert items[0]["url"] == f"/tutor/?lecture={s.lid}&review=1"
    assert items[0]["key"] == f"tutor-review:{later.isoformat()}"  # one a day
    # the push only goes out when the student kept the «reviews» preference on
    monkeypatch.setattr(push, "load_prefs", lambda db, uid: {"lectures": False, "attendance": False, "exams": False, "reviews": False})
    assert push.daily_items(db, UID, later) == []
    import routers.tutor as rt

    monkeypatch.setattr(rt, "_now", lambda: dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2))
    row = http.get("/api/tutor/lectures").json()["lectures"][0]
    assert row["reviewDue"] == 1 and row["dueTopics"][0]["id"] == "t1"
