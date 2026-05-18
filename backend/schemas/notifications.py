from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

class NotificationItem(BaseModel):
    id: str
    type: str  # success, info, warning, danger
    icon: str
    title: str
    body: str
    time: str
    read: bool = False
    link: Optional[str] = None
    linkText: Optional[str] = None
    examDate: Optional[str] = None
    courseName: Optional[str] = None
    daily: bool = False

class SmartNotificationsResponse(BaseModel):
    notifications: List[NotificationItem]
