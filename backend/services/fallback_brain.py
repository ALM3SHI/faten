import re
import random
from datetime import datetime

def get_fallback_response(text: str, profile: dict = None) -> dict | None:
    """
    Python implementation of the legacy JS Regex Brain.
    Provides immediate, hardcoded responses for common intents.
    """
    text = normalize_text(text)
    
    # 1. Greetings
    if re.search(r"(سلام|هلا|مرحبا|اهلا|أهلا|هاي|كيف حالك|شخبارك|علومك|كيفك|مساء|صباح)", text, re.I):
        greet = get_greeting_by_time()
        student_name = profile.get("basic", {}).get("name") if profile else None
        base = f"{greet} {student_name}! 🌹" if student_name else f"{greet} يا هلا! 🌹"
        return {
            "message": random.choice([
                f"{base} أنا بخير وأفضل حال، كيف أقدر أساعدك اليوم في دراستك؟",
                f"{base} جاهز نرتب دراستك وجدولك. وش ودك نسوي؟",
                "وعليكم السلام! نورت المساعد الأكاديمي 👋 أنا تحت خدمتك."
            ]),
            "actions": []
        }

    # 2. Thanks
    if re.search(r"(شكرا|تسلم|يعطيك العافيه|يعطيك العافية|ما قصرت|ثانك)", text, re.I):
        return {
            "message": random.choice([
                "على الرحب والسعة! هذا واجبي 🫡",
                "الله يعافيك! إذا عندك أي سؤال ثاني أنا حاضر.",
                "بالخدمة دائماً، وموفّق في دراستك 🤍"
            ]),
            "actions": []
        }

    # ── All academic intents (GPA / plan / locations / identity) now go to the
    # full AI agent so the model can reason over the student's actual context.
    # The hardcoded canned answers were intercepting genuine questions and
    # breaking the smart-assistant experience.
    return None

def normalize_text(text: str) -> str:
    if not text: return ""
    t = text
    t = re.sub(r"[\u0617-\u061A\u064B-\u0652]", "", t) # tashkeel
    t = re.sub(r"[^\w\u0600-\u06FF\s:،]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"[إأآا]", "ا", t)
    t = re.sub(r"ة", "ه", t)
    t = re.sub(r"ى", "ي", t)
    return t.lower()

def get_greeting_by_time() -> str:
    hour = datetime.now().hour
    if hour < 11: return "صباح الخير"
    if hour < 17: return "مساء الخير"
    return "مساء النور"
