from fastapi import APIRouter, Depends
from typing import List
from schemas.notifications import SmartNotificationsResponse, NotificationItem
from services.notifications import generate_smart_notifications
from schemas.profile import AcademicProfile
from auth.dependencies import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])

@router.post("/smart", response_model=SmartNotificationsResponse)
async def get_smart_notifications(profile: AcademicProfile, user_id: str = Depends(get_current_user)):
    """
    Generate smart notifications based on user profile and current date.
    """
    # For now we use a generic name or could fetch from student profile if needed
    session_name = "الطالب"
    notifs_data = generate_smart_notifications(profile.model_dump(), session_name)
    
    notifications = [NotificationItem(**n) for n in notifs_data]
    return SmartNotificationsResponse(notifications=notifications)
