"""Dynamic study mode — pure parts: extraction, mastery rules, questions, topics."""

import asyncio

import pytest

from pdf_factory import make_pdf
from services.tutor import ingest, mastery, questions
from services.tutor.extract import ExtractError, extract_pages, page_block, sub_pdf, table_to_markdown


# ── extraction ────────────────────────────────────────────────────


def test_extract_keeps_page_order_code_indentation_and_flags_pictures():
    pdf = make_pdf([
        ["Stacks", "A stack is a LIFO structure: the last item pushed is the first popped."],
        {"image": True},
        {"lines": ["def push(s, x):", "    s.append(x)", "    return s"], "mono": True},
    ])
    pages = extract_pages(pdf)
    assert [p.n for p in pages] == [1, 2, 3]
    assert "LIFO" in pages[0].text and not pages[0].needs_vision
    assert pages[1].needs_vision and pages[1].images == 1 and pages[1].source == "none"
    assert "    s.append(x)" in pages[2].text  # indentation survives
    assert pages[2].source == "text"


def test_sub_pdf_keeps_only_requested_pages():
    pdf = make_pdf([["one"], {"image": True}, ["three"], {"image": True}])
    small = sub_pdf(pdf, [2, 4])
    got = extract_pages(small)
    assert len(got) == 2 and all(p.images == 1 for p in got)
    assert len(small) < len(pdf) + 500


def test_broken_and_oversized_files_are_refused(monkeypatch):
    with pytest.raises(ExtractError, match="broken"):
        extract_pages(b"%PDF-1.4 garbage")
    monkeypatch.setattr("services.tutor.extract.MAX_PAGES", 2)
    with pytest.raises(ExtractError, match="too many pages"):
        extract_pages(make_pdf([["a"], ["b"], ["c"]]))


def test_table_markdown_and_page_block():
    md = table_to_markdown([["Op", "Cost"], ["push", "O(1)"], ["a|b", None]])
    assert md.splitlines()[0] == "| Op | Cost |" and "a\\|b" in md
    assert table_to_markdown([["only one row"]]) is None
    pdf = make_pdf([{"image": True}])
    blank = extract_pages(pdf)[0]
    assert "تعذّرت قراءة" in page_block(blank)


# ── topics validation ─────────────────────────────────────────────


def _pages(n, readable=True):
    from services.tutor.extract import PageContent

    return [PageContent(n=i, text=f"content of page {i} " * 5 if readable else "", source="text" if readable else "none") for i in range(1, n + 1)]


def test_normalize_topics_clamps_orders_covers_and_links():
    raw = [
        {"title": "B", "pages": [5, 3], "concepts": [{"name": "x", "definition": "d"}], "prerequisites": [1], "importance": 9, "est_minutes": 999},
        {"title": "A", "pages": [1, 2], "concepts": [{"name": "y", "definition": "d"}], "prerequisites": []},
        {"title": "bad", "pages": ["x"]},
        {"title": "out", "pages": [50, 60]},
    ]
    topics = ingest.normalize_topics(raw, _pages(8))
    assert [t["title"] for t in topics] == ["A", "B"]
    assert topics[0]["pages"] == [1, 2] and topics[1]["pages"] == [3, 8]  # pages 6-8 attached
    assert topics[1]["prerequisites"] == ["t1"] and topics[1]["importance"] == 3
    # time comes from the material (6 slides of short text), not the model's 999
    assert topics[1]["est_minutes"] == 14 and topics[0]["est_minutes"] == 7
    assert topics[0]["concepts"][0]["id"] == "t1c1" and topics[1]["concepts"][0]["id"] == "t2c1"
    assert topics[0]["key_terms"] == [{"term": "y", "definition": "d"}]


def test_normalize_topics_falls_back_to_page_chunks_and_caps_count():
    fb = ingest.normalize_topics([], _pages(12))
    assert len(fb) == 3 and fb[0]["pages"] == [1, 5]
    many = [{"title": f"T{i}", "pages": [i, i]} for i in range(1, 21)]
    capped = ingest.normalize_topics(many, _pages(20))
    assert len(capped) == ingest.MAX_TOPICS
    assert capped[0]["pages"][0] == 1 and capped[-1]["pages"][1] == 20


def test_long_lectures_are_structured_in_batches(monkeypatch):
    from tests_helpers import fake_ai

    fake = fake_ai(monkeypatch)
    pages = _pages(100)
    raw = asyncio.run(ingest.structure(pages))
    assert fake.calls["structure"] == 3
    assert all(len(u) < 160_000 for u in fake.structure_inputs)
    topics = ingest.normalize_topics(raw["topics"], pages)
    assert topics[-1]["pages"][1] == 100 and len(topics) == ingest.MAX_TOPICS


# ── mastery rules ─────────────────────────────────────────────────


SKILL_OF = {"remember": "recall", "understand": "explain", "apply": "apply", "analyze": "debug"}


def ev(correct, kind="quiz", diff=2, bloom="apply", hints=0, concepts=("c1",), mis="", skill=None, confidence=None):
    return {"qid": "q", "kind": kind, "correct": correct, "credit": 1.0 if correct else 0.0, "difficulty": diff, "bloom": bloom, "hints": hints, "concept_ids": list(concepts), "misconception": mis, "skill": skill or SKILL_OF[bloom], "confidence": confidence}


def test_one_easy_quiz_never_means_mastery():
    easy = [ev(True, diff=1, bloom="remember") for _ in range(3)]
    a = mastery.assess(easy)
    assert a["score"] == 1.0 and not a["mastered"]
    assert any("تطبيق" in m for m in a["missing"]) and a["confidence"] <= 0.5


def test_checks_alone_are_not_enough_but_varied_quiz_evidence_is():
    checks = [ev(True, kind="check", bloom="understand") for _ in range(5)]
    assert not mastery.assess(checks)["mastered"]
    good = [ev(True, bloom="understand", diff=1), ev(True, bloom="apply", diff=2), ev(True, bloom="analyze", diff=3)]
    a = mastery.assess(good)
    assert a["mastered"] and a["missing"] == [] and a["confidence"] >= 0.6


def test_hints_lower_the_credit_and_dont_prove_application():
    hinted = [ev(True, bloom="understand", diff=1), {**ev(True, bloom="apply", hints=1), "credit": 0.75}, {**ev(True, bloom="analyze", diff=3, hints=2), "credit": 0.5}]
    a = mastery.assess(hinted)
    assert not a["mastered"] and a["score"] < 0.8


def test_two_recent_misses_block_mastery_and_recent_answers_weigh_more():
    hist = [ev(True, bloom="understand"), ev(True), ev(True, bloom="analyze", diff=3), ev(True), ev(False), ev(False)]
    assert not mastery.assess(hist)["mastered"]
    early_bad = [ev(False), ev(False), ev(True), ev(True)]
    late_bad = [ev(True), ev(True), ev(False), ev(False)]
    assert mastery.score_of(early_bad) > mastery.score_of(late_bad)


def test_status_review_schedule_and_weak_concepts():
    today = "2026-10-14"
    t = {"visitedAt": "x", "closedAt": "y", "evidence": [ev(True, bloom="understand", diff=1), ev(True), ev(True, bloom="analyze", diff=3)]}
    mastery.start_review_schedule(t, today)
    assert t["reviewDue"] == "2026-10-15" and mastery.status_of(t, today) == "mastered"
    assert mastery.status_of(t, "2026-10-15") == "review_due"
    mastery.schedule_after_review(t, True, "2026-10-15")
    assert t["reviewBox"] == 2 and t["reviewDue"] == "2026-10-18"
    mastery.schedule_after_review(t, False, "2026-10-18")
    assert t["reviewBox"] == 1 and t["reviewDue"] == "2026-10-19"
    assert mastery.status_of({}, today) == "not_started" and mastery.status_of({"visitedAt": "x"}, today) == "in_progress"
    assert mastery.status_of({"visitedAt": "x", "closedAt": "y", "evidence": [ev(False)]}, today) == "needs_review"
    mixed = [ev(True, concepts=["c1"]), ev(False, concepts=["c2"]), ev(False, concepts=["c2"]), ev(True, concepts=["c3"]), ev(False, concepts=["c3"])]
    assert mastery.weak_concepts(mixed) == ["c2", "c3"]


def test_points_are_separate_from_mastery():
    assert mastery.points_for(True, 3, 0, "quiz") > mastery.points_for(True, 1, 0, "quiz") > mastery.points_for(False, 1, 0, "quiz")
    assert mastery.points_for(True, 2, 2, "quiz") < mastery.points_for(True, 2, 0, "quiz")


# ── questions ─────────────────────────────────────────────────────


RAW_Q = {
    "format": "choice", "skill": "predict", "difficulty": 5, "concept_ids": ["c1", "zzz"],
    "prompt": "ما ناتج الكود؟ [ص 2] [ص 77]", "options": ["1", "2", "3"], "answer_index": 2,
    "option_feedback": ["لأنك عددت من الصفر"], "misconceptions": ["العد من الصفر", "x", "should be cleared"],
    "hints": ["h1", "h2", "h3"], "explanation": "e", "pages": [2, 99, "x"],
}


def test_normalize_question_validates_and_hides_answers():
    q = questions.normalize_question(RAW_Q, "t1", "quiz", {"c1"}, {1, 2, 3})
    assert q["difficulty"] == 3 and q["concept_ids"] == ["c1"] and q["bloom"] == "apply"
    assert "[ص 2]" in q["prompt"] and "[ص 77]" not in q["prompt"] and q["pages"] == [2]
    assert q["misconceptions"][2] == "" and len(q["option_feedback"]) == 3 and len(q["hints"]) == 2
    pub = questions.public_question(q)
    assert "answer_index" not in pub and "option_feedback" not in pub and pub["options"] == ["1", "2", "3"]
    assert questions.normalize_question({**RAW_Q, "answer_index": 7}, "t1", "quiz", set(), {1}) is None
    assert questions.normalize_question({**RAW_Q, "options": ["a", "a"]}, "t1", "quiz", set(), {1}) is None
    assert questions.normalize_question({"format": "text", "prompt": "اشرح الفكرة"}, "t1", "quiz", set(), {1}) is None


def test_grade_choice_reports_the_misconception_behind_the_pick():
    q = questions.normalize_question(RAW_Q, "t1", "quiz", {"c1"}, {1, 2, 3})
    wrong = questions.grade_choice(q, 0)
    assert wrong["valid"] and not wrong["correct"] and wrong["misconception"] == "العد من الصفر" and "الصفر" in wrong["note"]
    assert questions.grade_choice(q, "2")["correct"]
    assert not questions.grade_choice(q, 9)["valid"]


def test_selection_targets_weak_concepts_application_and_difficulty():
    pool = [
        {"id": "a", "difficulty": 1, "bloom": "remember", "format": "choice", "concept_ids": ["c1"]},
        {"id": "b", "difficulty": 2, "bloom": "apply", "format": "choice", "concept_ids": ["c2"]},
        {"id": "c", "difficulty": 3, "bloom": "analyze", "format": "choice", "concept_ids": ["c1"]},
    ]
    assert questions.select_next(pool, set(), 1)["id"] == "a"
    assert questions.select_next(pool, set(), 1, weak=["c2"])["id"] == "b"
    assert questions.select_next(pool, {"a"}, 1, need_higher_order=True)["id"] == "b"
    assert questions.select_next(pool, {"a", "b", "c"}, 2) is None
    assert questions.next_difficulty(2, True) == 3 and questions.next_difficulty(1, False) == 1


def test_diagnosis_rules():
    apply_gap = [ev(True, bloom="remember"), ev(True, bloom="understand"), ev(False, bloom="apply"), ev(False, bloom="analyze")]
    assert questions.diagnose(apply_gap, ["c1"], [])["strategy"] == "worked_example"
    repeated = [ev(False, mis="خلط"), ev(False, mis="خلط"), ev(True)]
    assert questions.diagnose(repeated, ["c1"], [])["strategy"] == "contrast"
    assert questions.diagnose(repeated, ["c1"], ["t1"])["strategy"] == "prerequisite"
    assert questions.diagnose([ev(False, bloom="remember")], ["c1"], [])["strategy"] == "reexplain"


def test_exam_blueprint_follows_importance_and_covers_every_topic():
    topics = [{"id": "t1", "importance": 3}, {"id": "t2", "importance": 1}, {"id": "t3", "importance": 2}]
    plan = questions.exam_blueprint(topics)
    assert all(v >= 1 for v in plan.values()) and plan["t1"] > plan["t2"]
    assert 6 <= sum(plan.values()) <= 15
    big = [{"id": f"t{i}", "importance": 3} for i in range(12)]
    assert sum(questions.exam_blueprint(big).values()) == 15


def test_page_refs():
    assert questions.cited_pages("انظر [ص 3] و[ص 5-7]") == [3, 5, 6, 7]
    assert questions.strip_bad_refs("[ص 3] [ص 5-70]", {3, 5}) == "[ص 3] "


def test_one_question_pattern_is_not_mastery():
    """Same skill every time (e.g. only 'predict the output'): understanding not shown in a second form."""
    same = [ev(True, bloom="apply", diff=2, skill="predict"), ev(True, bloom="apply", diff=3, skill="predict"), ev(True, bloom="analyze", diff=2, skill="predict")]
    a = mastery.assess(same)
    assert not a["mastered"] and any("صيغة ثانية" in m for m in a["missing"])
    varied = same[:2] + [ev(True, bloom="analyze", diff=2, skill="debug")]
    assert mastery.assess(varied)["mastered"]


def test_guesses_do_not_prove_application():
    guessed = [ev(True, bloom="understand", diff=1), {**ev(True, bloom="apply", confidence="guess"), "credit": 0.5}, {**ev(True, bloom="analyze", diff=3, confidence="guess"), "credit": 0.5}]
    a = mastery.assess(guessed)
    assert not a["mastered"] and any("تخمين" in m for m in a["missing"])


def test_calibration_and_confident_errors_drive_contrast():
    evs = [ev(False, confidence="sure", mis="x"), ev(True, confidence="guess"), ev(True, confidence="sure")]
    c = mastery.calibration(evs)
    assert c["confident_errors"] == 1 and c["lucky_guesses"] == 1 and c["by_level"]["sure"] == {"answers": 2, "correct": 1}
    assert questions.diagnose([ev(True, bloom="remember"), ev(False, bloom="apply", confidence="sure")], ["c1"], [])["strategy"] == "contrast"


def test_short_command_answers_are_graded_in_code():
    q = questions.normalize_question(
        {"format": "code", "skill": "write_code", "prompt": "اكتب أمراً يعرض كل الملفات", "model_answer": "ls -la", "accepted_answers": ["ls -la", "ls -al"]},
        "t1", "quiz", set(), {1},
    )
    assert questions.match_accepted(q, "$ ls   -al ")
    assert questions.match_accepted(q, "`ls -la`")
    assert not questions.match_accepted(q, "ls")
    assert "accepted_answers" not in questions.public_question(q)


def test_selection_prefers_an_unsolved_form_of_question():
    pool = [
        {"id": "a", "difficulty": 2, "bloom": "apply", "format": "choice", "concept_ids": ["c1"], "skill": "predict"},
        {"id": "b", "difficulty": 2, "bloom": "apply", "format": "choice", "concept_ids": ["c1"], "skill": "debug"},
        {"id": "c", "difficulty": 2, "bloom": "apply", "format": "choice", "concept_ids": ["c1"], "skill": "apply", "disabled": True},
    ]
    assert questions.select_next(pool, set(), 2, solved_skills={"predict"})["id"] == "b"
    assert questions.select_next(pool, {"a", "b"}, 2) is None  # disabled questions are never asked


def test_time_estimate_grows_with_material_and_old_lectures_are_refreshed():
    from services.tutor.extract import PageContent

    short = [PageContent(n=1, text="Stack: last in first out.")]
    long = [PageContent(n=i, text="word " * 300 + "\n" + "cat f | grep x\n" * 16) for i in range(1, 6)]
    assert ingest.estimate_minutes(short) == 6 and 30 <= ingest.estimate_minutes(long) <= 40
    lec = {"topics": [{"pages": [1, 1], "est_minutes": 30}], "estMinutes": 215}
    assert ingest.refresh_estimates(lec, short) and lec["estMinutes"] == 6 and lec["estVersion"] == ingest.ESTIMATE_VERSION
    assert not ingest.refresh_estimates(lec, short)  # once
