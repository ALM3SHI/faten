"""
================================================================
UQU AGENT — Tools Schema Definition (v2.1 — Super-Agent + Client Channel)
================================================================
14 tools for the AI Agent's function calling. Original 12 + the
emit_client_action channel that lets the agent directly mutate the
user's Zustand stores via a structured action contract.
"""

import datetime

# دالة مساعدة لتوليد أداة التقويم الديناميكية
def get_dynamic_calendar_tool():
    today = datetime.datetime.now()
    current_date_str = today.strftime("%Y-%m-%d")
    
  
    
    term1_start = datetime.datetime(2025, 8, 24).date()
    term1_end = datetime.datetime(2026, 1, 8).date()
    term2_start = datetime.datetime(2026, 1, 18).date()
    term2_end = datetime.datetime(2026, 6, 25).date()
    next_year_start = datetime.datetime(2026, 8, 23).date()
    
    today_date = today.date()
    
    # تحديد الفصل الحالي بناءً على التاريخ الفعلي
    if term1_start <= today_date <= term1_end:
        current_term = "الفصل الدراسي الأول"
        last_term = "غير متوفر (نحن في بداية العام)"
        next_term = "الفصل الدراسي الثاني"
        
    elif term2_start <= today_date <= term2_end:
        current_term = "الفصل الدراسي الثاني"
        last_term = "الفصل الدراسي الأول"
        next_term = "العام الجامعي القادم"
        
    elif today_date >= next_year_start:
        current_term = "العام الجامعي القادم"
        last_term = "الفصل الدراسي الثاني"
        next_term = "غير متوفر (لم يُحدد بعد)"
        
    else:  # الفترة بين الفصول (إجازات)
        # إذا كان قبل الفصل الأول
        if today_date < term1_start:
            current_term = "إجازة صيفية (قبل بداية العام)"
            last_term = "العام الماضي"
            next_term = "الفصل الدراسي الأول"
        # إذا كان بين الفصل الأول والثاني
        elif term1_end < today_date < term2_start:
            current_term = "إجازة منتصف العام"
            last_term = "الفصل الدراسي الأول"
            next_term = "الفصل الدراسي الثاني"
        # إذا كان بين الفصل الثاني والعام القادم
        else:  # term2_end < today_date < next_year_start
            current_term = "إجازة نهاية العام"
            last_term = "الفصل الدراسي الثاني"
            next_term = "العام الجامعي القادم"

    dynamic_description = f"""استخدم هذه الأداة للبحث في التقويم الأكاديمي لجامعة أم القرى.
[معلومات سياقية هامة جداً]:
- تاريخ اليوم الفعلي هو: {current_date_str}.
- نحن الآن فعلياً في: "{current_term}".
- الفصل الماضي هو: "{last_term}".
- الفصل القادم هو: "{next_term}".

[قواعد الاستخدام]:
استدعِ هذه الأداة فوراً إذا سأل المستخدم بصيغة عامة عن الاختبارات أو الإجازات.
إذا سأل المستخدم عن "الفصل الماضي" أو "الترم الماضي"، مرر القيمة "{last_term}" حرفياً في المتغير query.
إذا سأل عن "الفصل الحالي" أو "الترم الحالي"، مرر القيمة "{current_term}" حرفياً في المتغير query.
إذا سأل عن "الفصل القادم"، مرر القيمة "{next_term}".
"""

    return {
        "type": "function",
        "function": {
            "name": "get_calendar_info",
            "description": dynamic_description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "enum": ["search", "by_type", "by_term", "next_event", "all"],
                        "description": "نوع البحث المطلوب"
                    },
                    "query": {
                        "type": "string",
                        "description": "كلمة البحث أو اسم الفصل الدراسي الصريح"
                    },
                    "event_type": {
                        "type": "string",
                        "enum": ["exam", "holiday", "academic", "system"]
                    }
                },
                "required": ["query_type"]
            }
        }
    }
TOOLS_SCHEMA: list[dict] = [

    # ── 0. Emit Client Action ─────────────────────────────────────
    # The agent's hook into the frontend stores. Use this whenever the
    # student's words imply a mutation that should reflect immediately
    # on the Dashboard / GPA Planner / Pomodoro screens — without
    # waiting for a Firestore round-trip. The frontend dispatcher
    # whitelists the `type` values; emitting an unknown type fails.
    {
        "type": "function",
        "function": {
            "name": "emit_client_action",
            "description": (
                "نفّذ إجراءً مباشرًا على واجهة الطالب (تعديل المخزن المحلي). "
                "استخدمها عندما يطلب الطالب تغييراً يجب أن يظهر فوراً على لوحة التحكم/المعدل/البومودورو. "
                "الأنواع المسموح بها: ADD_TASK, TOGGLE_TASK_DONE, UPDATE_TARGET_GPA, "
                "UPDATE_BASIC_PROFILE, UPDATE_PREFERENCES, NAVIGATE, START_POMODORO. "
                "لأي طلب فتح/تشغيل/عرض صفحة ميزة (المعدل، الخطة، اللوحة، القاعات، البومودورو) "
                "استخدم NAVIGATE بالمسار الصحيح (مثل {path: '/pomodoro'}) لإنشاء زر انتقال، "
                "ولا تطرح أسئلة متابعة عن المادة/المدة إلا إذا طلب الطالب جلسة بومودورو مخصصة صراحةً."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "ADD_TASK",
                            "TOGGLE_TASK_DONE",
                            "UPDATE_TARGET_GPA",
                            "UPDATE_BASIC_PROFILE",
                            "UPDATE_PREFERENCES",

                            "NAVIGATE",
                            "START_POMODORO",
                        ],
                        "description": "نوع الإجراء — من القائمة المسموح بها فقط.",
                    },
                    "payload": {
                        "type": "object",
                        "description": (
                            "حمولة الإجراء. مثال لـADD_TASK: "
                            "{title, courseCode, courseName, durationMinutes, suggestedDay, suggestedTime, targetDate, priority}. "
                            "مثال لـUPDATE_TARGET_GPA: {target} على مقياس 4.00."
                        ),
                    },
                },
                "required": ["type", "payload"],
            },
        },
    },

    # ── 1. Add Upcoming Exam ──
    {
        "type": "function",
        "function": {
            "name": "add_upcoming_exam",
            "description": "أضف اختباراً أو كويزاً قادماً للوحة تحكم الطالب. استخدمها عندما يذكر الطالب اختباراً قادماً.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject":     {"type": "string", "description": "اسم المادة (مثل: رياضيات، فيزياء)"},
                    "date":        {"type": "string", "description": "تاريخ الاختبار بصيغة YYYY-MM-DD"},
                    "time":        {"type": "string", "description": "وقت الاختبار مثل 10:00 AM (اختياري)"},
                    "course_code": {"type": "string", "description": "رمز المادة إن عُرف (اختياري)"},
                    "exam_type":   {"type": "string", "enum": ["exam", "quiz", "midterm", "final", "assignment"], "description": "نوع التقييم"},
                    "notes":       {"type": "string", "description": "ملاحظات إضافية (اختياري)"}
                },
                "required": ["subject", "date"]
            }
        }
    },

    # ── 2. Create Study Plan ──
    {
        "type": "function",
        "function": {
            "name": "create_study_plan",
            "description": "أنشئ خطة دراسية أو جدول مراجعة للطالب. يظهر في صفحة الخطة الدراسية.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "عنوان الخطة (مثل: خطة مراجعة الفيزياء)"},
                    "tasks": {
                        "type": "array",
                        "description": "قائمة المهام الدراسية",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title":    {"type": "string", "description": "عنوان المهمة"},
                                "subject":  {"type": "string", "description": "اسم المادة"},
                                "duration": {"type": "number", "description": "المدة بالدقائق"},
                                "date":     {"type": "string", "description": "تاريخ التنفيذ YYYY-MM-DD"},
                                "priority": {"type": "string", "enum": ["high", "medium", "low"], "description": "الأولوية"},
                                "notes":    {"type": "string", "description": "تفاصيل المهمة"}
                            },
                            "required": ["title", "subject"]
                        }
                    },
                    "deadline": {"type": "string", "description": "الموعد النهائي للخطة YYYY-MM-DD"}
                },
                "required": ["title", "tasks"]
            }
        }
    },

    # ── 3. Send Notification ──
    {
        "type": "function",
        "function": {
            "name": "send_notification",
            "description": "أرسل إشعاراً أو رسالة تحفيزية للطالب في قائمة التنبيهات.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "نص الرسالة"},
                    "type":    {"type": "string", "enum": ["motivational", "reminder", "warning", "info", "achievement"], "description": "نوع الإشعار"},
                    "title":   {"type": "string", "description": "عنوان الإشعار"}
                },
                "required": ["message", "type"]
            }
        }
    },

    # ── 4. Get Student Data ──
    {
        "type": "function",
        "function": {
            "name": "get_student_data",
            "description": "اقرأ بيانات الطالب الأكاديمية الكاملة: المعدل، المواد، السجل، الأهداف، نمط المذاكرة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "enum": ["all", "profile", "transcript", "exams", "study_plan", "preferences"],
                        "description": "القسم المطلوب"
                    }
                },
                "required": ["section"]
            }
        }
    },

    # ── 5. Analyze Transcript ──
    {
        "type": "function",
        "function": {
            "name": "analyze_transcript",
            "description": "حلّل السجل الأكاديمي للطالب واستخرج نقاط القوة والضعف والتوصيات.",
            "parameters": {
                "type": "object",
                "properties": {
                    "focus": {
                        "type": "string",
                        "enum": ["full", "weaknesses", "strengths", "gpa_trend", "recommendations"],
                        "description": "نوع التحليل المطلوب"
                    }
                },
                "required": ["focus"]
            }
        }
    },

    # ── 6. Update Profile ──
    {
        "type": "function",
        "function": {
            "name": "update_profile",
            "description": "حدّث بيانات الملف الشخصي للطالب (الهدف الأكاديمي، التخصص، الاسم، المعدل).",
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "description": "اسم الحقل: name, major, level, currentGpa, targetGpa, earnedHours"},
                    "value": {"description": "القيمة الجديدة"}
                },
                "required": ["field", "value"]
            }
        }
    },

    # ── 7. Get Upcoming Exams ──
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_exams",
            "description": "احصل على قائمة الاختبارات القادمة المسجلة للطالب.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "number", "description": "عدد الاختبارات المطلوبة (افتراضي 10)"}
                }
            }
        }
    },

    # ── 8. Add Course ──
    {
        "type": "function",
        "function": {
            "name": "add_course",
            "description": "أضف مادة جديدة لقائمة مواد الفصل الحالي.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":         {"type": "string", "description": "اسم المادة"},
                    "code":         {"type": "string", "description": "رمز المادة"},
                    "credit_hours": {"type": "number", "description": "عدد الساعات المعتمدة"},
                    "difficulty":   {"type": "string", "enum": ["easy", "medium", "hard"], "description": "درجة الصعوبة"}
                },
                "required": ["name"]
            }
        }
    },

    # ── 9. Complete Task ──
    {
        "type": "function",
        "function": {
            "name": "complete_task",
            "description": "ضع علامة إنجاز على مهمة في خطة الدراسة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id":   {"type": "string", "description": "معرّف المهمة"},
                    "task_name": {"type": "string", "description": "اسم المهمة (إذا لم تعرف المعرّف)"}
                }
            }
        }
    },

    # ═══════════════════════════════════════════
    #  NEW SUPER-AGENT TOOLS (v2.0)
    # ═══════════════════════════════════════════

    # ── 10. Modify Study Session (Plan Surgery) ──
    {
        "type": "function",
        "function": {
            "name": "modify_study_session",
            "description": "عدّل جلسة أو مهمة في الخطة الدراسية الحالية. استخدمها لتغيير الموعد أو المدة أو المادة بناءً على ضغط الاختبارات أو طلب الطالب. مثلاً: نقل جلسة من يوم لآخر أو تمديد المراجعة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "معرّف المهمة المراد تعديلها (اختياري إذا أعطيت الاسم)"
                    },
                    "task_name": {
                        "type": "string",
                        "description": "اسم المهمة أو جزء منه للبحث عنها"
                    },
                    "new_date": {
                        "type": "string",
                        "description": "التاريخ الجديد YYYY-MM-DD"
                    },
                    "new_time": {
                        "type": "string",
                        "description": "الوقت الجديد مثل 18:00"
                    },
                    "new_duration": {
                        "type": "number",
                        "description": "المدة الجديدة بالدقائق"
                    },
                    "new_subject": {
                        "type": "string",
                        "description": "تغيير المادة"
                    },
                    "new_priority": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                        "description": "تغيير الأولوية"
                    },
                    "reason": {
                        "type": "string",
                        "description": "سبب التعديل (يظهر في سجل التغييرات)"
                    }
                }
            }
        }
    },

    # ── 11. Predict GPA Pathway (GPA Strategy) ──
    {
        "type": "function",
        "function": {
            "name": "predict_gpa_pathway",
            "description": "احسب المسار الدقيق للوصول للمعدل المستهدف. يقرأ السجل الأكاديمي ومواد الفصل الحالي ويخبر الطالب بالتحديد ما الدرجات التي يحتاجها في كل مادة. استخدمها عند سؤال: 'أحتاج معدل 3.5 وش الدرجات المطلوبة؟' أو 'كيف أوصل معدلي لـ 4؟'",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_gpa": {
                        "type": "number",
                        "description": "المعدل المستهدف من 4.00 (اختياري — يؤخذ من هدف الطالب المحفوظ إذا لم يُحدد)"
                    },
                    "scenario": {
                        "type": "string",
                        "enum": ["minimum", "balanced", "ambitious"],
                        "description": "نوع السيناريو: minimum=أقل درجات ممكنة, balanced=متوازن, ambitious=الأفضل"
                    }
                }
            }
        }
    },

    # ── 12. Update Learning Preferences (Profile Evolution) ──
    {
        "type": "function",
        "function": {
            "name": "update_learning_preferences",
            "description": "حدّث تفضيلات أسلوب التعلم للطالب. استخدمها عندما يذكر الطالب تغييراً في نمط مذاكرته أو عندما تلاحظ أنه بحاجة لتعديل (مثل: طالب متوتر ← اقترح تبطيء السرعة). هذه تختلف عن update_profile — هذه خاصة بأسلوب التعلم فقط.",
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "enum": ["best_time", "study_hours", "method", "focus_length", "study_speed", "stress_level"],
                        "description": "الحقل: best_time(صباحي/مسائي/ليلي), study_hours(ساعات يوم), method(أسلوب), focus_length(دقائق التركيز), study_speed(slow/normal/fast), stress_level(low/normal/high/critical)"
                    },
                    "value": {
                        "type": "string",
                        "description": "القيمة الجديدة"
                    },
                    "reason": {
                        "type": "string",
                        "description": "سبب التغيير (لعرضه على الطالب)"
                    }
                },
                "required": ["field", "value"]
            }
        }
    },

    # ── 13. Generate Semester Master Plan (Personalized Planner) ──
    {
        "type": "function",
        "function": {
            "name": "generate_semester_master_plan",
            "description": "أنشئ خطة فصلية شاملة ومخصصة بالكامل للطالب. هذه ليست خطة عادية — هي خطة ذكية تقرأ: أسلوب التعلم (وقت الذروة، سرعة المذاكرة، مدة التركيز، مستوى التوتر)، نتائج السجل الأكاديمي (المواد الضعيفة تأخذ وقت أكثر)، وتواريخ الاختبارات. استخدمها عندما يطلب الطالب 'سوّ لي جدول فصلي' أو 'خطط لي الفصل كامل' أو 'نظّم مذاكرتي'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "weeks": {
                        "type": "number",
                        "description": "عدد أسابيع الخطة (افتراضي: 16 أسبوع = فصل كامل)"
                    },
                    "daily_hours": {
                        "type": "number",
                        "description": "ساعات الدراسة اليومية (يؤخذ من الملف الشخصي إذا لم يُحدد)"
                    },
                    "include_weekends": {
                        "type": "boolean",
                        "description": "تضمين عطلة نهاية الأسبوع (الجمعة/السبت)"
                    },
                    "focus_mode": {
                        "type": "string",
                        "enum": ["balanced", "exam_focused", "weakness_recovery", "gpa_boost"],
                        "description": "نمط التركيز: balanced=متوازن, exam_focused=تركيز على الاختبارات القريبة, weakness_recovery=تقوية الضعف, gpa_boost=رفع المعدل"
                    }
                }
            }
        }
    },

    # ── 14. Navigate to Page ──
    {
        "type": "function",
        "function": {
            "name": "navigate_to_page",
            "description": "انتقل بالطالب إلى صفحة محددة في التطبيق. استخدمها عندما يطلب فتح صفحة: المعدل، الخطة، البومودورو، القاعات، الملف الشخصي، أو اللوحة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {
                        "type": "string",
                        "enum": ["dashboard", "gpa", "plan", "pomodoro", "locations", "profile", "chat"],
                        "description": "dashboard=اللوحة, gpa=المعدل, plan=الخطة, pomodoro=بومودورو, locations=القاعات, profile=الملف الشخصي, chat=الدردشة"
                    }
                },
                "required": ["page"]
            }
        }
    },

    # ── 15. Change Theme ──
    {
        "type": "function",
        "function": {
            "name": "change_theme",
            "description": "غيّر مظهر التطبيق بين الوضع الليلي والنهاري. استخدمها عندما يطلب الطالب تغيير المظهر.",
            "parameters": {
                "type": "object",
                "properties": {
                    "theme": {
                        "type": "string",
                        "enum": ["dark", "light", "auto"],
                        "description": "dark=ليلي, light=نهاري, auto=تلقائي"
                    }
                },
                "required": ["theme"]
            }
        }
    },

    # ── 16. Get GPA History ──
    {
        "type": "function",
        "function": {
            "name": "get_gpa_history",
            "description": "احصل على تاريخ المعدل التراكمي عبر الفصول الدراسية. استخدمها عند سؤال الطالب عن مسار معدله أو تطوره عبر الفصول.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "number",
                        "description": "عدد الفصول المطلوبة (افتراضي 20)"
                    }
                }
            }
        }
    },

    # ── 17. Add Semester GPA ──
    {
        "type": "function",
        "function": {
            "name": "add_semester_gpa",
            "description": "سجّل معدل فصل دراسي في السجل الأكاديمي. استخدمها عندما يخبرك الطالب بمعدله في فصل معين.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":  {"type": "string", "description": "اسم الفصل (مثل: الفصل الأول 1446)"},
                    "gpa":   {"type": "number", "description": "المعدل التراكمي للفصل (من 4.00)"},
                    "hours": {"type": "number", "description": "الساعات المعتمدة في هذا الفصل (اختياري)"}
                },
                "required": ["name", "gpa"]
            }
        }
    },

    # ── 18. Update Course Grade ──
    {
        "type": "function",
        "function": {
            "name": "update_course_grade",
            "description": "حدّث درجة مادة في قائمة مواد الفصل الحالي. استخدمها عندما يخبرك الطالب بدرجته في مادة.",
            "parameters": {
                "type": "object",
                "properties": {
                    "course_name": {"type": "string", "description": "اسم المادة"},
                    "grade":       {"type": "number", "description": "الدرجة الجديدة (من 4.00 على مقياس النقاط)"}
                },
                "required": ["course_name", "grade"]
            }
        }
    },

    # ── 19. Get Course Info (read-only catalog lookup) ──
    {
        "type": "function",
        "function": {
            "name": "get_course_info",
            "description": (
                "ابحث عن معلومات مادة مسجَّلة في كتالوج المواد بقاعدة البيانات (Firestore) "
                "عبر رمز المادة أو اسمها بالعربي أو الإنجليزي. استخدمها فوراً عندما يسأل الطالب "
                "عن مادة محددة: تفاصيلها، المشروع، الاختبار النصفي (الميد)، النهائي (الفاينل)، "
                "تواريخ الاختبارات، توزيع الدرجات، أو أي معلومة عن المادة. "
                "هذه الأداة للقراءة فقط ولا تعدّل أي بيانات. "
                "⚠️ لا تجب أبداً عن معلومات مادة من معرفتك العامة — هذه الأداة هي المصدر الوحيد الموثوق. "
                "إذا لم تُرجع الأداة المادة (found=false) فلا تخترع أي تفاصيل."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "رمز المادة (مثل CS4510) أو اسم المادة بالعربي (مثل: مواضيع مختارة 2) "
                            "أو بالإنجليزي. يقبل المطابقة الجزئية للاسم."
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    },

    get_dynamic_calendar_tool()

]