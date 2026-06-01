import re
import json
import logging
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

INTENT_MAP = {
    "GREETING": {
        "required_blocks": [],
        "needs_tools": False,
        "direct_response": "أهلاً بك! معك فطن، مرشدك الأكاديمي. كيف يمكنني مساعدتك اليوم؟"
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
                "/map": ["القاعات", "الخريطة", "map"],
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
        nav_targets = {
            "/plan": ["الخطة", "خطة", "جدول المذاكرة", "جلسات المراجعة", "plan"],
            "/gpa": ["المعدل", "حساب المعدل", "gpa"],
            "/chat": ["الدردشة", "الشات", "المحادثة", "فطن", "chat"],
            "/pomodoro": ["بومودورو", "المؤقت", "جلسة تركيز", "pomodoro"],
            "/map": ["القاعات", "الخريطة", "الماب", "map"],
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

    schedule_patterns = [
        r'أضف مهمة', r'جلسة مذاكرة', r'حط لي مهمة', r'سجل جلسة', r'تعارض',
        r'أضف اختبار', r'بومودورو', r'متى محاضرتي', r'عندي اختبار', r'في الخطة',
        r'اضف مهمة', r'اضف جلسة'
    ]
    if any(re.search(p, msg) for p in schedule_patterns):
        return {"intent": "SCHEDULE_TASK", "source": "heuristic"}

    gpa_improvement_patterns = [
        r'كيف أرفع معدلي', r'عشان أوصل', r'أوصل \d', r'المواد اللي أركز', 
        r'كيف أحسن', r'رفع المعدل', r'أبي معدلي', r'عشان أجيب'
    ]
    if any(re.search(p, msg) for p in gpa_improvement_patterns):
        return {"intent": "GPA_IMPROVEMENT", "source": "heuristic"}

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

    course_info_patterns = [
        r'مادة', r'اختبار', r'ميد', r'فاينل', r'درجات', r'توزيع', r'موعد'
    ]
    course_code_regex = r'[a-zA-Z]{2,4}\s*\d{3,4}'
    if any(re.search(p, msg) for p in course_info_patterns) or re.search(course_code_regex, msg):
        return {"intent": "COURSE_INFO", "source": "heuristic"}

    return {"intent": "UNKNOWN", "source": "heuristic"}


async def classify_intent_llm(message: str, openai_client: AsyncOpenAI) -> dict:
    system_prompt = """You are an intent classifier for a university academic assistant.
Classify the user's message into EXACTLY ONE of the following intents:

- GREETING: Simple greetings or hellos. DO NOT classify ambiguous, random, or out-of-scope messages as GREETING.
- GENERAL_QA: General questions about the assistant, its capabilities, or the university. If the message is out of the academic scope (e.g., politics, religion, medicine, random chat, unclear messages), classify it as GENERAL_QA.
- PROFILE_QUERY: Asking about their own name, major, or basic profile data.
- GPA_QUERY: Asking for their current GPA or earned hours.
- GPA_IMPROVEMENT: Asking how to improve their GPA, what grades they need, or which subjects to focus on.
- SCHEDULE_TASK: Asking to add a study task, schedule a session, start a pomodoro, or check for schedule conflicts.
- PLAN_OR_STUDY_ADVICE: Asking for general study advice, time management, or organizing their study plan.
- FULL_ACADEMIC_ANALYSIS: Asking for a deep, comprehensive analysis of their entire academic record, all past courses, and broad strengths/weaknesses.
- COURSE_INFO: Asking for course details, syllabus, project, midterm, final, exam dates, or grading policy of a specific course (e.g. by course code or name).

Return ONLY a JSON object with a single key "intent".
Example: {"intent": "GREETING"}
"""
    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
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
        return {"intent": intent, "source": "gpt-4o-mini"}
    except Exception as e:
        logger.warning(f"[intent] LLM classification failed: {e}")
        return {"intent": "UNKNOWN", "source": "gpt-4o-mini"}


async def classify_intent(messages: list, openai_client: AsyncOpenAI) -> dict:
    # 1. Try heuristic
    result = classify_intent_heuristic(messages)
    
    # Extract last user text for LLM
    last_user_msg = next((m for m in reversed(messages) if getattr(m, 'role', m.get('role', '') if isinstance(m, dict) else '') == 'user'), None)
    message_text = (last_user_msg.content if hasattr(last_user_msg, 'content') else last_user_msg.get('content', '')) if last_user_msg else ""
    
    # 2. If unknown, use LLM
    if result["intent"] == "UNKNOWN" and message_text:
        result = await classify_intent_llm(message_text, openai_client)
        
    # 3. Safe fallback if LLM also fails
    if result["intent"] == "UNKNOWN":
        if len(message_text.split()) <= 4 and not any(w in message_text for w in ['معدل', 'خطة', 'جدول', 'سجل', 'مادة']):
            result["intent"] = "GENERAL_QA"
            result["source"] = "fallback"
        else:
            result["intent"] = "PLAN_OR_STUDY_ADVICE"
            result["source"] = "fallback"

    # 4. Map intent to required blocks and tools
    intent = result["intent"]
    mapped = INTENT_MAP[intent]
    
    return {
        "intent": intent,
        "source": result["source"],
        "required_blocks": mapped["required_blocks"],
        "needs_tools": mapped["needs_tools"],
        "direct_response": mapped["direct_response"],
        "route": result.get("route"),
        "label": result.get("label")
    }
