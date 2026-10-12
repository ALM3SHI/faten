"""
================================================================
UQU Academic Assistant — Community (course reviews) API
================================================================
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user
from services import community

router = APIRouter(prefix="/api/community", tags=["Community"])


class ReviewIn(BaseModel):
    difficulty: int = Field(ge=1, le=5)
    workload: int = Field(ge=1, le=5)
    usefulness: int = Field(ge=1, le=5)
    recommend: bool
    tip: str = Field(default="", max_length=600)
    semester: str = Field(default="", max_length=40)


@router.get("/courses")
async def list_courses(q: str = "", user_id: str = Depends(get_current_user)) -> dict:
    return {"courses": community.list_courses(q)}


@router.get("/courses/{code}")
async def get_course(code: str, user_id: str = Depends(get_current_user)) -> dict:
    return community.get_course(user_id, code)


@router.put("/courses/{code}/review")
async def upsert_review(code: str, body: ReviewIn, user_id: str = Depends(get_current_user)) -> dict:
    return community.upsert_review(user_id, code, body.model_dump())


@router.delete("/courses/{code}/review")
async def delete_review(code: str, user_id: str = Depends(get_current_user)) -> dict:
    return community.delete_review(user_id, code)


@router.post("/courses/{code}/reviews/{rid}/report")
async def report_review(code: str, rid: str, user_id: str = Depends(get_current_user)) -> dict:
    return community.report_review(user_id, code, rid)
