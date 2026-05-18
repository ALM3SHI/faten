from pydantic import BaseModel
from typing import List

class NewsItem(BaseModel):
    title: str
    description: str
    link: str
    date: str
    category: str

class NewsResponse(BaseModel):
    items: List[NewsItem]
