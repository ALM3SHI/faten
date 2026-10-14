"""Registration rules the planner must respect, each tied to its source.

Only rules found in the official text in knowledge/regulations/ are
`verified`. Values the regulation leaves to the University Council or the
department (regular-term maximum load, a program's graduation GPA) are
`unavailable` here: the planner then uses the student's own setting and
says so, instead of inventing a number.
"""

from __future__ import annotations

from pydantic import BaseModel

STUDY_RULES_DOC = "القواعد التنفيذية للائحة الدراسة والاختبارات للمرحلة الجامعية بجامعة أم القرى"
STUDY_RULES_URL = "https://uqu.edu.sa/dadregis/151795"


class Rule(BaseModel):
    id: str
    text_ar: str
    value: float | int | bool | None
    status: str  # verified | unavailable
    source: str
    article: str | None = None


RULES: dict[str, Rule] = {
    r.id: r
    for r in [
        Rule(id="min_regular_load", value=10, status="verified", source=STUDY_RULES_DOC, article="المادة الثالثة عشرة — القاعدة التنفيذية",
             text_ar="لا يقل العبء الدراسي عن 10 ساعات، إلا للمتوقع تخرجه وباقٍ له أقل من 10 ساعات، أو عند عدم طرح مقررات."),
        Rule(id="max_summer_load", value=10, status="verified", source=STUDY_RULES_DOC, article="المادة الثالثة عشرة — القاعدة التنفيذية",
             text_ar="الحد الأعلى للعبء في الفصل الصيفي 10 ساعات."),
        Rule(id="prerequisites_required", value=True, status="verified", source=STUDY_RULES_DOC, article="المادة الثالثة عشرة — القاعدة التنفيذية",
             text_ar="يجب استيفاء المتطلبات السابقة عند التسجيل، وللمشرف الأكاديمي الموافقة على تجاوز المتطلب بعد اعتماد رئيس القسم."),
        Rule(id="coop_exclusive", value=True, status="verified", source=STUDY_RULES_DOC, article="المادة الثالثة عشرة — القاعدة التنفيذية",
             text_ar="لا يجوز الجمع بين تسجيل مقررات والتدريب التعاوني في البرامج التي تتطلب تفرّغ الطالب للتدريب."),
        Rule(id="ic_blocks_dependents", value=True, status="verified", source=STUDY_RULES_DOC,
             text_ar="لا يُسجَّل مقرر متطلبه مرصود له «غير مكتمل» (IC) إلا بموافقة المشرف واعتماد رئيس القسم."),
        Rule(id="gpa_all_attempts", value=True, status="verified", source=STUDY_RULES_DOC, article="المادة الأولى — تعريف المعدل التراكمي",
             text_ar="المعدل التراكمي = مجموع نقاط جميع المقررات التي درسها الطالب منذ التحاقه ÷ مجموع وحداتها."),
        Rule(id="warning_below_grad_gpa", value=True, status="verified", source=STUDY_RULES_DOC, article="المادتان الحادية والأربعون والثانية والأربعون",
             text_ar="انخفاض المعدل التراكمي عن معدل التخرج المحدد للتخصص إنذار أكاديمي؛ ثلاثة إنذارات متتالية تؤدي للفصل مع إمكان فرص إضافية."),
        Rule(id="summer_no_warning", value=True, status="verified", source=STUDY_RULES_DOC,
             text_ar="لا يُحتسب الفصل الصيفي ضمن الفصول التي تُمنح فيها الإنذارات الأكاديمية."),
        Rule(id="grad_gpa_floor", value=1.00, status="verified", source=STUDY_RULES_DOC, article="مادة التخرج",
             text_ar="لا يقل معدل التخرج في كل الأحوال عن تقدير «مقبول»؛ ويحدد مجلس الجامعة معدل كل تخصص."),
        Rule(id="retake_to_raise_gpa", value=0.20, status="verified", source=STUDY_RULES_DOC,
             text_ar="من أنهى ساعات خطته ومعدله دون معدل التخرج يعيد مقررات بحد أقصى 20% من ساعات الخطة، ويُرصد التقدير الأعلى."),
        Rule(id="honors_first", value=3.75, status="verified", source=STUDY_RULES_DOC,
             text_ar="مرتبة الشرف الأولى من 3.75 إلى 4.00، والثانية من 3.25 إلى أقل من 3.75، بشروط المدة والساعات."),
        Rule(id="max_regular_load", value=None, status="unavailable", source=STUDY_RULES_DOC,
             text_ar="لم تحدد القواعد المتاحة حداً أعلى للعبء في الفصل العادي؛ يحدده مجلس الجامعة/النظام. يُستخدم الحد الذي يختاره الطالب."),
        Rule(id="program_grad_gpa", value=None, status="unavailable", source=STUDY_RULES_DOC,
             text_ar="معدل التخرج الخاص بكل تخصص يحدده مجلس الجامعة ولم يُنشر في المصادر المتاحة؛ أدخله من دليل قسمك إن عرفته."),
        Rule(id="offerings", value=None, status="unavailable", source="—",
             text_ar="المقررات المطروحة لكل فصل لا تُنشر علناً؛ تظهر في نظام التسجيل فقط."),
    ]
}

#: Planning defaults used only when the student has not chosen; always reported as assumptions.
DEFAULT_MAX_REGULAR_LOAD = 18
ABSOLUTE_MAX_REGULAR_LOAD = 21  # guard-rail for user input, not a regulation


def rule(rule_id: str) -> Rule:
    return RULES[rule_id]


def cite(rule_id: str) -> dict:
    r = RULES[rule_id]
    return {"rule": r.id, "text": r.text_ar, "status": r.status, "source": r.source, "article": r.article}
