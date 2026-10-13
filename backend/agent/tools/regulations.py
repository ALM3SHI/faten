"""Regulations & university knowledge: calendar, courses, reviews, regulations search, news."""

import logging
from datetime import datetime


from agent.tools.context import ToolContext
from agent.tools._common import (
    to_int,
)

logger = logging.getLogger(__name__)


async def _get_calendar_info(ctx: ToolContext, args: dict) -> dict:
    """19. Get Calendar Info (Server-Side Execution)"""
    import re

    query_type = args.get("query_type")
    query = str(args.get("query", "")).lower().strip()
    event_type = args.get("event_type")

    # Academic calendar lives in data/uqu_calendar.py (shared with tools_schema).
    from data.uqu_calendar import UQU_CALENDAR

    results = []
    message = ""

    try:
        if query_type == "search":
            if not query:
                return {"success": False, "message": "يجب تحديد كلمة البحث"}

            def _norm_cal(s: str) -> str:
                if not s: return ""
                s = str(s).lower()
                s = re.sub(r"[\u064B-\u065F\u0640]", "", s)
                s = re.sub(r"[أإآ]", "ا", s)
                s = s.replace("ة", "ه").replace("ى", "ي")
                return s.strip()

            nq = _norm_cal(query)
            nq_target = nq
            if any(x in nq for x in ["الاختبارات العامه", "اختبارات عامه", "المتطلبات العامه", "اختبارات المتطلبات"]):
                nq_target = _norm_cal("اختبارات المتطلبات العامة والعملية")
            elif any(x in nq for x in ["الاختبارات النهائيه", "اختبارات نهائيه"]):
                nq_target = _norm_cal("الاختبارات النهائية")
            elif "نهايه العام" in nq and "اجازه" in nq:
                nq_target = _norm_cal("إجازة نهاية العام الدراسي")
            elif "اجازه الخريف" in nq:
                nq_target = _norm_cal("إجازة الخريف")
            elif "بدايه الفصل" in nq:
                nq_target = _norm_cal("بداية الفصل الدراسي")
            elif "الاعتذار" in nq:
                nq_target = _norm_cal("الاعتذار عن الدراسة")

            today = datetime.now().date()
            def parse_start_date(date_str):
                try:
                    year_match = re.search(r'\d{4}', date_str)
                    year = year_match.group(0) if year_match else str(today.year)
                    dm_match = re.search(r'\d{1,2}\s+[A-Za-z]+', date_str)
                    if dm_match:
                        first_date = dm_match.group(0)
                        full_match = re.search(first_date + r'\s+\d{4}', date_str)
                        full_date_str = full_match.group(0) if full_match else f"{first_date} {year}"
                        return datetime.strptime(full_date_str, "%d %b %Y").date()
                except Exception:
                    pass
                return None

            matched_events = []
            for term in UQU_CALENDAR:
                for event in term.get("events", []):
                    e_title = _norm_cal(event.get("title", ""))
                    e_type = _norm_cal(event.get("type", ""))
                    e_date = _norm_cal(event.get("date", ""))
                    e_hijri = _norm_cal(event.get("hijri", ""))

                    if (nq_target in e_title or nq_target in e_type or nq in e_title or nq in e_type or nq in e_date or nq in e_hijri):
                        event_date = parse_start_date(event.get("date", ""))
                        matched_events.append((event, event_date, term.get("term", "")))

            upcoming_results = []
            past_results = []
            for ev, ev_date, term_name in matched_events:
                ev_copy = dict(ev)
                ev_copy["term_name"] = term_name
                if ev_date and ev_date >= today:
                    upcoming_results.append(ev_copy)
                else:
                    past_results.append(ev_copy)

            results = upcoming_results + past_results
            results = results[:4]

            message = f"تم العثور على {len(results)} حدث مطابق"

        elif query_type == "by_type":
            if not event_type:
                return {"success": False, "message": "يجب تحديد نوع الحدث"}
            for term in UQU_CALENDAR:
                for event in term.get("events", []):
                    if event.get("type") == event_type:
                        results.append(event)
            message = f"تم العثور على {len(results)} حدث من نوع {event_type}"

        elif query_type == "by_term":
            if not query:
                return {"success": False, "message": "يجب تحديد اسم الفصل الدراسي"}
            for term in UQU_CALENDAR:
                if query in term.get("term", "").lower():
                    results.extend(term.get("events", []))
            message = f"تم العثور على {len(results)} حدث في الفصل الدراسي"

        elif query_type == "next_event":
            # استخراج وتجهيز دالة مساعدة لفك التواريخ المركبة مثل "24 Aug - 30 Aug 2025"
            today = datetime.now().date()
            next_event = None
            next_event_date = None

            def parse_start_date(date_str):
                try:
                    # استخراج السنة
                    year_match = re.search(r'\d{4}', date_str)
                    year = year_match.group(0) if year_match else str(today.year)

                    # استخراج اليوم والشهر الأول (مثال: "24 Aug")
                    dm_match = re.search(r'\d{1,2}\s+[A-Za-z]+', date_str)
                    if dm_match:
                        first_date = dm_match.group(0)
                        # دمج السنة مع اليوم والشهر إذا لم تكن مرتبطة به
                        full_match = re.search(first_date + r'\s+\d{4}', date_str)
                        full_date_str = full_match.group(0) if full_match else f"{first_date} {year}"

                        return datetime.strptime(full_date_str, "%d %b %Y").date()
                except Exception:
                    pass
                return None

            for term in UQU_CALENDAR:
                for event in term.get("events", []):
                    event_date = parse_start_date(event.get("date", ""))
                    if event_date and event_date >= today:
                        if next_event is None or event_date < next_event_date:
                            next_event = event
                            next_event_date = event_date

            if next_event:
                results = [next_event]
                message = "تم العثور على الحدث القادم"
            else:
                message = "لا توجد أحداث قادمة"

        elif query_type == "all":
            for term in UQU_CALENDAR:
                results.extend(term.get("events", []))
            message = f"جميع الأحداث: {len(results)} حدث"

        else:
            return {"success": False, "message": "نوع استعلام غير معروف"}

    except Exception as e:
        logger.error(f"[Calendar Tool] Error: {e}")
        return {"success": False, "message": "حدث خطأ أثناء البحث في التقويم"}

    # إرجاع البيانات بشكل نقي (بدون client_only) للنموذج (LLM)
    return {
        "success": True,
        "data": results,
        "message": message
    }


async def _get_course_info(ctx: ToolContext, args: dict) -> dict:
    """20. Get Course Info (READ-ONLY catalog lookup) Reads the top-level `courses` collection. Document ID == course code (e.g. "CS4510"); fields include course_id, course_name (EN), course_name_ar (AR), exam_dates, grading_policy, and any extras. This branch performs NO Firestore writes."""
    db = ctx.db
    import re as _re
    from difflib import SequenceMatcher

    raw_query = str(args.get("query", "")).strip()
    if not raw_query:
        return {
            "success": True,
            "found": False,
            "query": raw_query,
            "message": "Course not found in Firestore courses collection.",
        }

    # Fold Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) digits → ASCII
    # so "مواضيع مختارة ٢" and "مواضيع مختارة 2" compare equal.
    _DIGIT_FOLD = str.maketrans(
        "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
        "01234567890123456789",
    )
    # Arabic tashkeel/diacritics + tatweel (ـ) — stripped before matching.
    _TASHKEEL_RE = _re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
    # Punctuation/symbols that should not affect name matching.
    _PUNCT_RE = _re.compile(r"[\-\u2013\u2014_()\[\]{}،,.:;/\\|!؟?\"'`~]")

    def _norm(s: str) -> str:
        """Normalize Arabic/English text for tolerant matching:
        fold Arabic-Indic digits, strip tashkeel/tatweel, unify alef/ya/
        ta-marbuta variants, drop punctuation, collapse whitespace, lower."""
        if not s:
            return ""
        s = str(s).translate(_DIGIT_FOLD)
        s = _TASHKEEL_RE.sub("", s)
        s = _re.sub(r"[أإآ]", "ا", s)
        s = (s.replace("ؤ", "و")
               .replace("ئ", "ي")
               .replace("ى", "ي")
               .replace("ة", "ه"))
        s = _PUNCT_RE.sub(" ", s)
        s = _re.sub(r"\s+", " ", s)
        return s.lower().strip()

    def _code_key(s: str) -> str:
        """Course-code comparison key: fold digits, drop spaces/dashes,
        uppercase."""
        s = str(s or "").translate(_DIGIT_FOLD)
        return _re.sub(r"[\s\-_]", "", s).upper()

    # Question/filler words stripped from the query before name scoring
    # so "وش معلومات مادة مواضيع مختارة؟" scores against "مواضيع مختارة".
    # Stored on the normalized form (ة→ه, إ/أ/آ→ا) to match _norm output.
    _FILLER_WORDS = {
        "وش", "ما", "ماهي", "هي", "هو", "معلومات", "معلومه", "ماده", "المعلومات",
        "عن", "حق", "حول", "اخبرني", "اعطني", "ابي", "ابغى", "ايش", "ويش",
        "كم", "متى", "وين", "هل", "تفاصيل", "بيانات", "ماهيه",
    }

    def _strip_fillers(normalized: str) -> str:
        """Drop common question/filler tokens from an already-normalized
        query, keeping the meaningful course-name tokens."""
        toks = [t for t in normalized.split(" ") if t and t not in _FILLER_WORDS]
        return " ".join(toks).strip()

    def _ratio(a: str, b: str) -> float:
        """Similarity in [0,1]; contains-match (either direction) is
        treated as a strong signal so extra words in the sentence
        (e.g. 'متى فاينل الحوسبة السحابية') don't sink a real match."""
        if not a or not b:
            return 0.0
        if a in b or b in a:
            return 0.92
        return SequenceMatcher(None, a, b).ratio()

    # Output-only HTML sanitizer.
    _BR_RE = _re.compile(r"<\s*br\s*/?\s*>|&lt;\s*br\s*/?\s*&gt;", _re.IGNORECASE)

    def _clean_str(s: str) -> str:
        text = str(s)
        if _BR_RE.search(text):
            # Convert <br> variants into markdown bullets
            cleaned = "\n- " + _BR_RE.sub("\n- ", text)
        else:
            cleaned = text
        cleaned = _re.sub(r"(\s*،\s*)+", "، ", cleaned)  # collapse dup seps
        cleaned = _re.sub(r"[ \t]+", " ", cleaned)
        return cleaned.strip()

    def _sanitize(obj):
        """Recursively clean HTML line breaks from strings in a dict/list."""
        if isinstance(obj, str):
            return _clean_str(obj)
        if isinstance(obj, dict):
            return {k: _sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_sanitize(v) for v in obj]
        return obj

    courses_col = db.collection("courses")

    # ── Tier 1: direct document fetch by code (doc ID == course code) ──
    # Try the raw query and a space/dash-stripped uppercase variant.
    doc_candidates = []
    seen_ids = set()
    for cand in (raw_query, _code_key(raw_query)):
        if cand and cand not in seen_ids:
            seen_ids.add(cand)
            doc_candidates.append(cand)

    for cand in doc_candidates:
        snap = courses_col.document(cand).get()
        if snap.exists:
            course = snap.to_dict() or {}
            course.setdefault("course_id", snap.id)
            return {"success": True, "found": True, "course": _sanitize(course)}

    # ── Load the catalog once for the remaining tiers (~7 docs). ──
    all_docs = list(courses_col.stream())
    catalog = []
    for d in all_docs:
        data = d.to_dict() or {}
        data.setdefault("course_id", d.id)
        catalog.append((d.id, data))

    qn = _norm(raw_query)
    qcode = _code_key(raw_query)
    q_clean = _strip_fillers(qn) or qn  # never let stripping empty it out

    # ── Tier 2: exact code match via course_id field (case-insensitive) ──
    for doc_id, data in catalog:
        cid = data.get("course_id") or doc_id
        if qcode and _code_key(cid) == qcode:
            return {"success": True, "found": True, "course": _sanitize(data)}

    # ── Tier 3: fuzzy name/code scoring ──
    # Score each course against the cleaned query (and the raw normalized
    # query as a fallback), taking the best of AR-name / EN-name / code.
    # Thresholds:
    #   • best >= 0.75  → return that single course.
    #   • 0.55 .. 0.75  → ambiguous: return all candidates, ask to choose.
    #   • < 0.55        → not found (no hallucination).
    HIGH_THRESHOLD = 0.75
    LOW_THRESHOLD = 0.55

    scored = []
    for doc_id, data in catalog:
        name_ar = _norm(data.get("course_name_ar"))
        name_en = _norm(data.get("course_name"))
        cid_norm = _norm(data.get("course_id") or doc_id)
        score = max(
            _ratio(q_clean, name_ar),
            _ratio(q_clean, name_en),
            _ratio(qn, name_ar),
            _ratio(qn, name_en),
            _ratio(q_clean, cid_norm),
        )
        scored.append((round(score, 3), data))

    scored.sort(key=lambda x: x[0], reverse=True)

    def _match_entry(score, data):
        return {
            "course_id": data.get("course_id"),
            "course_name": _clean_str(data.get("course_name") or ""),
            "course_name_ar": _clean_str(data.get("course_name_ar") or ""),
            "score": score,
        }

    if scored:
        # High-confidence band. If several courses tie at >= HIGH, don't
        # guess between them — surface the tied set for the user to pick.
        high = [(s, d) for s, d in scored if s >= HIGH_THRESHOLD]
        if len(high) == 1:
            return {"success": True, "found": True, "course": _sanitize(high[0][1])}
        if len(high) > 1:
            return {
                "success": True,
                "found": True,
                "multiple": True,
                "matches": [_match_entry(s, d) for s, d in high],
            }

        # Ambiguous band — not confident enough to auto-pick. Return every
        # plausible candidate (even a lone one) so the assistant confirms
        # with the user instead of guessing.
        mid = [(s, d) for s, d in scored if s >= LOW_THRESHOLD]
        if mid:
            return {
                "success": True,
                "found": True,
                "multiple": True,
                "matches": [_match_entry(s, d) for s, d in mid],
            }

    # ── No reliable match ──
    return {
        "success": True,
        "found": False,
        "query": raw_query,
        "message": (
            "Course not found in Firestore courses collection. "
            "Ask the user to verify the name or provide the course code "
            "(e.g. CS4510)."
        ),
    }


async def _get_course_reviews(ctx: ToolContext, args: dict) -> dict:
    """Community course reviews (read-only)"""
    from services.community import course_reviews_for_agent
    return course_reviews_for_agent(str(args.get("query", "")))


async def _search_regulations(ctx: ToolContext, args: dict) -> dict:
    """Regulations knowledge base (read-only)"""
    from services.regulations import search_regulations
    return search_regulations(str(args.get("query", "")))


async def _get_university_news(ctx: ToolContext, args: dict) -> dict:
    """University news (official RSS, read-only)"""
    from services.news import get_news
    limit = max(1, min(10, to_int(args.get("limit"), 5)))
    data = await get_news(limit)
    if not data["items"]:
        return {"success": False, "message": "تعذّر جلب أخبار الجامعة حالياً. الموقع الرسمي: https://uqu.edu.sa/App/News"}
    return {"success": True, "items": data["items"], "source": "https://uqu.edu.sa/App/News"}


HANDLERS = {
    "get_calendar_info": _get_calendar_info,
    "get_course_info": _get_course_info,
    "get_course_reviews": _get_course_reviews,
    "search_regulations": _search_regulations,
    "get_university_news": _get_university_news,
}
