"""Phase 5: new question formats (order, match, fill) graded in code, and every
objective question solved by the review before a student sees it."""

from services.tutor import questions
from services.tutor.engine import _solved_right
from test_tutor_flow import Session, api, upload  # noqa: F401  (the same fixture as the study journey)

PAGES = {1, 2, 3}


def norm(raw, pool="quiz"):
    return questions.normalize_question({"skill": "apply", "bloom": "apply", "difficulty": 2, "prompt": "سؤال للتجربة هنا", "hints": [], "explanation": "", **raw}, "t1", pool, set(), PAGES)


def test_order_is_shown_shuffled_and_graded_by_position():
    q = norm({"format": "order", "steps": ["افتح الملف", "اقرأ السطر", "عالج البيانات", "أغلق الملف"]})
    assert q and q["steps"][0] == "افتح الملف"
    pub = questions.public_question(q)
    assert "steps" not in pub and sorted(pub["items"]) == sorted(q["steps"]) and pub["items"] != q["steps"]
    # the same question always shows the same order (a reload changes nothing)
    assert questions.public_question(norm({"format": "order", "steps": q["steps"]}))["items"] == pub["items"]

    right = [pub["items"].index(s) for s in q["steps"]]
    g = questions.grade_order(q, right)
    assert g["correct"] and g["answer_text"] == " ← ".join(q["steps"])
    swapped = right[:]
    swapped[0], swapped[1] = swapped[1], swapped[0]
    g = questions.grade_order(q, swapped)
    assert not g["correct"] and "2 من 4" in g["note"]
    assert questions.grade_order(q, [0, 0, 1, 2])["valid"] is False  # an item twice
    assert questions.grade_order(q, [0, 1])["valid"] is False  # not all placed


def test_match_pairs_and_grades_each_link():
    q = norm({"format": "match", "pairs": ["push => يضيف للقمة", "pop => يسحب من القمة", "peek => يقرأ القمة"]})
    pub = questions.public_question(q)
    assert pub["lefts"] == ["push", "pop", "peek"] and sorted(pub["rights"]) == sorted(["يضيف للقمة", "يسحب من القمة", "يقرأ القمة"])
    assert "pairs" not in pub
    right = [pub["rights"].index(p["right"]) for p in q["pairs"]]
    assert questions.grade_match(q, right)["correct"]
    wrong = [right[1], right[0], right[2]]
    g = questions.grade_match(q, wrong)
    assert not g["correct"] and "1 من 3" in g["note"]


def test_invalid_new_questions_are_refused():
    assert norm({"format": "order", "steps": ["a", "b"]}) is None  # too few
    assert norm({"format": "order", "steps": ["a", "a", "b"]}) is None  # repeated
    assert norm({"format": "match", "pairs": ["only => one"]}) is None
    assert norm({"format": "match", "pairs": ["a => x", "b => x"]}) is None  # two lefts, one meaning
    assert norm({"format": "fill"}) is None  # no accepted answer


def test_fill_in_the_blank_forgives_case_spacing_and_the_article():
    q = norm({"format": "fill", "prompt": "البنية التي تعمل بمبدأ LIFO اسمها ____", "accepted_answers": ["المكدس", "Stack"]})
    assert questions.BLANK in q["prompt"] and q["model_answer"] == "المكدس"
    for ok in ("المكدس", " مكدس ", "stack", "STACK."):
        assert questions.match_fill(q, ok), ok
    assert not questions.match_fill(q, "الطابور")
    assert questions.BLANK in norm({"format": "fill", "prompt": "اسم البنية LIFO", "accepted_answers": ["المكدس"]})["prompt"]


def test_the_reviewer_must_reach_the_key():
    choice = norm({"format": "choice", "options": ["أ", "ب", "ج", "د"], "answer_index": 2})
    assert _solved_right(choice, {"choice": 2}) and not _solved_right(choice, {"choice": 0})
    fill = norm({"format": "fill", "prompt": "بنية LIFO اسمها ____", "accepted_answers": ["المكدس"]})
    assert _solved_right(fill, {"text": "مكدس"}) and not _solved_right(fill, {"text": "طابور"})
    text = norm({"format": "text", "model_answer": "شرح"})
    assert _solved_right(text, {})  # written answers are not solved here


def test_a_question_whose_key_the_review_does_not_reach_is_never_asked(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    s.step("next")
    tid = s.state["currentTopicId"]
    lesson = db.store[("tutor_cache", s.hash, "lessons", tid)]
    wrong = [q for q in lesson["questions"] if "مفتاح خاطئ" in q["prompt"]]
    assert wrong and wrong[0]["disabled"] and wrong[0]["disabledReason"] == "review"
    assert lesson["review"]["disabled"] == 1 and lesson["review"]["solved"] >= 10
    assert sum(1 for q in lesson["questions"] if q.get("disabled")) == 1  # the others reached their key

    # the whole mastery quiz never shows it
    s.answer(right=True)
    seen = []
    for _ in range(40):
        if s.state["phase"] != "topic" or s.state["currentTopicId"] != tid:
            break
        if s.state["pending"]:
            seen.append(s.state["pending"]["question"]["prompt"])
            s.answer(right=True)
        s.step("next")
    assert seen and not any("مفتاح خاطئ" in p for p in seen)


def test_order_and_match_questions_are_answered_through_the_api(api):
    http, db, fake, _ = api
    s = Session(http, db, upload(http).json())
    s.step("next")
    tid = s.state["currentTopicId"]
    s.step("next")  # the lesson and its first check question
    lesson_ref = ("tutor_cache", s.hash, "lessons", tid)
    qid = s.state["pending"]["question"]["id"]
    check = next(q for q in db.store[lesson_ref]["questions"] if q["id"] == qid)
    order = norm({"format": "order", "steps": ["push(1)", "push(2)", "pop()"]}, pool="check")
    check.update({k: order[k] for k in ("format", "steps", "shown")})
    check.pop("options", None)
    pub = questions.public_question(check)

    wrong = [pub["items"].index(x) for x in ["push(2)", "push(1)", "pop()"]]
    body = s.step("answer", questionId=qid, order=wrong)
    fb = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "feedback"][0]
    assert not fb["correct"] and fb["retry"] and "correctOrder" not in fb  # a check: try again, no answer shown
    assert s.step("answer", expect=400, questionId=qid, order=[0, 0, 1])
    body = s.step("answer", questionId=qid, order=[pub["items"].index(x) for x in ["push(1)", "push(2)", "pop()"]])
    fb = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "feedback"][0]
    student = [b for m in body["messages"] for b in m["blocks"] if b["type"] == "answer"][0]
    assert fb["correct"] and student["text"] == "push(1) ← push(2) ← pop()"
