"""Student data controls: delete account, view/delete agent memory, rate replies."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user
from db.firestore import get_db
from services import memory as mem
from services.account import delete_account
from services.feedback import save_feedback

router = APIRouter(tags=["Account"])


class DeleteAccountBody(BaseModel):
    confirm: Literal["حذف"]


@router.delete("/api/account")
async def delete_my_account(body: DeleteAccountBody, user_id: str = Depends(get_current_user)):
    return delete_account(user_id)


@router.get("/api/memory")
async def get_memory(user_id: str = Depends(get_current_user)):
    return {"items": mem.load_items(get_db(), user_id)}


@router.delete("/api/memory/{item_id}")
async def delete_memory_item(item_id: str, user_id: str = Depends(get_current_user)):
    return mem.forget(get_db(), user_id, item_id=item_id)


@router.delete("/api/memory")
async def clear_memory(user_id: str = Depends(get_current_user)):
    return mem.forget(get_db(), user_id)


class FeedbackBody(BaseModel):
    rating: Literal["up", "down"] | None
    question: str = Field("", max_length=2000)
    answer: str = Field("", max_length=20000)
    comment: str = Field("", max_length=1000)
    conversationId: str | None = Field(None, max_length=100)
    tools: list[str] = Field(default_factory=list, max_length=20)


@router.post("/api/feedback")
async def rate_reply(body: FeedbackBody, user_id: str = Depends(get_current_user)):
    try:
        return save_feedback(get_db(), user_id, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
