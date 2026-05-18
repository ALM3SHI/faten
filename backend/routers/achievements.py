"""
================================================================
UQU Academic Assistant — Achievements Router
================================================================
Complete achievements backend: badge calculation, XP tracking,
metrics collection, and level progression. Replaces client-side
computation from assets/achievements.js with authoritative
server-side logic.

Endpoints:
  POST   /api/achievements/sync       — Save state to Firestore
  GET    /api/achievements/data       — Get user's achievements data
  POST   /api/achievements/check      — Compute metrics & check new badges
  POST   /api/achievements/add-xp     — Add XP for an action
"""

import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import firestore as fb_firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from auth.bearer import verify_firebase_token
from db.firestore import get_db
from schemas.achievements import (
    AchievementsState, AchievementsResponse, AchievementsData,
    CheckBadgesRequest, AddXPRequest
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/achievements", tags=["Achievements"])

# Badge definitions (mirrors assets/achievements.js)
BADGES = [
    {"id": "first_session", "category": "study", "condition": lambda m: m["totalSessions"] >= 1},
    {"id": "sessions_10", "category": "study", "condition": lambda m: m["totalSessions"] >= 10},
    {"id": "sessions_50", "category": "study", "condition": lambda m: m["totalSessions"] >= 50},
    {"id": "sessions_100", "category": "study", "condition": lambda m: m["totalSessions"] >= 100},
    {"id": "hours_10", "category": "study", "condition": lambda m: m["totalMinutes"] >= 600},
    {"id": "hours_50", "category": "study", "condition": lambda m: m["totalMinutes"] >= 3000},
    {"id": "streak_3", "category": "streak", "condition": lambda m: m["bestStreak"] >= 3},
    {"id": "streak_7", "category": "streak", "condition": lambda m: m["bestStreak"] >= 7},
    {"id": "streak_30", "category": "streak", "condition": lambda m: m["bestStreak"] >= 30},
    {"id": "gpa_set", "category": "gpa", "condition": lambda m: m["hasTarget"]},
    {"id": "gpa_improve", "category": "gpa", "condition": lambda m: m["gpaImprovement"] >= 0.25},
    {"id": "plan_created", "category": "plan", "condition": lambda m: m["hasPlan"]},
    {"id": "plan_5_tasks", "category": "plan", "condition": lambda m: m["completedTasks"] >= 5},
    {"id": "chat_first", "category": "chat", "condition": lambda m: m["chatMessages"] >= 1},
    {"id": "chat_20", "category": "chat", "condition": lambda m: m["chatMessages"] >= 20},
    {"id": "profile_complete", "category": "profile", "condition": lambda m: m["profileComplete"]},
    {"id": "courses_added", "category": "profile", "condition": lambda m: m["coursesCount"] >= 3},
]

XP_REWARDS = {
    "pomodoroComplete": 15,
    "badgeUnlocked": 50,
    "goalComplete": 30,
    "chatMessage": 2,
    "planGenerated": 25,
    "gradeRecorded": 20,
    "dailyLogin": 10,
}

LEVELS = [
    {"level": 1, "title": "مستجد", "xpNeeded": 0},
    {"level": 2, "title": "مبتدئ", "xpNeeded": 100},
    {"level": 3, "title": "نشيط", "xpNeeded": 250},
    {"level": 4, "title": "مجتهد", "xpNeeded": 500},
    {"level": 5, "title": "متقدم", "xpNeeded": 800},
    {"level": 6, "title": "متميز", "xpNeeded": 1200},
    {"level": 7, "title": "خبير", "xpNeeded": 1800},
    {"level": 8, "title": "أسطورة", "xpNeeded": 2500},
    {"level": 9, "title": "عبقري", "xpNeeded": 3500},
    {"level": 10, "title": "أيقونة أكاديمية", "xpNeeded": 5000},
]


def _collect_metrics(db, user_id: str) -> dict:
    """Collect user metrics from Firestore for badge evaluation."""
    metrics = {
        "totalSessions": 0,
        "totalMinutes": 0,
        "bestStreak": 0,
        "hasTarget": False,
        "gpaImprovement": 0,
        "hasPlan": False,
        "completedTasks": 0,
        "chatMessages": 0,
        "profileComplete": False,
        "coursesCount": 0,
    }
    
    try:
        # Pomodoro sessions
        sessions_docs = (
            db.collection("users").document(user_id)
            .collection("completed_sessions").stream()
        )
        focus_sessions = []
        for doc in sessions_docs:
            if doc.get("type") == "focus":
                focus_sessions.append(doc.to_dict())
        
        metrics["totalSessions"] = len(focus_sessions)
        metrics["totalMinutes"] = sum(s.get("duration", 0) for s in focus_sessions)
        
        # Compute streak
        if focus_sessions:
            dates = sorted(set(s.get("date", "") for s in focus_sessions if s.get("date")))
            streak, best = 1, 1
            for i in range(1, len(dates)):
                from datetime import datetime
                prev = datetime.strptime(dates[i-1], "%Y-%m-%d")
                curr = datetime.strptime(dates[i], "%Y-%m-%d")
                if (curr - prev).days == 1:
                    streak += 1
                    best = max(best, streak)
                else:
                    streak = 1
            metrics["bestStreak"] = best
    except:
        pass
    
    try:
        # Profile data — Firestore stores flat fields under "profile", not nested basic/goals
        user_doc = db.collection("users").document(user_id).get()
        if user_doc.exists:
            profile = user_doc.to_dict().get("profile") or {}
            courses = profile.get("courses") or []

            metrics["coursesCount"] = len(courses)
            metrics["hasTarget"] = bool(profile.get("targetGpa"))
            metrics["profileComplete"] = bool(
                profile.get("name") and profile.get("major") and
                profile.get("level") and profile.get("currentGpa") and len(courses) >= 1
            )

            if profile.get("currentGpa") and profile.get("initialGpa"):
                try:
                    metrics["gpaImprovement"] = float(profile["currentGpa"]) - float(profile["initialGpa"])
                except Exception:
                    pass
    except Exception:
        pass

    try:
        # Plan data — stored in study_plans sub-collection, not as a user doc field
        plan_docs = (
            db.collection("users").document(user_id)
            .collection("study_plans")
            .where(filter=FieldFilter("active", "==", True))
            .limit(1)
            .stream()
        )
        for plan_doc in plan_docs:
            plan_data = plan_doc.to_dict() or {}
            plan_list = plan_data.get("plan") or plan_data.get("tasks") or []
            metrics["hasPlan"] = len(plan_list) > 0
            metrics["completedTasks"] = sum(
                1 for t in plan_list if t.get("done") or t.get("completed")
            )
            break
    except Exception:
        pass

    try:
        # Chat data — messages are embedded in chat_history documents under "messages" array
        chat_docs = (
            db.collection("users").document(user_id)
            .collection("chat_history")
            .stream()
        )
        msg_count = 0
        for conv_doc in chat_docs:
            conv_data = conv_doc.to_dict() or {}
            msgs = conv_data.get("messages") or []
            msg_count += sum(1 for m in msgs if m.get("role") == "user")
        metrics["chatMessages"] = msg_count
    except Exception:
        pass
    
    return metrics


def _get_level(xp: int) -> dict:
    """Compute level info from XP."""
    current = LEVELS[0]
    for lv in LEVELS:
        if xp >= lv["xpNeeded"]:
            current = lv
        else:
            break
    
    next_lv = None
    for lv in LEVELS:
        if lv["level"] == current["level"] + 1:
            next_lv = lv
            break
    
    xp_in_level = xp - current["xpNeeded"]
    xp_for_next = (next_lv["xpNeeded"] - current["xpNeeded"]) if next_lv else 1
    
    return {
        **current,
        "xpInLevel": xp_in_level,
        "xpForNext": xp_for_next,
        "progress": xp_in_level / xp_for_next if next_lv else 1.0,
        "nextTitle": next_lv["title"] if next_lv else "الحد الأقصى",
    }


@router.post("/sync", response_model=AchievementsResponse)
async def sync_achievements(
    body: AchievementsState,
    user_id: str = Depends(verify_firebase_token),
) -> AchievementsResponse:
    """Persist achievements state to Firestore."""
    db = get_db()
    try:
        payload = body.model_dump()
        payload["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        
        ref = db.collection("users").document(user_id).collection("achievements").document("state")
        ref.set(payload, merge=True)
        return AchievementsResponse(success=True)
    except Exception as e:
        logger.error(f"sync_achievements failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل مزامنة الإنجازات",
        )


@router.get("/data", response_model=AchievementsData)
async def get_achievements_data(
    user_id: str = Depends(verify_firebase_token),
) -> AchievementsData:
    """Fetch user's achievements data from Firestore."""
    db = get_db()
    try:
        ref = db.collection("users").document(user_id).collection("achievements").document("state")
        doc = ref.get()
        
        if doc.exists:
            data = doc.to_dict()
            xp = data.get("xp", 0)
            unlocked = data.get("unlockedBadges", [])
            goals = data.get("goals", [])
            level_info = _get_level(xp)
            
            return AchievementsData(
                xp=xp,
                unlockedBadges=unlocked,
                goals=goals,
                level=level_info["level"],
                levelTitle=level_info["title"],
                xpInLevel=level_info["xpInLevel"],
                xpForNext=level_info["xpForNext"],
                progress=level_info["progress"],
            )
        else:
            # New user
            return AchievementsData(
                xp=0, unlockedBadges=[], goals=[],
                level=1, levelTitle="مستجد",
                xpInLevel=0, xpForNext=100, progress=0,
            )
    except Exception as e:
        logger.error(f"get_achievements_data failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل جلب بيانات الإنجازات",
        )


@router.post("/check")
async def check_badges(
    body: CheckBadgesRequest,
    user_id: str = Depends(verify_firebase_token),
) -> dict:
    """Compute metrics and check for newly unlocked badges."""
    db = get_db()
    try:
        metrics = _collect_metrics(db, user_id)

        # Get current achievements — use to_dict() so we can call dict.get() with defaults.
        # DocumentSnapshot.get(field, default) is NOT supported by the Firestore Python SDK;
        # calling it with two args raises TypeError.
        ref = db.collection("users").document(user_id).collection("achievements").document("state")
        doc = ref.get()
        data = doc.to_dict() or {} if doc.exists else {}
        current_xp = data.get("xp") or 0
        unlocked = list(data.get("unlockedBadges") or [])

        new_badges = []
        for badge in BADGES:
            if badge["id"] in unlocked:
                continue
            try:
                if badge["condition"](metrics):
                    new_badges.append(badge["id"])
                    unlocked.append(badge["id"])
                    current_xp += XP_REWARDS["badgeUnlocked"]
            except Exception:
                pass

        # Persist updated state
        if new_badges:
            ref.set({
                "unlockedBadges": unlocked,
                "xp": current_xp,
                "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }, merge=True)

        return {
            "newBadges": new_badges,
            "totalXP": current_xp,
            "metrics": metrics,
        }
    except Exception as e:
        logger.error(f"check_badges failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل فحص الشارات",
        )


@router.post("/add-xp")
async def add_xp(
    body: AddXPRequest,
    user_id: str = Depends(verify_firebase_token),
) -> dict:
    """Add XP to the user's total for a specific action."""
    db = get_db()
    try:
        amount = XP_REWARDS.get(body.reason, body.amount or 0)
        if amount <= 0:
            raise ValueError("Invalid XP amount")

        ref = db.collection("users").document(user_id).collection("achievements").document("state")
        doc = ref.get()
        data = doc.to_dict() or {} if doc.exists else {}
        current_xp = (data.get("xp") or 0) + amount

        ref.set({
            "xp": current_xp,
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }, merge=True)

        return {
            "success": True,
            "xpAdded": amount,
            "totalXP": current_xp,
            "level": _get_level(current_xp),
        }
    except Exception as e:
        logger.error(f"add_xp failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="فشل إضافة XP",
        )
