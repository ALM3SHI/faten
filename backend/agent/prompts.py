"""
================================================================
UQU AGENT — Hyper-Contextual System Prompts (v2.0)
================================================================
Builds a deeply personalized system prompt that makes the Agent
feel like it truly "knows" the student.
"""

from datetime import datetime

from common.grade_scale import GRADE_POINTS
from agent.prompt_texts import prompt_text


# Grade-point mapping — official UQU 4.00 scale (common/grade_scale.py).
GP_MAP = GRADE_POINTS


def _student_display_name(
    client_context: dict | None,
    profile: dict,
    academic_record: dict | None,
) -> str:
    """Preferred name for greeting / identity — profile first, transcript fallback."""
    fe_profile = (client_context or {}).get("profile") or {}
    record = academic_record or {}
    for candidate in (
        fe_profile.get("name"),
        profile.get("name"),
        record.get("name"),
        record.get("nameEn"),
    ):
        if candidate and str(candidate).strip():
            return str(candidate).strip()
    return ""


def _subject_family(code: str, name: str) -> str:
    """Bucket a completed course into a coarse subject family so the
    agent can spot domain-level weaknesses (e.g. "weak in math foundation"
    rather than just "got a C in MATH201"). Falls back to "أخرى" (Other)
    when neither the code prefix nor the name keyword maps to a known
    family — keeping the bucketing visibly conservative."""
    code_up = (code or "").upper()
    n = (name or "").lower()
    # Prefix-based first — UQU course codes are stable.
    if code_up.startswith(("MATH", "STAT", "MTH")):
        return "الرياضيات والإحصاء"
    if code_up.startswith(("CS", "CSE", "CPCS", "CPIT")):
        return "علوم الحاسب"
    if code_up.startswith(("CEN", "CPE", "CE")):
        return "هندسة الحاسب"
    if code_up.startswith(("EE", "ELEC")):
        return "الهندسة الكهربائية"
    if code_up.startswith(("PHYS", "PHY")):
        return "الفيزياء"
    if code_up.startswith(("CHEM", "CHE")):
        return "الكيمياء"
    if code_up.startswith(("ENGL", "ENG", "ARAB", "ARB")):
        return "اللغات"
    if code_up.startswith(("ISLM", "ISL", "QUR")):
        return "العلوم الشرعية"
    # Name-keyword fallback.
    if any(k in n for k in ("ريا", "رياض", "math", "calculus", "algebra", "تفاضل", "جبر")):
        return "الرياضيات والإحصاء"
    if any(k in n for k in ("برمج", "خوارز", "حاسب", "برمجة", "program", "algorithm")):
        return "علوم الحاسب"
    if any(k in n for k in ("هندس", "engineer", "electric", "كهربا")):
        return "الهندسة"
    if any(k in n for k in ("فيزي", "physics")):
        return "الفيزياء"
    if any(k in n for k in ("كيمي", "chem")):
        return "الكيمياء"
    if any(k in n for k in ("إنجليزي", "english", "عربي", "arabic", "lang", "نحو")):
        return "اللغات"
    return "أخرى"

NAVIGATION_AMBIGUOUS_PROMPT = prompt_text("navigation_ambiguous")

def build_system_prompt(
    user_data: dict | None = None,
    transcript: dict | None = None,
    upcoming_exams: list | None = None,
    active_plan: dict | None = None,
    client_context: dict | None = None,
    academic_record: dict | None = None,
    schedule: list | None = None,
    required_blocks: list[str] | None = None,
    intent: str | None = None,
) -> str:
    """Build a hyper-contextual system prompt.

    Injects full academic intelligence:
    - Student profile & personality
    - GPA history & trend analysis
    - Current semester workload pressure
    - Learning style & stress level
    - Upcoming exam urgency signals
    - Proactive behavioral rules
    - LIVE frontend snapshot (`client_context`) — supersedes Firestore
      where present, so the agent never reasons from stale data.
    """
    user_data = user_data or {}
    upcoming_exams = upcoming_exams or []
    client_context = client_context or {}
    req_blocks = required_blocks if required_blocks is not None else ["all"]

    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    today_ar = today.strftime("%A, %Y-%m-%d")

    profile = dict(user_data.get("profile") or {})
    basic = user_data.get("basic") or {}
    if (basic.get("name") or "").strip():
        profile["name"] = str(basic["name"]).strip()
    display_name = _student_display_name(client_context, profile, academic_record)
    prefs = user_data.get("study_preferences", {})
    analysis = user_data.get("analysis", {})

    # ══════════════════════════════════════════════════
    #  Modular Prompt Sections
    # ══════════════════════════════════════════════════
    BASE_IDENTITY_PROMPT = prompt_text("base_identity").format(today_ar=today_ar)

    SCOPE_POLICY_PROMPT = prompt_text("scope_policy")

    GENERAL_QA_PROMPT = prompt_text("general_qa")

    FORMATTING_PROMPT = prompt_text("formatting")

    ACADEMIC_ANALYSIS_PROMPT = prompt_text("academic_analysis")

    FULL_ANALYSIS_PROTOCOL_PROMPT = prompt_text("full_analysis_protocol")

    ACTION_TOOL_PROMPT = prompt_text("action_tool")

    COURSE_INFO_PROMPT = prompt_text("course_info")

    NEWS_PROMPT = prompt_text("news")

    REGULATIONS_PROMPT = prompt_text("regulations")

    TOOL_GUIDE_PROMPT = prompt_text("tool_guide")

    # ══════════════════════════════════════════════════
    #  Build Prompt based on Intent
    # ══════════════════════════════════════════════════
    sections = []
    
    if intent == "GENERAL_QA":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, GENERAL_QA_PROMPT])
    elif intent == "PROFILE_QUERY":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT])
    elif intent == "GPA_QUERY":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, ACADEMIC_ANALYSIS_PROMPT])
    elif intent == "GPA_IMPROVEMENT":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, FORMATTING_PROMPT, ACADEMIC_ANALYSIS_PROMPT, FULL_ANALYSIS_PROTOCOL_PROMPT])
    elif intent == "SCHEDULE_TASK":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, ACTION_TOOL_PROMPT])
    elif intent == "PLAN_OR_STUDY_ADVICE":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, FORMATTING_PROMPT, ACADEMIC_ANALYSIS_PROMPT, ACTION_TOOL_PROMPT])
    elif intent == "FULL_ACADEMIC_ANALYSIS":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, FORMATTING_PROMPT, ACADEMIC_ANALYSIS_PROMPT, FULL_ANALYSIS_PROTOCOL_PROMPT])
    elif intent == "SEMESTER_QUERY":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, FORMATTING_PROMPT, ACADEMIC_ANALYSIS_PROMPT])
    elif intent == "COURSE_INFO":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, FORMATTING_PROMPT, COURSE_INFO_PROMPT])
    elif intent == "UNIVERSITY_NEWS":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, NEWS_PROMPT])
    elif intent == "REGULATIONS":
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, REGULATIONS_PROMPT])
    else:
        # Fallback to mostly everything for unknown intents (safe)
        sections.extend([BASE_IDENTITY_PROMPT, SCOPE_POLICY_PROMPT, FORMATTING_PROMPT, ACADEMIC_ANALYSIS_PROMPT, FULL_ANALYSIS_PROTOCOL_PROMPT, ACTION_TOOL_PROMPT])
        
    sections.append(TOOL_GUIDE_PROMPT)
    prompt = "\n\n".join(sections) + "\n\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 1.5: LIVE FRONTEND SNAPSHOT (highest priority)
    # ══════════════════════════════════════════════════
    # Skip live snapshot for simple intents to save tokens
    fe_profile = client_context.get("profile") if client_context else None
    fe_transcript = client_context.get("transcript") if client_context else None
    fe_plan = client_context.get("plan") if client_context else None
    
    if (fe_profile or fe_transcript or fe_plan) and intent not in ("GREETING", "GENERAL_QA"):
        prompt += "\n═══ سياق مباشر من واجهة الطالب (Live) ═══\n"
        prompt += "هذا السياق وُلِّد لحظياً من واجهة المستخدم.\n"
        if fe_profile:
            name = display_name or "—"
            major = fe_profile.get("major") or "—"
            student_id = fe_profile.get("studentId") or "—"
            target = fe_profile.get("targetGpa")
            current = fe_profile.get("currentGpa")
            total_plan = fe_profile.get("totalPlanHours")
            prompt += (
                f"\n• بيانات الطالب: {name} • التخصص: {major} • الرقم الجامعي: {student_id}\n"
            )
            if current is not None:
                prompt += f"• المعدل التراكمي الحالي: {current} / 4.00\n"
            if target is not None:
                prompt += f"• المعدل المستهدف: {target} / 4.00\n"
            if total_plan:
                prompt += f"• ساعات الخطة الإجمالية: {total_plan}\n"
        if fe_transcript:
            tgpa = fe_transcript.get("gpa")
            earned = fe_transcript.get("earnedHours")
            completed = fe_transcript.get("completedCourses") or []
            current_cs = fe_transcript.get("currentCourses") or []
            if tgpa is not None or earned is not None:
                prompt += (
                    f"• المعدل من السجل: {tgpa if tgpa is not None else '—'} / 4.00 • "
                    f"الساعات المكتسبة: {earned if earned is not None else '—'}\n"
                )
            if completed:
                prompt += f"• عدد المواد المكتملة في السجل: {len(completed)}\n"
                # Quick top-3 lowest-grade summary so the agent can answer
                # "أيش أضعف موادي؟" without enumerating everything.
                def _gp(c):
                    return c.get("gradePoints") if c.get("gradePoints") is not None else 5
                weakest = sorted(
                    [c for c in completed if c.get("gradePoints") is not None],
                    key=_gp,
                )[:3]
                if weakest:
                    prompt += "  - أضعف المواد: " + ", ".join(
                        f"{c.get('nameAr') or c.get('code')} ({c.get('grade')})" for c in weakest
                    ) + "\n"
            if current_cs:
                names = [c.get("nameAr") or c.get("code") for c in current_cs[:6]]
                prompt += f"• مواد الفصل الحالي: {', '.join(names)}\n"
        if fe_plan:
            tasks = fe_plan.get("tasks") or []
            today_tasks = [t for t in tasks if t.get("isToday")]
            if today_tasks:
                prompt += f"• مهام اليوم النشطة في الخطة: {len(today_tasks)}\n"
            elif tasks:
                prompt += f"• إجمالي مهام الخطة: {len(tasks)}\n"

    # ══════════════════════════════════════════════════
    #  EARLY EXIT FOR SIMPLE INTENTS
    # ══════════════════════════════════════════════════
    if intent in ("GENERAL_QA", "PROFILE_QUERY", "COURSE_INFO"):
        return prompt

    # ══════════════════════════════════════════════════
    #  BLOCK 2: Student Profile & Identity
    # ══════════════════════════════════════════════════
    has_profile = bool(display_name or profile.get("major"))
    if has_profile and ("all" in req_blocks or "profile_basic" in req_blocks or "gpa_summary" in req_blocks) and intent not in ("GENERAL_QA",):
        prompt += "\n═══ بيانات الطالب ═══\n"
        if display_name:
            prompt += f"الاسم (المعروض — من الملف الشخصي): {display_name}\n"
        record_name = (academic_record or {}).get("name") or (academic_record or {}).get("nameEn")
        if record_name and str(record_name).strip() and str(record_name).strip() != display_name:
            prompt += f"اسم السجل الأكاديمي (مرجع فقط): {str(record_name).strip()}\n"
        if profile.get("university"):
            prompt += f"الجامعة: {profile['university']}\n"
        if profile.get("major"):
            prompt += f"التخصص: {profile['major']}\n"
        if profile.get("level"):
            prompt += f"المستوى: {profile['level']}\n"
        if profile.get("currentGpa") is not None:
            prompt += f"المعدل التراكمي: {profile['currentGpa']} / 4.00\n"
        if profile.get("targetGpa"):
            prompt += f"الهدف الأكاديمي: {profile['targetGpa']} / 4.00\n"
        if profile.get("earnedHours"):
            prompt += f"الساعات المكتسبة: {profile['earnedHours']}\n"

        gap = None
        if profile.get("targetGpa") and profile.get("currentGpa"):
            try:
                gap = float(profile["targetGpa"]) - float(profile["currentGpa"])
                if gap > 0:
                    prompt += f"📏 الفجوة عن الهدف: {gap:.2f} نقطة\n"
                else:
                    prompt += "✅ المعدل يتجاوز الهدف — ما شاء الله!\n"
            except (ValueError, TypeError):
                pass
    else:
        prompt += "\n⚠️ الطالب لم يكمل ملفه الشخصي بعد. شجّعه على إضافة بياناته.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 3: Learning Personality Profile
    # ══════════════════════════════════════════════════
    if prefs and intent not in ("GENERAL_QA", "PROFILE_QUERY", "GPA_QUERY"):
        prompt += "\n═══ شخصية التعلم ═══\n"

        time_map = {"morning": "🌅 صباحي", "evening": "🌆 مسائي", "night": "🌙 ليلي"}
        speed_map = {"slow": "🐢 بطيء ومتأنٍ", "normal": "🚶 معتدل", "fast": "🏃 سريع"}
        stress_map = {
            "low": "😌 مرتاح", "normal": "🙂 طبيعي",
            "high": "😰 مرتفع", "critical": "🔴 حرج — يحتاج دعم فوري"
        }

        if prefs.get("best_time"):
            prompt += f"  • وقت الذروة: {time_map.get(prefs['best_time'], prefs['best_time'])}\n"
        if prefs.get("study_hours"):
            prompt += f"  • ساعات يومية: {prefs['study_hours']} ساعة\n"
        if prefs.get("method"):
            prompt += f"  • أسلوب المذاكرة: {prefs['method']}\n"
        if prefs.get("focus_length"):
            prompt += f"  • مدة التركيز: {prefs['focus_length']} دقيقة (جلسة بومودورو)\n"
        if prefs.get("study_speed"):
            prompt += f"  • سرعة الدراسة: {speed_map.get(prefs['study_speed'], prefs['study_speed'])}\n"
        if prefs.get("stress_level"):
            stress = prefs["stress_level"]
            prompt += f"  • مستوى التوتر: {stress_map.get(stress, stress)}\n"
            if stress in ("high", "critical"):
                prompt += "  ⚠️ تنبيه: الطالب متوتر — كن لطيفاً ومشجعاً بشكل خاص. اقترح تقليل الحمل والراحة.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 4: Current Semester Workload
    # ══════════════════════════════════════════════════
    courses = profile.get("courses", [])
    if courses and ("all" in req_blocks or "current_courses" in req_blocks) and intent not in ("GENERAL_QA", "PROFILE_QUERY", "GPA_QUERY"):
        total_hours = sum(
            (c.get("credit_hours") or c.get("creditHours") or 3)
            for c in courses
        )
        hard_count = sum(1 for c in courses if c.get("difficulty") == "hard")
        easy_count = sum(1 for c in courses if c.get("difficulty") == "easy")
        medium_count = len(courses) - hard_count - easy_count

        prompt += f"\n═══ عبء الفصل الحالي ({len(courses)} مادة — {total_hours} ساعة) ═══\n"

        if hard_count >= 3:
            prompt += "🔴 تحذير: حمل دراسي ثقيل جداً! أعط أولوية للمواد الصعبة.\n"

        for c in courses:
            code_str = f" ({c.get('code')})" if c.get("code") else ""
            hrs = c.get("credit_hours") or c.get("creditHours") or 3
            line = f"  • {c.get('name', '')}{code_str} — {hrs} ساعة"

            diff = c.get("difficulty", "medium")
            diff_labels = {"hard": "صعبة", "medium": "متوسطة", "easy": "سهلة"}
            line += f" | {diff_labels.get(diff, diff)}"

            exam_date = c.get("examDate") or c.get("exam_date")
            if exam_date:
                try:
                    days = (datetime.fromisoformat(exam_date) - today).days
                    if days <= 0:
                        line += f" | الاختبار اليوم أو فات!"
                    elif days <= 3:
                        line += f" | اختبار بعد {days} أيام!"
                    elif days <= 7:
                        line += f" | اختبار بعد {days} أيام"
                    else:
                        line += f" | اختبار بعد {days} يوم"
                except (ValueError, TypeError):
                    line += f" | اختبار: {exam_date}"

            if c.get("grade"):
                line += f" | الدرجة الحالية: {c['grade']}"

            prompt += line + "\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 5: GPA History & Trend Analysis
    # ══════════════════════════════════════════════════
    if transcript and ("all" in req_blocks or "full_transcript" in req_blocks or "gpa_summary" in req_blocks or "recent_grades" in req_blocks) and intent not in ("GENERAL_QA", "PROFILE_QUERY"):
        transcript_courses = transcript.get("courses", [])
        semesters_data = transcript.get("semesters", [])

        if semesters_data:
            prompt += f"\n═══ مسار المعدل عبر الفصول ({len(semesters_data)} فصل) ═══\n"
            gpas = []
            for sem in semesters_data:
                sem_gpa = sem.get("gpa")
                # A semester in progress has no GPA yet — show it, but keep it out of the trend.
                try:
                    gpas.append(float(sem_gpa))
                except (TypeError, ValueError):
                    sem_gpa = "—"
                prompt += f"  • {sem.get('name') or 'فصل'}: {sem_gpa}\n"

            # Trend analysis
            if len(gpas) >= 2:
                recent = gpas[-1]
                prev = gpas[-2]
                avg_all = sum(gpas) / len(gpas)
                if recent > prev + 0.1:
                    prompt += f"  الاتجاه: صاعد (تحسّن بـ {recent - prev:.2f})\n"
                elif recent < prev - 0.1:
                    prompt += f"  الاتجاه: نازل (انخفض بـ {prev - recent:.2f}) — يحتاج اهتمام!\n"
                else:
                    prompt += f"  الاتجاه: مستقر\n"
                prompt += f"  أعلى فصل: {max(gpas):.2f} | أدنى فصل: {min(gpas):.2f} | متوسط: {avg_all:.2f}\n"

        elif transcript_courses:
            prompt += f"\n═══ ملخص السجل ({len(transcript_courses)} مادة) ═══\n"
            by_grade: dict[str, int] = {}
            for c in transcript_courses:
                g = c.get("grade") or "غير محدد"  # in-progress courses have grade=None
                by_grade[g] = by_grade.get(g, 0) + 1
            for g, n in sorted(by_grade.items()):
                prompt += f"  • {g}: {n} مادة\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 5.5: Full Academic Ledger — grouped by subject family
    # ══════════════════════════════════════════════════
    # This is the deep-grounding block: the agent must have every grade
    # in context to spot domain-level weaknesses ("ضعف في فئة الرياضيات"
    # rather than just "حصل على C في MATH201"). The Advice CoT protocol
    # at the top of the prompt requires the agent to quote from here.
    completed_for_ledger: list[dict] = []
    if academic_record:
        completed_for_ledger = academic_record.get("completedCourses") or []
    if not completed_for_ledger and transcript:
        completed_for_ledger = transcript.get("courses") or []

    if completed_for_ledger and ("all" in req_blocks or "full_transcript" in req_blocks):
        # Group by subject family + compute family-level GPA so the agent
        # can compare e.g. "math family 1.83/4 vs CS family 3.21/4".
        families: dict[str, list[dict]] = {}
        for c in completed_for_ledger:
            code = c.get("code") or ""
            name = c.get("nameAr") or c.get("nameEn") or c.get("name") or ""
            fam = _subject_family(code, name)
            families.setdefault(fam, []).append(c)

        prompt += (
            f"\n═══ السجل الأكاديمي الكامل بالدرجات "
            f"({len(completed_for_ledger)} مادة منتهية، مجمَّعة بالفئة) ═══\n"
        )
        prompt += "هذه المصدر الموثوق لأي تحليل سجل/توصية مواد/كشف نمط ضعف.\n"

        # Order families by lowest GPA first — weak families surface
        # immediately at the top of the ledger.
        family_stats: list[tuple[str, list[dict], float, int]] = []
        for fam, lst in families.items():
            pts = 0.0
            hrs = 0
            for c in lst:
                gp = c.get("gradePoints")
                ch = c.get("credit_hours") or c.get("creditHours") or 3
                if gp is None:
                    continue
                try:
                    pts += float(gp) * ch
                    hrs += ch
                except (ValueError, TypeError):
                    continue
            fam_gpa = round(pts / hrs, 2) if hrs > 0 else 0.0
            family_stats.append((fam, lst, fam_gpa, hrs))
        family_stats.sort(key=lambda x: x[2])  # weak families first

        for fam, lst, fam_gpa, fam_hrs in family_stats:
            prompt += (
                f"\nفئة: {fam} — {len(lst)} مادة، {fam_hrs} ساعة، "
                f"متوسط الفئة {fam_gpa:.2f}/4.00\n"
            )
            for c in lst:
                code = c.get("code") or "—"
                name = c.get("nameAr") or c.get("nameEn") or c.get("name") or "—"
                grade = c.get("grade") or "—"
                ch = c.get("credit_hours") or c.get("creditHours") or 3
                sem = c.get("semester") or c.get("semesterEn") or ""
                gp = c.get("gradePoints")
                gp_str = f" ({gp})" if gp is not None else ""
                sem_str = f" [{sem}]" if sem else ""
                prompt += f"  • {code} — {name} — {grade}{gp_str} — {ch}س{sem_str}\n"

        # Explicit pattern hints — make the agent's job easier.
        weak_families = [s for s in family_stats if s[2] > 0 and s[2] < 2.5]
        strong_families = [s for s in family_stats if s[2] >= 3.5]
        if weak_families:
            prompt += "\n⚠️ فئات ضعيفة (< 2.5/4): " + "، ".join(
                f"{f[0]} ({f[2]:.2f})" for f in weak_families
            ) + " — يجب الإشارة إليها في أي توصية بمواد جديدة.\n"
        if strong_families:
            prompt += "💪 فئات قوية (≥ 3.5/4): " + "، ".join(
                f"{f[0]} ({f[2]:.2f})" for f in strong_families
            ) + ".\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 5.6: Semester Detail Ledger (For SEMESTER_QUERY)
    # ══════════════════════════════════════════════════
    if intent == "SEMESTER_QUERY" and completed_for_ledger:
        prompt += f"\n═══ تفاصيل المواد والفصول (مخصص لسؤال الطالب) ═══\n"
        sem_groups = {}
        for c in completed_for_ledger:
            sem = c.get("semester") or c.get("semesterEn") or c.get("semesterAr") or "فصل غير محدد"
            sem_groups.setdefault(sem, []).append(c)
            
        for sem, lst in sem_groups.items():
            sem_gpa = "—"
            sem_earned = "—"
            if transcript and transcript.get("semesters"):
                for s_data in transcript["semesters"]:
                    s_name = s_data.get("name") or s_data.get("nameAr") or s_data.get("nameEn") or ""
                    if sem and s_name and (sem in s_name or s_name in sem):
                        sem_gpa = s_data.get("gpa", "—")
                        sem_earned = s_data.get("earnedHours", "—")
                        break
            
            # Compute SGPA if missing but we have grade points and credit hours
            if sem_gpa == "—":
                pts = 0.0
                hrs = 0
                for c in lst:
                    gp = c.get("gradePoints")
                    ch = c.get("credit_hours") or c.get("creditHours") or 3
                    if gp is not None:
                        try:
                            pts += float(gp) * int(ch)
                            hrs += int(ch)
                        except (ValueError, TypeError):
                            pass
                if hrs > 0:
                    sem_gpa = f"{round(pts / hrs, 2)}"
                    sem_earned = f"{hrs}"
                    
            prompt += f"\nفصل: {sem} (المعدل الفصلي: {sem_gpa} | الساعات المكتسبة: {sem_earned})\n"
            for c in lst:
                code = c.get("code") or "—"
                name = c.get("nameAr") or c.get("nameEn") or c.get("name") or "—"
                grade = c.get("grade") or "—"
                ch = c.get("credit_hours") or c.get("creditHours") or 3
                prompt += f"  • {code} — {name} — {grade} — {ch}س\n"
        prompt += "\n⚠️ اعتمد على هذه القائمة للإجابة عن أسئلة تخص مواد أو معدل فصل معين بدقة.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 6: Academic Strengths & Weaknesses
    # ══════════════════════════════════════════════════
    weaknesses = analysis.get("weaknesses", [])
    strengths = analysis.get("strengths", [])
    if (weaknesses or strengths) and ("all" in req_blocks or "full_transcript" in req_blocks or "recent_grades" in req_blocks):
        prompt += "\n═══ 🎯 التحليل الأكاديمي ═══\n"
        if weaknesses:
            prompt += "نقاط الضعف (تحتاج اهتماماً عاجلاً):\n"
            for w in weaknesses[:5]:
                prompt += f"  ❌ {w}\n"
        if strengths:
            prompt += "نقاط القوة:\n"
            for s in strengths[:5]:
                prompt += f"  ✅ {s}\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 7: Upcoming Exams with Urgency Signals
    # ══════════════════════════════════════════════════
    if upcoming_exams and ("all" in req_blocks or "exams" in req_blocks):
        prompt += "\n═══ 📅 الاختبارات القادمة ═══\n"
        critical_exams = []  # ≤ 3 days
        urgent_exams = []    # 4-7 days
        normal_exams = []    # > 7 days

        for e in upcoming_exams[:10]:
            try:
                exam_date = datetime.fromisoformat(e["date"])
                days_left = (exam_date - today).days
                entry = f"{e.get('subject', '?')} — {e['date']} (بعد {days_left} يوم)"

                if days_left <= 3:
                    critical_exams.append(entry)
                elif days_left <= 7:
                    urgent_exams.append(entry)
                else:
                    normal_exams.append(entry)
            except (ValueError, KeyError):
                normal_exams.append(f"{e.get('subject', '?')} — {e.get('date', '?')}")

        if critical_exams:
            prompt += "🔴 حرج (≤ 3 أيام) — ركّز عليها فوراً:\n"
            for ex in critical_exams:
                prompt += f"  🚨 {ex}\n"
        if urgent_exams:
            prompt += "🟡 عاجل (4-7 أيام):\n"
            for ex in urgent_exams:
                prompt += f"  ⚠️ {ex}\n"
        if normal_exams:
            prompt += "🟢 قادمة:\n"
            for ex in normal_exams:
                prompt += f"  📌 {ex}\n"
    elif "all" in req_blocks or "exams" in req_blocks:
        prompt += "\n✅ لا توجد اختبارات قادمة مسجلة.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 7.5: User Schedule (Lectures/Classes)
    # ══════════════════════════════════════════════════
    if schedule and ("all" in req_blocks or "schedule" in req_blocks):
        prompt += "\n═══ 🏫 جدول المحاضرات الأسبوعي ═══\n"
        prompt += "⚠️ يجب تجنب هذه الأوقات تماماً عند اقتراح أوقات المذاكرة:\n"
        for lec in schedule:
            subject = lec.get("course_name") or lec.get("subject") or lec.get("courseName") or "محاضرة"
            day = lec.get("day") or "—"
            start = lec.get("start_time") or lec.get("startTime") or "—"
            end = lec.get("end_time") or lec.get("endTime") or "—"
            prompt += f"  • {subject}: يوم {day} من {start} إلى {end}\n"
    elif "all" in req_blocks or "schedule" in req_blocks:
        prompt += "\n✅ لا توجد محاضرات مسجلة في الجدول.\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 8: Active Study Plan Status
    # ══════════════════════════════════════════════════
    if active_plan and ("all" in req_blocks or "active_plan" in req_blocks):
        tasks = active_plan.get("tasks", [])
        pending = [t for t in tasks if not t.get("done")]
        done = [t for t in tasks if t.get("done")]
        completion = round(len(done) / len(tasks) * 100) if tasks else 0

        prompt += f'\n═══ 📋 الخطة الدراسية: "{active_plan.get("title", "")}" ═══\n'
        prompt += f"  التقدم: {len(done)}/{len(tasks)} ({completion}%)\n"

        if pending:
            # Show today's tasks first (legacy `date` or canonical `suggestedDay`)
            ar_days = [
                "الأحد", "الإثنين", "الثلاثاء", "الأربعاء",
                "الخميس", "الجمعة", "السبت",
            ]
            today_ar = ar_days[today.weekday()]
            today_tasks = [
                t for t in pending
                if t.get("date") == today_str or t.get("suggestedDay") == today_ar
            ]
            if today_tasks:
                prompt += "  مهام اليوم:\n"
                for t in today_tasks:
                    subject = t.get("subject") or t.get("courseName") or t.get("courseCode") or "عام"
                    duration = t.get("durationMinutes") or t.get("duration") or 60
                    prompt += f"    ◦ {t.get('title', '')} ({subject}) — {duration} دقيقة\n"

            other = [
                t for t in pending
                if t.get("date") != today_str and t.get("suggestedDay") != today_ar
            ][:5]
            if other:
                prompt += "  قادمة:\n"
                for t in other:
                    prompt += f"    ◦ {t.get('title', '')} — {t.get('date', '')}\n"

    # ══════════════════════════════════════════════════
    #  BLOCK 9: Adaptive Tutoring Persona
    # ══════════════════════════════════════════════════
    prompt += "\n═══ 🎭 أسلوب التدريس التكيفي ═══\n"

    if prefs:
        speed = prefs.get("study_speed", "normal")
        method = prefs.get("method", "")
        stress = prefs.get("stress_level", "normal")

        if speed == "fast":
            prompt += prompt_text("tutoring_fast")
        elif speed == "slow":
            prompt += prompt_text("tutoring_slow")
        else:
            prompt += "  • أسلوب متوسط: شرح واضح مع أمثلة عملية.\n"

        if method:
            method_lower = method.lower()
            if any(w in method_lower for w in ["بصري", "visual", "خرائط", "رسم"]):
                prompt += "  📸 يفضل التعلم البصري: اقترح مخططات، رسوم، ألوان، وفيديوهات.\n"
            elif any(w in method_lower for w in ["قراءة", "reading", "كتب", "ملخص"]):
                prompt += "  📖 يفضل القراءة: قدم ملخصات نصية منظمة ونقاط مراجعة.\n"
            elif any(w in method_lower for w in ["سمعي", "audio", "شرح", "محاضرة"]):
                prompt += "  🎧 يفضل السمع: اقترح محاضرات وبودكاست وشروحات صوتية.\n"
            elif any(w in method_lower for w in ["تطبيق", "practice", "حل", "تمارين"]):
                prompt += "  ✍️ يفضل التطبيق: ركز على حل مسائل وتمارين عملية.\n"
            else:
                prompt += f"  📚 أسلوبه: {method}\n"

        if stress in ("high", "critical"):
            prompt += prompt_text("tutoring_stressed")

    # ══════════════════════════════════════════════════
    #  BLOCK 10: Proactive Intelligence Rules
    # ══════════════════════════════════════════════════
    prompt += prompt_text("proactive_rules")

    return prompt

