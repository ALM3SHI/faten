from datetime import datetime, date
import math
from typing import List, Dict, Any

def generate_smart_notifications(profile: Dict[str, Any], session_name: str) -> List[Dict[str, Any]]:
    today = datetime.now()
    new_notifs = []

    courses = profile.get("courses", [])
    # profile is the full uqu_profile_v2 object: nested under "goals"
    goals = profile.get("goals") or {}
    gpa    = goals.get("currentGpa") or profile.get("gpaNow")
    target = goals.get("targetGpa")  or profile.get("gpaTarget")
    
    # 1. Welcome notification logic handled by frontend for first-time or backend can suggest
    # But usually welcome is a one-time event. I'll include it if it's missing in frontend's check.
    # Actually, let's stick to what's in notifications.js
    
    # 2. Exam alerts
    for course in courses:
        exam_date_str = course.get("examDate")
        course_name = course.get("name")
        if not exam_date_str or not course_name:
            continue
            
        try:
            exam_date = datetime.strptime(exam_date_str, "%Y-%m-%d")
            diff_days = (exam_date - today.replace(hour=0, minute=0, second=0, microsecond=0)).days
        except:
            continue

        if 0 <= diff_days <= 14:
            nid = f"exam_{course_name}_{exam_date_str}"
            
            notif_type = "info"
            icon = "📅"
            urgency = ""
            
            if diff_days <= 1:
                notif_type = "danger"
                icon = "🚨"
                urgency = "غداً!" if diff_days == 1 else "اليوم!"
            elif diff_days <= 3:
                notif_type = "warning"
                icon = "⚠️"
                urgency = f"بعد {diff_days} أيام"
            elif diff_days <= 7:
                notif_type = "info"
                icon = "📅"
                urgency = f"بعد {diff_days} أيام"
            else:
                notif_type = "info"
                icon = "🗓️"
                urgency = f"بعد {diff_days} يوماً"

            new_notifs.append({
                "id": nid,
                "type": notif_type,
                "icon": icon,
                "title": f"اختبار: {course_name}",
                "body": f"موعد الاختبار {urgency} — {exam_date_str}",
                "time": today.isoformat(),
                "read": False,
                "link": "plan.html",
                "linkText": "عرض خطة المذاكرة",
                "examDate": exam_date_str,
                "courseName": course_name
            })

    # 3. Profile incomplete
    if not profile or not profile.get("courses"):
        new_notifs.append({
            "id": "profile_incomplete",
            "type": "warning",
            "icon": "📋",
            "title": "بروفايلك الأكاديمي غير مكتمل",
            "body": "أكمل بروفايلك لتفعيل الخطط والتوصيات الذكية.",
            "time": today.isoformat(),
            "read": False,
            "link": "profile.html",
            "linkText": "إكمال البروفايل"
        })

    # 4. GPA motivation
    try:
        gpa_val = float(gpa) if gpa else 0
        target_val = float(target) if target else 0
        if gpa_val > 0 and target_val > 0:
            diff = target_val - gpa_val
            if 0 < diff <= 0.5:
                new_notifs.append({
                    "id": "gpa_motivation",
                    "type": "success",
                    "icon": "🎯",
                    "title": "أنت قريب جداً من هدفك!",
                    "body": f"معدلك الحالي {gpa_val:.2f} والهدف {target_val:.2f} — فرق {diff:.2f} فقط!",
                    "time": today.isoformat(),
                    "read": False
                })
    except:
        pass

    # 5. Daily motivational
    messages = [
        {"title": "صباح التميز 🌅", "body": "كل يوم هو فرصة جديدة للتفوق. ابدأ يومك بخطوة نحو هدفك."},
        {"title": "أنت تستطيع! 💪", "body": "الاجتهاد اليوم هو نجاح الغد. لا تستسلم أبداً."},
        {"title": "ذاكر بذكاء 🧠", "body": "استخدم خطة المذاكرة الذكية لتحسين كفاءتك الدراسية."},
        {"title": "تذكر هدفك 🎯", "body": "ضع هدفك نصب عينيك وامضِ قُدُماً. أنت أقرب مما تتصور."},
        {"title": "استراحة ضرورية 😴", "body": "النوم الكافي يحسن الذاكرة والتركيز. حافظ على صحتك."},
    ]
    weekday = today.weekday() # Monday is 0, Sunday is 6
    # JS getDay() returns 0 for Sunday, 1 for Monday...
    # Python weekday() returns 0 for Monday, 6 for Sunday
    # Let's adjust to match JS or just use it.
    js_day = (weekday + 1) % 7
    msg = messages[js_day % len(messages)]
    
    new_notifs.append({
        "id": f"daily_{today.strftime('%Y-%m-%d')}",
        "type": "info",
        "icon": "✨",
        "title": msg["title"],
        "body": msg["body"],
        "time": today.isoformat(),
        "read": False,
        "daily": True
    })

    return new_notifs
