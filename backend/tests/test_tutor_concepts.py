"""Phase 5b: each concept's memory (FSRS), each question's measured difficulty
(Elo), and a deep-dive page per concept (services/tutor/mastery.py, engine)."""

from services.tutor import mastery
from test_tutor_flow import UID, Session, api, credits, upload  # noqa: F401  (the same fixture as the study journey)

DAY = "2026-11-18"


# ── FSRS ────────────────────────────────────────────────────────────


def test_grades_follow_what_the_answer_shows():
    assert mastery.fsrs_grade(False) == 1
    assert mastery.fsrs_grade(True, hints=1) == 2
    assert mastery.fsrs_grade(True, confidence="guess") == 2
    assert mastery.fsrs_grade(True, confidence="think") == 3
    assert mastery.fsrs_grade(True, confidence="sure", difficulty=3) == 4


def test_memory_grows_when_remembered_and_shrinks_when_forgotten():
    first = mastery.fsrs_review(None, 3, DAY)
    assert first["S"] == mastery.FSRS_W[2] and first["due"] > DAY and first["reps"] == 1
    # answering again the same day adds nothing: no time has passed to forget in
    same_day = mastery.fsrs_review(first, 3, DAY)
    assert same_day["S"] == first["S"]
    later = first["due"]
    remembered = mastery.fsrs_review(first, 3, later)
    forgotten = mastery.fsrs_review(first, 1, later)
    assert remembered["S"] > 2 * first["S"] and remembered["due"] > first["due"]
    assert forgotten["S"] < first["S"] and forgotten["lapses"] == 1 and forgotten["D"] > first["D"]
    assert forgotten["due"] == mastery.add_days(later, 1)
    # on the due day, recall has fallen to about the target
    assert 0.85 <= mastery.retrievability(first, later) <= 0.95


def test_only_assessed_answers_review_concepts():
    topic: dict = {}
    mastery.add_evidence(topic, {"kind": "check", "correct": True, "concept_ids": ["c1"]}, DAY)
    assert "concepts" not in topic
    mastery.add_evidence(topic, {"kind": "quiz", "correct": True, "concept_ids": ["c1", "c2"], "difficulty": 2}, DAY)
    assert set(topic["concepts"]) == {"c1", "c2"}
    mastery.add_evidence(topic, {"kind": "quiz", "correct": False, "concept_ids": ["c2"], "difficulty": 2}, DAY)
    assert topic["concepts"]["c2"]["lapses"] == 1
    # the topic's review comes when its first concept is due — never today
    mastery.start_review_schedule(topic, DAY)
    assert topic["reviewDue"] == max(mastery.add_days(DAY, 1), min(m["due"] for m in topic["concepts"].values()))
    later = mastery.add_days(DAY, 30)
    assert mastery.concepts_due(topic, later)[0] == "c2"  # the weaker memory first
    states = mastery.concept_states(topic, ["c1", "c2", "c3"], DAY)
    assert states["c1"]["level"] == "strong" and states["c2"]["level"] == "weak" and states["c3"]["level"] == "unknown"
    assert states["c3"]["due"] is None and states["c1"]["recall"] == 1.0


def test_without_concepts_the_old_ladder_still_schedules():
    topic: dict = {}
    mastery.start_review_schedule(topic, DAY)
    assert topic["reviewDue"] == mastery.add_days(DAY, mastery.REVIEW_INTERVALS[0])


# ── Elo ─────────────────────────────────────────────────────────────


def test_a_surprise_moves_ratings_more_than_the_expected():
    theta, easy = mastery.elo_update(0.0, None, 1, True)
    _, easy_missed = mastery.elo_update(0.0, None, 1, False)
    assert theta > 0 and easy["n"] == 1
    assert abs(easy_missed["b"] - (-0.8)) > abs(easy["b"] - (-0.8))  # missing an easy one says more
    assert easy_missed["b"] > -0.8  # …and makes the question look harder


def test_measured_difficulty_replaces_the_guess_after_enough_answers():
    rating = None
    theta = 0.0
    for _ in range(mastery.ELO_TRUSTED - 1):
        theta, rating = mastery.elo_update(0.0, rating, 1, False)
    assert mastery.measured_difficulty(rating, 1) == 1  # not trusted yet
    for _ in range(4):
        theta, rating = mastery.elo_update(0.0, rating, 1, False)
    assert rating["n"] >= mastery.ELO_TRUSTED and mastery.measured_difficulty(rating, 1) >= 2


# ── through the API ─────────────────────────────────────────────────


def test_answers_rate_the_questions_for_everyone(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("test_out")
    qid = s.state["pending"]["question"]["id"]
    s.answer(right=False)
    ratings = db.store[("tutor_cache", s.hash, "ratings", "t1")]
    assert ratings[qid]["n"] == 1
    assert "uid" not in str(ratings) and UID not in str(ratings)  # anonymous
    ts = db.store[("users", UID, "tutor_lectures", s.lid, "progress", "main")]["topics"]["t1"]
    assert ts["theta"] < 0


def test_the_goal_lists_the_concepts_and_each_opens_a_deep_dive(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    goal = s.blocks("goal")[-1]
    concepts = goal["concepts"]
    assert concepts and all({"id", "name", "level", "due"} <= set(c) for c in concepts)
    cid = concepts[0]["id"]

    before = credits(db)
    body = s.step("deep_dive", conceptId=cid)
    block = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "deep_dive"][0]
    assert block["name"] == concepts[0]["name"] and block["topicTitle"]
    assert [p["role"] for p in block["parts"]] == ["idea", "how", "real_world", "summary"]
    assert block["parts"][2]["origin"] == "added" and block["reviewed"] is True
    assert all(r["id"] != "t99c9" for r in block["related"])  # an unknown concept is dropped
    assert body["messages"][0]["blocks"][0] == {"type": "request", "text": f"تعمّق في: {concepts[0]['name']}"}
    assert fake.calls["deep_dive"] == 1 and credits(db) == before + 1
    assert db.store[("tutor_cache", s.hash, "concepts", cid)]["review"]["checked"] == 3

    # written once for this file: opening it again costs nothing and calls no model
    s.step("deep_dive", conceptId=cid)
    assert fake.calls["deep_dive"] == 1 and credits(db) == before + 1

    assert s.step("deep_dive", expect=400, conceptId="nope")


def test_no_deep_dive_in_the_middle_of_a_test(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    cid = s.blocks("goal")[-1]["concepts"][0]["id"]
    s.step("test_out")
    assert s.state["pending"]["context"] == "quiz"
    r = s.step("deep_dive", expect=400, conceptId=cid)
    assert "أكمل السؤال الحالي" in r["detail"] and fake.calls["deep_dive"] == 0
