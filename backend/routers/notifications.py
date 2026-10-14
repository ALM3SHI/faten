"""Push-notification devices and preferences for the signed-in student."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user
from db.firestore import get_db
from services import push

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


class DeviceBody(BaseModel):
    token: str = Field(min_length=20, max_length=4096)
    platform: str = Field("web", max_length=20)


class PrefsBody(BaseModel):
    lectures: bool = True
    attendance: bool = True
    exams: bool = True
    reviews: bool = True  # spaced reviews due in the smart study mode


@router.post("/devices")
async def add_device(body: DeviceBody, user_id: str = Depends(get_current_user)) -> dict:
    return {"success": True, "id": push.register_device(get_db(), user_id, body.token, body.platform)}


@router.delete("/devices/{device_id}")
async def delete_device(device_id: str, user_id: str = Depends(get_current_user)) -> dict:
    if not device_id.isalnum() or len(device_id) > 64:
        raise HTTPException(status_code=400, detail="معرّف الجهاز غير صحيح.")
    push.remove_device(get_db(), user_id, device_id)
    return {"success": True}


@router.get("/prefs")
async def get_prefs(user_id: str = Depends(get_current_user)) -> dict:
    return {"success": True, "prefs": push.load_prefs(get_db(), user_id)}


@router.put("/prefs")
async def put_prefs(body: PrefsBody, user_id: str = Depends(get_current_user)) -> dict:
    return {"success": True, "prefs": push.save_prefs(get_db(), user_id, body.model_dump())}


@router.post("/test")
async def send_test(user_id: str = Depends(get_current_user)) -> dict:
    sent = push.send_to_user(
        get_db(),
        user_id,
        [{"key": "test", "title": "✅ إشعارات فطن تعمل", "body": "بنذكّرك بمحاضراتك واختباراتك وحدود الغياب.", "url": "/profile"}],
        dedupe=False,
    )
    if not sent:
        raise HTTPException(status_code=409, detail="ما وصل الإشعار لأي جهاز. فعّل الإشعارات من هذا الجهاز ثم جرّب مرة ثانية.")
    return {"success": True, "sent": sent}
