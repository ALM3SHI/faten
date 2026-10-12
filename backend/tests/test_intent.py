import pytest

from agent.intent import classify_intent_heuristic


@pytest.mark.parametrize("message,expected", [
    ("كم نسبة الغياب اللي تحرمني", "REGULATIONS"),
    ("ابغى انسحب من مادة", "REGULATIONS"),
    ("وش عقوبة الغش", "REGULATIONS"),
    ("شروط القبول في الماجستير", "REGULATIONS"),
    ("متى الاختبارات النهائية", "ACADEMIC_CALENDAR"),
    ("متى ميد CS4510", "COURSE_INFO"),
    ("كم معدلي", "GPA_QUERY"),
    ("مرحبا", "GREETING"),
])
def test_heuristic_routing(message, expected):
    assert classify_intent_heuristic([{"role": "user", "content": message}])["intent"] == expected


def test_dialect_word_haqi_is_not_a_regulations_question():
    # "حقي" means "my" in Saudi dialect, not "my right".
    r = classify_intent_heuristic([{"role": "user", "content": "وش جدولي حقي اليوم"}])
    assert r["intent"] != "REGULATIONS"


def test_navigation_targets_existing_pages():
    import agent.intent as intent_module
    src = open(intent_module.__file__, encoding="utf-8").read()
    assert '"/map"' not in src  # retired route — the page is /locations


@pytest.mark.parametrize("msg", ["وش آخر أخبار الجامعة؟", "اخبار الجامعه اليوم", "ايش الاخبار", "أحدث الإعلانات"])
def test_news_questions_route_to_news(msg):
    assert classify_intent_heuristic([{"role": "user", "content": msg}])["intent"] == "UNIVERSITY_NEWS"


def test_news_prompt_is_built():
    from agent.prompts import build_system_prompt
    p = build_system_prompt(None, None, None, None, intent="UNIVERSITY_NEWS")
    assert "get_university_news" in p
