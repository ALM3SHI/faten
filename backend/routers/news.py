"""Public university news (headlines from the official UQU RSS feed)."""

from fastapi import APIRouter, Query

from services.news import get_news

router = APIRouter(prefix="/api/news", tags=["News"])


@router.get("")
async def list_news(limit: int = Query(8, ge=1, le=20)):
    return await get_news(limit)
