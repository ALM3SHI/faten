"""Retrieval quality for the regulations knowledge base (RAG).

The question sets mirror how students actually ask (Saudi dialect,
typos, everyday words like "مادة" for "مقرر"). If a change to the index,
synonyms or ranking makes any of these miss, this test fails.
"""

import pytest

from services import regulations as R

# question → acceptable document ids ("|"-separated) and optional exact article
STUDENT = {
    "كم نسبة الغياب اللي تحرمني من الاختبار النهائي": ("study_exams", "المادة 14"),
    "متى يفصلوني من الجامعة بسبب المعدل": ("study_exams", "المادة 22"),
    "ابغى انسحب من مادة وحدة كيف": ("study_exams", "المادة 17"),
    "كم اقل عدد ساعات اسجلها في الترم": ("study_exams", "المادة 13"),
    "غبت عن الفاينل بعذر طبي وش اسوي": ("study_exams|exam_guide", ""),
    "ابغى اعترض على درجتي النهائية": ("study_exams|exam_guide|student_rights", ""),
    "كم مرة اقدر اأجل دراستي": ("study_exams", "المادة 18"),
    "شروط مرتبة الشرف الاولى": ("study_exams", "المادة 39"),
    "وش عقوبة الغش في الاختبار": ("exam_guide|conduct", ""),
    "ابغى قرض من صندوق الطلاب": ("student_fund", ""),
    "كيف اأسس نادي طلابي": ("student_clubs", ""),
    "كم مدة التدريب التعاوني وكيف اسجل فيه": ("coop_training", ""),
    "شروط القبول في الماجستير": ("grad_studies", ""),
    "متى يلغى قيد طالب الماجستير": ("grad_studies", ""),
    "هل لي حق في براءة اختراع مشروع تخرجي": ("intellectual_property|research_innovation", ""),
    "وش اسوي اذا تعرضت لتحرش": ("anti_harassment|conduct|student_rights", ""),
    "شروط استخدام الايميل الجامعي": ("email_policy", ""),
    "وش الصفات اللي المفروض تكون في خريج ام القرى": ("graduate_attributes", ""),
    "الدبلوم في الكلية التطبيقية كم مدته": ("applied_college", ""),
    "ابغى اعرف كيف يحسب المعدل التراكمي": ("study_exams", ""),
    "الطالب الزائر يدرس في جامعة ثانية": ("study_exams", ""),
    "هل اقدر انقل من كلية لكلية": ("study_exams", ""),
    "وش حقوقي في التظلم من قرار تأديبي": ("student_rights|conduct", ""),
}

STAFF = {
    "كم إجازة عضو هيئة التدريس الاعتيادية": ("faculty_affairs", ""),
    "شروط الترقية لأستاذ مشارك": ("faculty_affairs", ""),
    "بدل السكن لعضو هيئة التدريس": ("faculty_housing|faculty_affairs", ""),
    "عقوبات الموظف في نظام الانضباط الوظيفي": ("employee_discipline_law", ""),
    "ما هو مجلس الأمناء في نظام الجامعات": ("universities_law", ""),
    "تعارض المصالح والإفصاح": ("conflict_of_interest|ethics_compliance", ""),
}


def _hit(question, docs, article, k):
    hits = R._load_index().search(question, k=k)
    return any(
        c["doc_id"] in docs.split("|") and (not article or c["article"].split(":")[0] == article)
        for _, c in hits
    )


@pytest.mark.parametrize("question,expected", list(STUDENT.items()) + list(STAFF.items()))
def test_question_finds_the_right_regulation(question, expected):
    # The agent receives the top 5 results (search_regulations default).
    docs, article = expected
    assert _hit(question, docs, article, k=5), f"no match in top-5 for: {question}"


def test_index_is_loaded_with_core_documents():
    idx = R._load_index()
    assert len(idx.chunks) > 1000
    for doc_id in ("study_exams", "student_rights", "conduct", "exam_guide", "grad_studies"):
        assert doc_id in idx.documents


def test_study_regulation_has_all_54_articles():
    arts = {c["article"] for c in R._load_index().chunks if c["doc_id"] == "study_exams"}
    assert {f"المادة {n}" for n in range(1, 55)} <= arts


def test_arabic_normalisation_and_stemming():
    assert R.normalize("إِنْذَار") == "انذار"
    assert R.normalize("مكافأة") == "مكافاه"
    assert R.tokenize("المقررات") == R.tokenize("مقررات")
    assert "ابغي" not in R.tokenize("ابغى انسحب")  # dialect filler words are dropped


def test_tool_output_shape_and_unknown_query():
    out = R.search_regulations("نسبة الغياب والحرمان")
    assert out["found"] is True and len(out["results"]) <= 5
    first = out["results"][0]
    assert {"document", "article", "text", "audience"} <= first.keys()
    assert R.search_regulations("xyzzy qwerty")["found"] is False


def test_ocr_documents_carry_a_warning_note():
    out = R.search_regulations("مجلس الأمناء نظام الجامعات")
    ocr = [r for r in out["results"] if r["document"] == "نظام الجامعات"]
    assert ocr and all("note" in r for r in ocr)
