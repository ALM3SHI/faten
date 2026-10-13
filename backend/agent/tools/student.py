"""Student profile & UI: student data, profile/preferences updates, courses, notifications, navigation, theme."""

from google.cloud.firestore_v1 import ArrayUnion
from google.cloud.firestore_v1.base_query import FieldFilter

from services.student import (
    academic_record_completed_courses,
    academic_record_current_courses,
    load_academic_record,
)
from services.workspace import (
    study_plan_payload_for_agent,
)

from agent.tools.context import ToolContext
from agent.tools._common import (
    PROFILE_BASIC_FIELDS,
    PROFILE_GOALS_FIELDS,
    apply_learning_preference,
    coerce_profile_field_value,
)


async def _get_student_data(ctx: ToolContext, args: dict) -> dict:
    """4. Get Student Data"""
    user_ref = ctx.user_ref
    section = args.get("section", "all")
    data = {}

    # Read the v3 academic_record once — used for both profile.courses
    # projection and the transcript section.
    record = load_academic_record(user_ref) if section in ("all", "profile", "transcript") else {}

    if section in ("all", "profile"):
        snap = user_ref.get()
        profile_doc = snap.to_dict() if snap.exists else {}
        # Surface current courses from the new schema under the legacy
        # `profile.courses` key the agent expects.
        if record:
            profile_block = profile_doc.setdefault("profile", {})
            cur = academic_record_current_courses(record)
            if cur and not profile_block.get("courses"):
                profile_block["courses"] = cur
            for key in ("gpa", "earnedHours", "planHours"):
                val = record.get(key)
                if val is not None and not profile_block.get(key):
                    profile_block[key] = val
        data["profile"] = profile_doc

    if section in ("all", "transcript"):
        # v3 first
        if record:
            data["transcript"] = {
                "completedCourses": academic_record_completed_courses(record),
                "currentCourses":   academic_record_current_courses(record),
                "gpa":          record.get("gpa"),
                "earnedHours":  record.get("earnedHours"),
                "planHours":    record.get("planHours"),
                "lastUpdated":  record.get("lastUpdated"),
                "source":       "academic_record",
            }
        else:
            snaps = (user_ref.collection("transcripts")
                     .order_by("createdAt", direction="DESCENDING")
                     .limit(1).get())
            docs = list(snaps)
            data["transcript"] = docs[0].to_dict() if docs else None

    if section in ("all", "exams"):
        snaps = (user_ref.collection("exams")
                 .where(filter=FieldFilter("done", "==", False))
                 .order_by("date")
                 .get())
        data["exams"] = [{"id": d.id, **d.to_dict()} for d in snaps]

    if section in ("all", "study_plan"):
        data["study_plan"] = study_plan_payload_for_agent(user_ref)

    if section in ("all", "preferences"):
        snap = user_ref.get()
        doc = snap.to_dict() if snap.exists else {}
        data["preferences"] = doc.get("study_preferences", {})

    return {"success": True, "data": data}


async def _update_profile(ctx: ToolContext, args: dict) -> dict:
    """6. Update Profile"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    field = args["field"]
    value = coerce_profile_field_value(args["field"], args["value"])

    snap = user_ref.get()
    user_data = snap.to_dict() if snap.exists else {}
    basic = dict(user_data.get("basic") or {})
    goals = dict(user_data.get("goals") or {})

    if field in PROFILE_BASIC_FIELDS:
        basic[field] = value
    elif field in PROFILE_GOALS_FIELDS:
        goals[field] = value
    elif field == "earnedHours":
        record_ref = user_ref.collection("academic_record").document("main")
        record_ref.set(
            {"earnedHours": value, "lastUpdated": now_iso},
            merge=True,
        )
    else:
        return {"success": False, "message": f"حقل غير معروف: {field}"}

    if field != "earnedHours":
        user_ref.set(
            {
                "basic": basic,
                "goals": goals,
                "lastUpdated": now_iso,
                "updatedAt": now_iso,
            },
            merge=True,
        )

    return {"success": True, "message": f"تم تحديث {field}"}


async def _add_course(ctx: ToolContext, args: dict) -> dict:
    """8. Add Course"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    # Accept both camelCase (frontend) and snake_case (backend schema).
    credit_hrs = args.get("credit_hours") or args.get("creditHours", 3)
    name_val = args["name"]
    course = {
        # Dual key naming so both the legacy reader (`name`,
        # `credit_hours`) and the v3 enriched-course reader
        # (`nameAr`/`nameEn`, `creditHours`) find the new course.
        "name":         name_val,
        "nameAr":       name_val,
        "nameEn":       args.get("nameEn") or name_val,
        "code":         args.get("code", ""),
        "credit_hours": credit_hrs,
        "creditHours":  credit_hrs,
        "difficulty":   args.get("difficulty", "medium"),
        "examDate":     args.get("examDate") or args.get("exam_date", ""),
        "addedAt":      now_iso,
        "semesterStatus": "current",
    }
    # Write to the v3 schema (users/{uid}/academic_record/main.currentCourses)
    # so the frontend transcript store sees it on next hydration.
    record_ref = user_ref.collection("academic_record").document("main")
    record_ref.set(
        {
            "currentCourses": ArrayUnion([course]),
            "lastUpdated": now_iso,
        },
        merge=True,
    )
    return {"success": True, "message": f"تمت إضافة مادة \"{name_val}\""}


async def _update_learning_preferences(ctx: ToolContext, args: dict) -> dict:
    """12. Update Learning Preferences"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    field = args["field"]
    value = args["value"]
    reason = args.get("reason", "")

    # Validate field names
    valid_fields = {
        "best_time", "study_hours", "method",
        "focus_length", "study_speed", "stress_level",
    }
    if field not in valid_fields:
        return {"success": False, "message": f"حقل غير صالح: {field}"}

    # Convert numeric values
    if field in ("study_hours", "focus_length"):
        try:
            value = int(value)
        except (ValueError, TypeError):
            pass

    snap = user_ref.get()
    user_data = snap.to_dict() if snap.exists else {}
    preferences = apply_learning_preference(
        user_data.get("preferences") or {},
        field,
        value,
    )
    user_ref.set(
        {
            "preferences": preferences,
            "lastUpdated": now_iso,
            "updatedAt": now_iso,
        },
        merge=True,
    )

    # Friendly field names for response
    field_labels = {
        "best_time": "وقت المذاكرة المفضل",
        "study_hours": "ساعات الدراسة اليومية",
        "method": "أسلوب المذاكرة",
        "focus_length": "مدة التركيز",
        "study_speed": "سرعة الدراسة",
        "stress_level": "مستوى التوتر",
    }
    label = field_labels.get(field, field)
    msg = f"✅ تم تحديث {label} إلى: {value}"
    if reason:
        msg += f" (السبب: {reason})"

    return {"success": True, "message": msg}


async def _send_notification(ctx: ToolContext, args: dict) -> dict:
    """3. Send Notification"""
    user_ref = ctx.user_ref
    now_iso = ctx.now_iso
    notif_type = args.get("type", "info")
    default_title = "💪 رسالة تحفيز" if notif_type == "motivational" else "🔔 تنبيه"
    notif = {
        "title":     args.get("title", default_title),
        "message":   args["message"],
        "type":      notif_type,
        "read":      False,
        "createdAt": now_iso,
    }
    user_ref.collection("notifications").add(notif)
    return {"success": True, "message": "تم إرسال الإشعار"}


async def _navigate_to_page(ctx: ToolContext, args: dict) -> dict:
    """14. Navigate to Page (client-only — frontend handles the redirect)"""
    pages = {
        "dashboard": "dashboard.html",
        "gpa":       "gpa.html",
        "plan":      "plan.html",
        "pomodoro":  "pomodoro.html",
        "locations": "locations.html",
        "profile":   "profile.html",
        "chat":      "chat.html",
    }
    page = args.get("page", "dashboard")
    url  = pages.get(page, "dashboard.html")
    labels = {
        "dashboard": "اللوحة", "gpa": "المعدل", "plan": "الخطة",
        "pomodoro": "بومودورو", "locations": "القاعات",
        "profile": "الملف الشخصي", "chat": "الدردشة",
    }
    return {
        "success": True,
        "client_only": True,
        "url": url,
        "page": page,
        "message": f"جارٍ فتح صفحة {labels.get(page, page)}...",
    }


async def _change_theme(ctx: ToolContext, args: dict) -> dict:
    """15. Change Theme (client-only — frontend applies the theme)"""
    theme = args.get("theme", "auto")
    label = {"dark": "الوضع الليلي 🌙", "light": "الوضع النهاري ☀️", "auto": "التلقائي 🌗"}.get(theme, theme)
    return {
        "success": True,
        "client_only": True,
        "theme": theme,
        "message": f"تم التغيير إلى {label}",
    }


HANDLERS = {
    "get_student_data": _get_student_data,
    "update_profile": _update_profile,
    "add_course": _add_course,
    "update_learning_preferences": _update_learning_preferences,
    "send_notification": _send_notification,
    "navigate_to_page": _navigate_to_page,
    "change_theme": _change_theme,
}
