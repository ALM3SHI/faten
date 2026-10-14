"""Registration and academic-standing rules, each tied to its source.

Source: «القواعد التنفيذية للائحة الدراسة والاختبارات للمرحلة الجامعية بجامعة أم القرى»
https://uqu.edu.sa/App/Regulations/1480 — re-checked 2026-10-14 against the live
page (last modified 2026-07-13, in force from the start of 1444 AH); the copy in
knowledge/regulations/ matches it paragraph for paragraph.

Kinds of rule — kept apart on purpose:
  hard         registration constraints the planner never breaks;
  standing     graduation and academic-warning rules (different things: graduation
               needs the program's GPA at the end; a warning is issued each regular
               term the cumulative GPA is below that same program GPA);
  default      Faten planning defaults — NOT regulations, always shown as assumptions;
  unknown      values the regulation delegates to the University Council or the
               department and that no official source we found states.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

STUDY_RULES_DOC = "القواعد التنفيذية للائحة الدراسة والاختبارات للمرحلة الجامعية بجامعة أم القرى"
STUDY_RULES_URL = "https://uqu.edu.sa/App/Regulations/1480"
STUDY_RULES_DOC_DATE = "2026-07-13"
STUDY_RULES_CHECKED = "2026-10-14"


class Rule(BaseModel):
    id: str
    text_ar: str
    value: float | int | bool | None
    status: Literal["verified", "unavailable", "assumption"]
    kind: Literal["hard", "standing", "default", "unknown", "info"]
    source: str
    source_url: str | None = STUDY_RULES_URL
    article: str | None = None


def _v(id: str, kind: str, value, text: str, article: str | None = None) -> Rule:
    return Rule(id=id, kind=kind, value=value, status="verified", source=STUDY_RULES_DOC, article=article, text_ar=text)  # type: ignore[arg-type]


RULES: dict[str, Rule] = {
    r.id: r
    for r in [
        # ── hard registration constraints ─────────────────────────
        _v("min_regular_load", "hard", 10, "لا يقل العبء الدراسي عن 10 ساعات، ولا يشمل ذلك: المتوقع تخرجه وباقٍ له أقل من 10 ساعات، "
           "وغير الملتزم بالخطة، والمتعثر لعدم طرح مقررات، والزائر لجامعة أخرى.", "المادة الثالثة عشرة — القاعدة التنفيذية"),
        _v("max_summer_load", "hard", 10, "الحد الأعلى للعبء في الفصل الصيفي 10 ساعات، ولا يشمل ذلك المقررات المعادلة.",
           "المادة الثالثة عشرة — القاعدة التنفيذية"),
        _v("prerequisites_required", "hard", True, "يجب استيفاء المتطلبات السابقة عند التسجيل وعدم تعارض الجدول، وللمشرف الأكاديمي الموافقة "
           "على تجاوز المتطلب أو رفضه ويعتمد ذلك رئيس القسم.", "المادة الثالثة عشرة — القاعدة التنفيذية"),
        _v("corequisites", "hard", True, "يجوز أن يكون للمقرر متطلب سابق أو متطلب متزامن معه (يُدرس في الفصل نفسه أو قبله).",
           "المادة الأولى — تعريف المقرر الدراسي"),
        _v("coop_exclusive", "hard", True, "لا يجوز الجمع بين تسجيل مقررات والتدريب التعاوني في البرامج التي تتطلب تفرّغ الطالب للتدريب.",
           "المادة الثالثة عشرة — القاعدة التنفيذية"),
        _v("ic_blocks_dependents", "hard", True, "لا يُسجَّل مقرر متطلبه مرصود له «غير مكتمل» (IC) إلا بموافقة المشرف واعتماد رئيس القسم."),
        _v("prep_year_registration", "hard", True, "تُسجَّل جميع مقررات المستوى لطلبة السنة الأولى والسنة التأهيلية في كل فصل، "
           "دون النظر إلى استيفاء المتطلبات السابقة.", "المادة الثالثة عشرة — القاعدة التنفيذية"),
        _v("prep_year_no_drop", "hard", True, "لا يجوز حذف مقرر في برامج السنة الأولى أو السنة التأهيلية.",
           "المادة الثالثة عشرة — القاعدة التنفيذية"),
        # ── standing: graduation vs warnings ──────────────────────
        _v("gpa_all_attempts", "standing", True, "المعدل التراكمي = مجموع نقاط جميع المقررات التي درسها الطالب منذ التحاقه ÷ مجموع وحداتها.",
           "المادة الأولى — تعريف المعدل التراكمي"),
        _v("graduation_requirement", "standing", True, "يتخرج الطالب بعد إنهاء متطلبات خطته بنجاح، على ألا يقل معدله التراكمي عن المعدل الذي "
           "يحدده مجلس الجامعة لكل تخصص، وألا يقل في كل الأحوال عن تقدير «مقبول».", "مادة التخرج"),
        _v("grad_gpa_floor", "standing", 1.00, "أدنى معدل تخرج ممكن لأي تخصص هو حد تقدير «مقبول»: 1.00 من 4.00.",
           "مادة التخرج + مادة التقديرات (مقبول: من 1.00 إلى أقل من 1.75)"),
        _v("warning_below_grad_gpa", "standing", True, "يُعد انخفاض المعدل التراكمي عن المعدل المحدد للتخرج لتخصص الطالب إنذاراً أكاديمياً "
           "يُشار إليه في السجل.", "المادتان الحادية والأربعون والثانية والأربعون"),
        _v("dismissal_three_warnings", "standing", True, "ثلاثة إنذارات متتالية تؤدي إلى الفصل، ولمجلس الجامعة منح فرص إضافية (حتى عام دراسي) "
           "إذا ثبتت إمكانية رفع المعدل.", "المادتان الحادية والأربعون والثانية والأربعون"),
        _v("summer_no_warning", "standing", True, "لا يُحتسب الفصل الصيفي ضمن الفصول التي تُمنح فيها الإنذارات الأكاديمية."),
        _v("retake_to_raise_gpa", "standing", 0.20, "من أنهى ساعات خطته ومعدله دون معدل التخرج يعيد مقررات بحد أقصى 20% من ساعات الخطة، "
           "ويُرصد التقدير الأعلى ولا يتجاوز المعدل الناتج معدل التخرج."),
        _v("honors_first", "info", 3.75, "مرتبة الشرف الأولى من 3.75 إلى 4.00، والثانية من 3.25 إلى أقل من 3.75، بشروط المدة والساعات."),
        # ── unknown: delegated, not published ─────────────────────
        Rule(id="max_regular_load", value=None, status="unavailable", kind="unknown", source=STUDY_RULES_DOC,
             text_ar="لا يوجد في نص القواعد التنفيذية (حسب مراجعة 2026-10-14) حدٌّ أعلى للعبء في الفصل العادي؛ "
                     "تعرّف القواعد العبء بأنه ما يحدده مجلس الجامعة دون ذكر رقم."),
        Rule(id="program_grad_gpa", value=None, status="unavailable", kind="unknown", source=STUDY_RULES_DOC,
             text_ar="معدل التخرج الخاص بكل تخصص يحدده مجلس الجامعة، ولم نجده منشوراً لأي من البرامج المضافة. "
                     "بدونه لا يمكن الجزم بحالة الإنذار إلا إذا كان المعدل أقل من 1.00."),
        Rule(id="prereq_and_or", value=None, status="unavailable", kind="unknown", source="صفحات الخطط وتوصيفات المقررات",
             source_url=None, text_ar="الخطط والتوصيفات تذكر قائمة المتطلبات دون أن تنص على أنها «و» أو «أو»؛ يعاملها فطن كلها لازمة احتياطاً."),
        Rule(id="level_restrictions", value=None, status="unavailable", kind="unknown", source="—", source_url=None,
             text_ar="لم نجد شروط تسجيل منشورة حسب المستوى أو الساعات المجتازة (عدا ما يرد في توصيف مقرر بعينه مثل «موافقة القسم»)."),
        Rule(id="offerings", value=None, status="unavailable", kind="unknown", source="—", source_url=None,
             text_ar="المقررات المطروحة لكل فصل لا تُنشر علناً؛ تظهر في نظام التسجيل فقط."),
        # ── Faten planning defaults ───────────────────────────────
        Rule(id="default_max_regular_load", value=18, status="assumption", kind="default", source="فطن", source_url=None,
             text_ar="18 ساعة حدٌّ افتراضي للتخطيط فقط وليس من اللائحة؛ يغيّره الطالب من الإعدادات."),
    ]
}

#: Planning default used only when the student has not chosen (rule `default_max_regular_load`).
DEFAULT_MAX_REGULAR_LOAD = 18
ABSOLUTE_MAX_REGULAR_LOAD = 21  # guard-rail for user input, not a regulation


def rule(rule_id: str) -> Rule:
    return RULES[rule_id]


def cite(rule_id: str) -> dict:
    r = RULES[rule_id]
    return {"rule": r.id, "text": r.text_ar, "status": r.status, "kind": r.kind, "source": r.source,
            "source_url": r.source_url, "article": r.article,
            "checked": STUDY_RULES_CHECKED if r.source == STUDY_RULES_DOC else None}
