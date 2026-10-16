import re
import json
import logging
from openai import AsyncOpenAI
from config import get_settings

logger = logging.getLogger(__name__)


def is_short_or_ambiguous(text: str) -> bool:
    """Return True when the message is too short or vague for standalone
    heuristic classification.  This gates the context-aware LLM classifier
    so it is only invoked for probable follow-up replies."""
    cleaned = text.strip()
    words = cleaned.split()
    # Very short messages (1-4 words) are almost always follow-ups
    if len(words) <= 4:
        return True
    # A bare course code like "CS3402"
    if len(words) == 1 and re.match(r'^[a-zA-Z]{2,4}\d{3,4}$', cleaned):
        return True
    return False


INTENT_MAP = {
    "GREETING": {
        "required_blocks": [],
        "needs_tools": False,
        "direct_response": "أهلاً بك! معك فطن، مرشدك الأكاديمي. كيف يمكنني مساعدتك اليوم؟"
    },
    "ACADEMIC_CALENDAR": {
        "required_blocks": [],
        "needs_tools": True,
        "direct_response": None
    },
    "REGULATIONS": {
        "required_blocks": ["profile_basic", "gpa_summary"],
        "needs_tools": True,
        "direct_response": None
    },
    "UNIVERSITY_NEWS": {
        "required_blocks": [],
        "needs_tools": True,
        "direct_response": None
    },
    "GENERAL_QA": {
        "required_blocks": [],
        "needs_tools": False,
        "direct_response": None
    },
    "PROFILE_QUERY": {
        "required_blocks": ["profile_basic"],
        "needs_tools": False,
        "direct_response": None
    },
    "GPA_QUERY": {
        "required_blocks": ["profile_basic", "gpa_summary"],
        "needs_tools": True,
        "direct_response": None
    },
    "GPA_IMPROVEMENT": {
        "required_blocks": ["profile_basic", "gpa_summary", "current_courses", "recent_grades"],
        "needs_tools": True,
        "direct_response": None
    },
    "SCHEDULE_TASK": {
        "required_blocks": ["profile_basic", "current_courses", "schedule", "active_plan", "exams"],
        "needs_tools": True,
        "direct_response": None
    },
    "PLAN_OR_STUDY_ADVICE": {
        "required_blocks": ["profile_basic", "gpa_summary", "current_courses", "schedule", "active_plan", "exams"],
        "needs_tools": True,
        "direct_response": None
    },
    "FULL_ACADEMIC_ANALYSIS": {
        "required_blocks": ["profile_basic", "gpa_summary", "current_courses", "schedule", "active_plan", "exams", "full_transcript"],
        "needs_tools": True,
        "direct_response": None
    },
    "SEMESTER_QUERY": {
        "required_blocks": ["profile_basic", "gpa_summary", "full_transcript"],
        "needs_tools": True,
        "direct_response": None
    },
    "MY_EXAMS": {
        "required_blocks": ["profile_basic", "current_courses", "exams"],
        "needs_tools": True,
        "direct_response": None
    },
    "COURSE_INFO": {
        "required_blocks": ["profile_basic", "current_courses"],
        "needs_tools": True,
        "direct_response": None
    },
    "NAVIGATION": {
        "required_blocks": [],
        "needs_tools": False,
        "direct_response": True
    },
}

def classify_intent_heuristic(messages: list) -> dict:
    if not messages:
        return {"intent": "UNKNOWN", "source": "heuristic"}

    # Extract last user message
    last_user_msg = next((m for m in reversed(messages) if getattr(m, 'role', m.get('role', '') if isinstance(m, dict) else '') == 'user'), None)
    if not last_user_msg:
        return {"intent": "UNKNOWN", "source": "heuristic"}
        
    msg = (last_user_msg.content if hasattr(last_user_msg, 'content') else last_user_msg.get('content', '')).strip().lower()
    msg_cleaned = re.sub(r'[^\w\s]', '', msg)
    
    # Continuation Rule
    last_assistant_msg = next((m for m in reversed(messages) if getattr(m, 'role', m.get('role', '') if isinstance(m, dict) else '') == 'assistant'), None)
    if last_assistant_msg:
        ast_content = (last_assistant_msg.content if hasattr(last_assistant_msg, 'content') else last_assistant_msg.get('content', '')).lower()
        
        # SCHEDULE_TASK continuation tightening
        schedule_task_prompts = [
            "أضف جلسة", "جلسة مذاكرة", "مهمة مذاكرة", "كم مدة الجلسة", 
            "ما وقت الجلسة", "حدد وقت", "حدد مدة", "اختر المادة للجلسة", 
            "أي مادة للجلسة", "كم المدة"
        ]
        if any(p in ast_content for p in schedule_task_prompts) and len(msg.split()) <= 6:
            return {"intent": "SCHEDULE_TASK", "source": "heuristic_continuation"}
            
        # NAVIGATION context_confirmation
        nav_clarify_phrases = [
            "هل تقصد صفحة", "هل تريد فتح صفحة", "هل تريد الذهاب إلى",
            "هل تقصد الانتقال إلى", "فتح صفحة"
        ]
        nav_affirmative = [
            "ايوه", "إيوه", "أيوه", "نعم", "اي", "تمام", "صحيح", "يب", "yes", "ok"
        ]
        
        if any(p in ast_content for p in nav_clarify_phrases) and msg_cleaned in nav_affirmative:
            nav_targets = {
                "/pomodoro": ["بومودورو", "pomodoro"],
                "/plan": ["الخطة", "plan"],
                "/gpa": ["المعدل", "gpa", "حاسبة المعدل"],
                "/locations": ["القاعات", "الخريطة", "map"],
                "/chat": ["الدردشة", "الشات", "chat"],
                "/dashboard": ["اللوحة", "الداشبورد", "dashboard"],
                "/profile": ["الملف الشخصي", "البروفايل", "profile"]
            }
            matched_route = None
            matched_label = None
            for route, keywords in nav_targets.items():
                if any(kw in ast_content for kw in keywords):
                    matched_route = route
                    matched_label = keywords[0]
                    break
            
            if matched_route:
                return {
                    "intent": "NAVIGATION",
                    "source": "context_confirmation",
                    "route": matched_route,
                    "label": matched_label,
                    "required_blocks": [],
                    "needs_tools": False,
                    "direct_response": True
                }
    
    greeting_exact_matches = {
        "سلام", "السلام", "السلام عليكم", "عليكم السلام", 
        "مرحبا", "هلا", "اهلين", "أهلين", "أهلا", "اهلا", 
        "هاي", "هلو", "صباح الخير", "مساء الخير", 
        "كيفك", "كيف الحال", "وش اخبارك", "عامل ايه"
    }
    
    if msg_cleaned in greeting_exact_matches:
        return {"intent": "GREETING", "source": "heuristic"}

    nav_verbs = [
        "افتح", "فتح", "خذني", "وديني", "روح", "انتقل", 
        "شغل", "ابدأ", "وريني", "اعرض", "show", "open", "go to"
    ]
    has_nav_verb = any(v in msg_cleaned for v in nav_verbs)
    if has_nav_verb:
        # The four spaces first, so «افتح معدّلي» doesn't fall through to a
        # generic keyword of a detail page.
        nav_targets = {
            "/time": ["وقتي", "أجندتي", "اجندتي"],
            "/record": ["معدّلي", "معدلي", "وضعي الأكاديمي"],
            "/study": ["ذاكر محاضرة", "المذاكرة الذكية", "ملفات المذاكرة"],
            "/plan": ["الخطة", "خطة", "جدول المذاكرة", "جلسات المراجعة", "plan"],
            "/gpa": ["المعدل", "حساب المعدل", "gpa"],
            "/chat": ["الدردشة", "الشات", "المحادثة", "فطن", "chat"],
            "/pomodoro": ["بومودورو", "المؤقت", "جلسة تركيز", "pomodoro"],
            "/locations": ["القاعات", "الخريطة", "الماب", "map"],
            "/dashboard": ["اللوحة", "الرئيسية", "الداشبورد", "dashboard"],
            "/profile": ["الملف الشخصي", "البروفايل", "profile"]
        }
        matched_route = None
        matched_label = None
        for route, keywords in nav_targets.items():
            if any(kw in msg_cleaned for kw in keywords):
                matched_route = route
                matched_label = keywords[0]  # first arabic term as label
                break
        
        if matched_route:
            return {
                "intent": "NAVIGATION",
                "source": "heuristic",
                "route": matched_route,
                "label": matched_label,
                "required_blocks": [],
                "needs_tools": False,
                "direct": True
            }
        else:
            return {
                "intent": "NAVIGATION",
                "source": "heuristic_ambiguous",
                "required_blocks": [],
                "needs_tools": False,
                "direct": False
            }


    general_qa_patterns = [
        r'من أنت', r'ما هو فطن', r'وش تقدر تسوي', r'ما هي جامعة أم القرى',
        r'ما هو المعدل', r'ايش هو فطن', r'ايش وظيفتك'
    ]
    if any(re.search(p, msg) for p in general_qa_patterns):
        return {"intent": "GENERAL_QA", "source": "heuristic"}

    profile_patterns = [
        r'وش اسمي', r'وش تخصصي', r'ايش بياناتي', r'رقمي الجامعي', r'تخصصي'
    ]
    if any(re.search(p, msg) for p in profile_patterns) and not any(w in msg for w in ['معدل', 'درجات', 'خطة', 'جلسة']):
        return {"intent": "PROFILE_QUERY", "source": "heuristic"}

    full_analysis_patterns = [
        r'حلل سجلي', r'سجلي الأكاديمي كامل', r'تحليل شامل', r'نقاط ضعفي من كل', 
        r'مساري الدراسي', r'حلل أدائي كامل', r'قارن أدائي', r'موادي السابقة كلها',
        r'أضعف موادي من أول'
    ]
    if any(re.search(p, msg) for p in full_analysis_patterns):
        return {"intent": "FULL_ACADEMIC_ANALYSIS", "source": "heuristic"}

    # The student's OWN exam timetable ("متى اختباري الجاي؟", "كم باقي على
    # الفاينل؟", "عندي تعارض؟"). Adding an exam stays SCHEDULE_TASK.
    my_exams_patterns = [
        r'اختباري', r'اختباراتي', r'امتحاني', r'امتحاناتي',
        r'(اختبار|امتحان)\s*(ال)?(جاي|قادم|الياي|الجاي|القادم)',
        r'جدول\s*(ال)?(اختبارات|امتحانات)(ي)?', r'كم\s*باقي\s*(على|ل)\s*(ال)?(اختبار|امتحان|فاينل|ميد)',
        r'تعارض.*(اختبار|امتحان)', r'(اختبار|امتحان).*تعارض',
    ]
    add_exam_words = [r'أضف', r'اضف', r'سجل', r'سجّل', r'عندي اختبار']
    if any(re.search(p, msg) for p in my_exams_patterns) and not any(re.search(p, msg) for p in add_exam_words):
        return {"intent": "MY_EXAMS", "source": "heuristic"}

    schedule_patterns = [
        r'أضف مهمة', r'جلسة مذاكرة', r'حط لي مهمة', r'سجل جلسة', r'تعارض',
        r'أضف اختبار', r'بومودورو', r'متى محاضرتي', r'عندي اختبار', r'في الخطة',
        r'اضف مهمة', r'اضف جلسة', r'أضف جلسة'
    ]
    if any(re.search(p, msg) for p in schedule_patterns):
        return {"intent": "SCHEDULE_TASK", "source": "heuristic"}

    gpa_improvement_patterns = [
        r'كيف أرفع معدلي', r'عشان أوصل', r'أوصل \d', r'المواد اللي أركز', 
        r'كيف أحسن', r'رفع المعدل', r'أبي معدلي', r'عشان أجيب'
    ]
    if any(re.search(p, msg) for p in gpa_improvement_patterns):
        return {"intent": "GPA_IMPROVEMENT", "source": "heuristic"}

    semester_query_patterns = [
        r'الترم الماضي', r'الفصل الماضي', r'الفصل السابق', r'الترم السابق',
        r'الفصل الأول', r'الفصل الثاني', r'الترم الأول', r'الترم الثاني',
        r'مواد الترم', r'موادي الفصل', r'معدلي الفصل', r'معدل الفصل',
        r'1445', r'1446', r'1447', r'last semester', r'previous semester'
    ]
    if any(re.search(p, msg) for p in semester_query_patterns):
        return {"intent": "SEMESTER_QUERY", "source": "heuristic"}

    gpa_query_patterns = [
        r'كم معدلي', r'وش معدلي', r'احسب معدلي', r'الساعات المجتازة', r'معدلي الحالي'
    ]
    if any(re.search(p, msg) for p in gpa_query_patterns):
        return {"intent": "GPA_QUERY", "source": "heuristic"}

    plan_patterns = [
        r'نظم مذاكرتي', r'سو لي جدول', r'جدول مذاكرة', r'كيف أوزع وقتي', 
        r'رتب لي مهامي', r'وش أذاكر', r'نصيحة', r'كيف أذاكر'
    ]
    if any(re.search(p, msg) for p in plan_patterns):
        return {"intent": "PLAN_OR_STUDY_ADVICE", "source": "heuristic"}

    if any(w in msg for w in ['معدل', 'تراكمي', 'نقاط']):
        return {"intent": "GPA_IMPROVEMENT", "source": "heuristic"}
        
    if any(w in msg for w in ['سجل', 'مستوى', 'تقييم', 'نقاط ضعف']):
        return {"intent": "FULL_ACADEMIC_ANALYSIS", "source": "heuristic"}

    course_code_regex = r'[a-zA-Z]{2,4}\s*\d{3,4}'
    has_course_code = bool(re.search(course_code_regex, msg))

    news_patterns = [
        r'(آخر|اخر|أحدث|احدث|جديد)\s*(ال)?(أخبار|اخبار|إعلانات|اعلانات|مستجدات)',
        r'(أخبار|اخبار|إعلانات|اعلانات|مستجدات)\s*(ال)?(جامعة|جامعه|الجامعة|الجامعه)',
        r'(وش|ايش|إيش|ماهي|ما هي)\s*(ال)?(أخبار|اخبار)',
    ]
    if any(re.search(p, msg) for p in news_patterns):
        return {"intent": "UNIVERSITY_NEWS", "source": "heuristic"}

    academic_calendar_patterns = [
        r'التقويم الجامعي', r'إجازة', r'إجازات', r'بداية الفصل', r'نهاية العام',
        r'الاختبارات النهائية', r'اختبارات المتطلبات العامة', r'المتطلبات العامة والعملية',
        r'إجازة الخريف', r'اليوم الوطني', r'الاعتذار عن الدراسة', r'1447', r'1448',
        r'موعد الاختبارات', r'مواعيد الاختبارات', r'الاختبارات العامة', r'الاختبارات العامه',
        r'اختبارات عامة', r'اختبارات عامه', r'اختبارات المتطلبات', r'المتطلبات العامة',
        r'المتطلبات العامه', r'المتطلبات العامه والعمليه', r'الاختبارات العملية',
        r'الاختبارات العمليه', r'متى الاختبارات', r'متى موعد الاختبار',
        r'متى موعد الاختبارات', r'موعد الاختبار'
    ]
    regulations_patterns = [
        r'لائح', r'نظام الجامع', r'حرمان', r'محروم', r'نسبة الغياب', r'كم اغيب', r'كم أغيب',
        r'الغياب', r'انذار', r'إنذار', r'طي القيد', r'طي قيد', r'فصل من الجامع', r'يفصلون',
        r'انسحاب', r'انسحب', r'تأجيل', r'تاجيل', r'أجل الفصل', r'اجل الفصل', r'معادل',
        r'تحويل', r'مرتبة الشرف', r'تظلم', r'اعتراض على', r'اختبار بديل', r'غير مكتمل',
        r'عبء', r'العبء', r'الحد الأدنى', r'الحد الادنى', r'الحد الأعلى', r'الحد الاعلى',
        r'إعادة قيد', r'اعادة قيد', r'المدة القصوى', r'شروط التخرج',
        r'غش', r'عقوب', r'مخالف', r'انضباط', r'حقوق', r'نادي', r'الأندية', r'الاندية',
        r'صندوق الطلاب', r'صندوق الطلبة', r'قرض', r'إعانة', r'اعانة',
        r'ماجستير', r'دكتوراه', r'الدراسات العليا', r'التدريب التعاوني', r'تعاوني',
        r'ملكية فكرية', r'الملكية الفكرية', r'براءة اختراع', r'تحرش', r'ابتعاث',
        r'نظام الجامعات', r'الكلية التطبيقية', r'زمالة', r'الزمالات',
    ]
    if any(re.search(p, msg) for p in regulations_patterns) and not has_course_code:
        return {"intent": "REGULATIONS", "source": "heuristic"}

    if any(re.search(p, msg) for p in academic_calendar_patterns) and not has_course_code:
        return {"intent": "ACADEMIC_CALENDAR", "source": "heuristic"}

    course_info_patterns = [
        r'مادة', r'اختبار', r'ميد', r'فاينل', r'درجات', r'توزيع', r'موعد'
    ]
    if any(re.search(p, msg) for p in course_info_patterns) or has_course_code:
        return {"intent": "COURSE_INFO", "source": "heuristic"}

    return {"intent": "UNKNOWN", "source": "heuristic"}


async def classify_intent_llm(message: str, openai_client: AsyncOpenAI) -> dict:
    system_prompt = """You are an intent classifier for a university academic assistant.
Classify the user's message into EXACTLY ONE of the following intents:

- GREETING: Simple greetings or hellos. DO NOT classify ambiguous, random, or out-of-scope messages as GREETING.
- UNIVERSITY_NEWS: Asking for the latest Umm Al-Qura University news, announcements or updates (e.g. "وش آخر أخبار الجامعة").
- GENERAL_QA: General questions about the assistant, its capabilities, or the university. If the message is out of the academic scope (e.g., politics, religion, medicine, random chat, unclear messages), classify it as GENERAL_QA.
- PROFILE_QUERY: Asking about their own name, major, or basic profile data.
- REGULATIONS: Questions about official university rules: absence limits and exam deprivation (حرمان), withdrawal, postponement, academic warnings and dismissal, re-enrollment, transfer and course equivalency, make-up exams, grade appeals, honors, graduation requirements, course load limits.
- GPA_QUERY: Asking for their current GPA or earned hours.
- GPA_IMPROVEMENT: Asking how to improve their GPA, what grades they need, or which subjects to focus on.
- SCHEDULE_TASK: Asking to add a study task, schedule a session, start a pomodoro, or check for schedule conflicts.
- PLAN_OR_STUDY_ADVICE: Asking for general study advice, time management, or organizing their study plan.
- SEMESTER_QUERY: Asking about courses, grades, or GPA for a specific past or previous semester (e.g., last semester, Term 1 1445).
- FULL_ACADEMIC_ANALYSIS: Asking for a deep, comprehensive analysis of their entire academic record, all past courses, and broad strengths/weaknesses.
- ACADEMIC_CALENDAR: questions about the general Umm Al-Qura University academic calendar, university holidays, semester starts, final exam periods, midterm periods, withdrawal periods, national day holiday, or academic year 1447/1448 dates. Includes informal Arabic phrasing such as "الاختبارات العامه", "موعد الاختبارات", "متى الاختبارات", and "اختبارات المتطلبات".
- MY_EXAMS: Asking about THEIR OWN exam timetable: when is my next exam, how many days until my final, which exams I have this week, exam conflicts (e.g. "متى اختباري الجاي؟", "كم باقي على اختباراتي").
- COURSE_INFO: Asking for course details, syllabus, project, midterm, final, exam dates, or grading policy of a specific course (e.g. by course code or name).

Return ONLY a JSON object with a single key "intent".
Example: {"intent": "GREETING"}
"""
    try:
        response = await openai_client.chat.completions.create(
            model=get_settings().llm_fast_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            temperature=0.1,
            max_tokens=20,
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content or "{}"
        data = json.loads(content)
        intent = data.get("intent", "UNKNOWN")
        if intent not in INTENT_MAP:
            intent = "UNKNOWN"
        return {"intent": intent, "source": "llm_fast"}
    except Exception as e:
        logger.warning(f"[intent] LLM classification failed: {e}")
        return {"intent": "UNKNOWN", "source": "llm_fast"}


# ---------------------------------------------------------------------------
# Context-aware classifier for short / ambiguous follow-up replies
# ---------------------------------------------------------------------------

CONTEXT_CLASSIFIER_PROMPT = """You are a short-message intent classifier for an Arabic university assistant chatbot.
You receive the last few messages of a conversation plus a short user reply.
Your job is to determine what the user meant based ONLY on the conversation context.

Allowed intents:
SCHEDULE_TASK, NAVIGATION, COURSE_INFO, MY_EXAMS, ACADEMIC_CALENDAR, REGULATIONS, UNIVERSITY_NEWS, GPA_QUERY,
SEMESTER_QUERY, FULL_ACADEMIC_ANALYSIS, GENERAL_QA, UNKNOWN

Rules:
- If the assistant previously asked for a missing field for a study session or task
  (course name, time, date, or duration) and the user provides it → SCHEDULE_TASK
- If the assistant asked to confirm a page and the user confirms → NAVIGATION
  (include "route" if determinable: /pomodoro, /plan, /gpa, /locations, /chat, /dashboard, /profile)
- If the assistant asked which course/material and the user names one → COURSE_INFO
  UNLESS the assistant message clearly mentioned a study task or session → then SCHEDULE_TASK
- If the assistant asked whether the user means GPA or full academic record
  and the user answers with the full record → FULL_ACADEMIC_ANALYSIS
- If the assistant asked whether the user means GPA or full academic record
  and the user answers with GPA → GPA_QUERY
- If the context is unclear or insufficient → UNKNOWN

Return ONLY valid JSON:
{"intent": "...", "is_continuation": true or false, "route": "/path or null", "reason": "short reason"}
"""


async def classify_with_context_llm(
    messages: list, openai_client: AsyncOpenAI
) -> dict:
    """Classify a short/ambiguous user reply using the last few conversation
    messages as context.  Sends NO student profile, transcript, schedule,
    plan, exams, Firestore data, or full system prompt — only visible
    chat messages and a tiny classifier prompt."""
    try:
        # Extract the last 4 visible messages (user + assistant only)
        recent: list[dict] = []
        for m in messages:
            if isinstance(m, dict):
                role = m.get('role', '')
                content = m.get('content', '')
            else:
                role = getattr(m, 'role', '')
                content = getattr(m, 'content', '')
            if role in ('user', 'assistant') and content:
                recent.append({"role": role, "content": content})
        # Keep only the last 4
        recent = recent[-4:]

        if not recent:
            return {"intent": "UNKNOWN", "source": "context_classifier"}

        api_messages = [
            {"role": "system", "content": CONTEXT_CLASSIFIER_PROMPT},
            *recent,
        ]

        response = await openai_client.chat.completions.create(
            model=get_settings().llm_fast_model,
            messages=api_messages,
            temperature=0.0,
            max_tokens=80,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        intent = data.get("intent", "UNKNOWN")
        if intent not in INTENT_MAP:
            intent = "UNKNOWN"

        logger.info(
            "[intent] context_classifier result — intent=%s is_continuation=%s route=%s reason=%s",
            intent,
            data.get("is_continuation"),
            data.get("route"),
            data.get("reason", "")[:80],
        )

        return {
            "intent": intent,
            "source": "context_classifier",
            "is_continuation": data.get("is_continuation", False),
            "route": data.get("route"),
            "reason": data.get("reason"),
        }
    except Exception as e:
        logger.warning("[intent] context classifier failed: %s", e)
        return {"intent": "UNKNOWN", "source": "context_classifier"}


async def classify_intent(messages: list, openai_client: AsyncOpenAI) -> dict:
    # 1. Try heuristic (fast, deterministic, 0 tokens)
    result = classify_intent_heuristic(messages)

    # Extract last user text for downstream classifiers
    last_user_msg = next(
        (m for m in reversed(messages)
         if (getattr(m, 'role', m.get('role', '') if isinstance(m, dict) else '') == 'user')),
        None,
    )
    message_text = (
        (last_user_msg.content if hasattr(last_user_msg, 'content')
         else last_user_msg.get('content', ''))
        if last_user_msg else ""
    )

    # 2. Context-aware classifier for short/ambiguous follow-ups
    #    Only invoked when:
    #    a) heuristics returned UNKNOWN
    #    b) the user message is short/ambiguous
    #    c) there is at least one assistant message providing context
    if result["intent"] == "UNKNOWN" and message_text and is_short_or_ambiguous(message_text):
        has_assistant = any(
            (m.get('role') if isinstance(m, dict) else getattr(m, 'role', '')) == 'assistant'
            for m in messages
        )
        if has_assistant:
            logger.info(
                "[intent] heuristic=UNKNOWN, message is short/ambiguous (%r) — trying context classifier",
                message_text[:60],
            )
            result = await classify_with_context_llm(messages, openai_client)

    # 3. Standalone LLM fallback (no conversation context, just the message)
    if result["intent"] == "UNKNOWN" and message_text:
        result = await classify_intent_llm(message_text, openai_client)

    # 4. Safe hard fallback if everything failed
    if result["intent"] == "UNKNOWN":
        if len(message_text.split()) <= 4 and not any(
            w in message_text for w in ['معدل', 'خطة', 'جدول', 'سجل', 'مادة']
        ):
            result["intent"] = "GENERAL_QA"
            result["source"] = "fallback"
        else:
            result["intent"] = "PLAN_OR_STUDY_ADVICE"
            result["source"] = "fallback"

    # 5. Map intent to required blocks and tools
    intent = result["intent"]
    mapped = INTENT_MAP[intent]

    return {
        "intent": intent,
        "source": result["source"],
        "required_blocks": mapped["required_blocks"],
        "needs_tools": mapped["needs_tools"],
        "direct_response": mapped["direct_response"],
        "route": result.get("route"),
        "label": result.get("label"),
        "is_continuation": result.get("is_continuation", False),
    }
