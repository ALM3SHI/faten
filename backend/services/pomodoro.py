import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any


def fetch_completed_sessions_sync(user_id: str, db) -> List[Dict[str, Any]]:
    """Load all completed_sessions docs for a user (includes document id)."""
    sessions: List[Dict[str, Any]] = []
    coll = db.collection("users").document(user_id).collection("completed_sessions")
    for doc in coll.stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        sessions.append(data)
    return sessions


def _normalize_session_record(raw: dict) -> dict:
    """Shape a Firestore session for PomodoroSession schema."""
    return {
        "id": raw.get("id") or "",
        "courseCode": raw.get("courseCode") or "",
        "courseName": raw.get("courseName") or "مذاكرة عامة",
        "duration": int(raw.get("duration") or 0),
        "type": raw.get("type") or "focus",
        "date": raw.get("date") or "",
        "completedAt": raw.get("completedAt") or "",
    }


def get_pomodoro_stats_sync(user_id: str, db) -> dict:
    """Blocking read + stats for GET /api/pomodoro/stats."""
    sessions = fetch_completed_sessions_sync(user_id, db)
    stats = calculate_pomodoro_stats(sessions)
    stats["recentSessions"] = [
        _normalize_session_record(s) for s in stats.get("recentSessions") or []
    ]
    return stats


async def get_pomodoro_stats(user_id: str, db) -> dict:
    """Async wrapper — runs blocking Firestore read in the default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_pomodoro_stats_sync, user_id, db)


def calculate_pomodoro_stats(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Filter focus sessions only
    focus_sessions = [s for s in sessions if s.get("type") == "focus"]
    
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # 1. Today's stats
    today_sessions = [s for s in focus_sessions if s.get("date") == today_str]
    today_count = len(today_sessions)
    today_minutes = sum(s.get("duration", 0) for s in today_sessions)
    
    # 2. Total stats
    total_sessions = len(focus_sessions)
    total_minutes = sum(s.get("duration", 0) for s in focus_sessions)
    total_hours = round(total_minutes / 60.0, 2)
    
    # 3. Best Day
    by_day = {}
    for s in focus_sessions:
        d = s.get("date")
        if d:
            by_day[d] = by_day.get(d, 0) + 1
    best_day_count = max(by_day.values()) if by_day else 0
    
    # 4. Streaks
    dates_set = sorted(set(s["date"] for s in focus_sessions if s.get("date")), reverse=True)
    current_streak = 0
    if dates_set:
        check_date = datetime.now().date()
        # If the latest session is not today or yesterday, streak is 0
        latest_date = datetime.strptime(dates_set[0], "%Y-%m-%d").date()
        if (check_date - latest_date).days <= 1:
            for i, d_str in enumerate(dates_set):
                d = datetime.strptime(d_str, "%Y-%m-%d").date()
                if i == 0:
                    current_streak = 1
                    last_d = d
                else:
                    if (last_d - d).days == 1:
                        current_streak += 1
                        last_d = d
                    else:
                        break
    
    # Best Streak
    best_streak = 0
    if dates_set:
        all_dates = sorted(set(s["date"] for s in focus_sessions if s.get("date")))
        temp_streak = 1
        best_streak = 1
        for i in range(1, len(all_dates)):
            prev = datetime.strptime(all_dates[i-1], "%Y-%m-%d").date()
            curr = datetime.strptime(all_dates[i], "%Y-%m-%d").date()
            if (curr - prev).days == 1:
                temp_streak += 1
                best_streak = max(best_streak, temp_streak)
            else:
                temp_streak = 1
    
    # 5. Weekly Chart
    weekly_chart = []
    day_names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    # JS getDay(): 0=Sunday, 1=Monday...
    # Python weekday(): 0=Monday, 6=Sunday
    for i in range(6, -1, -1):
        d = datetime.now() - timedelta(days=i)
        d_str = d.strftime("%Y-%m-%d")
        count = len([s for s in focus_sessions if s.get("date") == d_str])
        # Adjusting to match JS day names
        py_weekday = d.weekday()
        js_weekday = (py_weekday + 1) % 7
        weekly_chart.append({
            "label": day_names[js_weekday],
            "count": count,
            "date": d_str
        })
        
    # 6. Course Breakdown
    by_course = {}
    for s in focus_sessions:
        name = s.get("courseName") or "مذاكرة عامة"
        by_course[name] = by_course.get(name, 0) + s.get("duration", 0)
    
    course_breakdown = []
    total_focus_mins = sum(by_course.values())
    if total_focus_mins > 0:
        for name, mins in sorted(by_course.items(), key=lambda x: x[1], reverse=True):
            course_breakdown.append({
                "name": name,
                "duration": mins,
                "percentage": round((mins / total_focus_mins) * 100)
            })
            
    # 7. Recent Sessions
    # Sort by completedAt DESC
    sorted_sessions = sorted(focus_sessions, key=lambda x: x.get("completedAt", ""), reverse=True)
    recent_sessions = sorted_sessions[:10]
    
    return {
        "todaySessions": today_count,
        "todayMinutes": today_minutes,
        "currentStreak": current_streak,
        "bestDayCount": best_day_count,
        "weeklyChart": weekly_chart,
        "courseBreakdown": course_breakdown,
        "recentSessions": recent_sessions,
        "totalSessions": total_sessions,
        "totalMinutes": total_minutes,
        "totalHours": total_hours,
        "bestStreak": best_streak
    }
