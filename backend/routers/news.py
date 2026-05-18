"""
================================================================
UQU Academic Assistant — News Router
================================================================
Exposes GET /api/news to fetch curated university news.
It attempts to fetch live RSS updates via the backend RSS service.
If that fails or times out, it gracefully falls back to a curated
list of persistent UQU links.
"""

from datetime import datetime
from fastapi import APIRouter
from schemas.news import NewsResponse, NewsItem
from services.rss import fetch_rss

router = APIRouter(prefix="/api/news", tags=["News"])

UQU_X_HANDLE = "UmmAlQuraUniv"
RSS_SOURCES = [
    "https://uqu.edu.sa/news/rss",
    "https://uqu.edu.sa/rss",
    f"https://nitter.net/{UQU_X_HANDLE}/rss"
]

FALLBACK_NEWS = [
    {
        "title": "@UmmAlQuraUniv — حساب الجامعة الرسمي على إكس",
        "description": "تابع آخر الأخبار والإعلانات الرسمية من جامعة أم القرى مباشرة عبر منصة إكس.",
        "link": f"https://x.com/{UQU_X_HANDLE}",
        "category": "إكس"
    },
    {
        "title": "التقويم الأكاديمي — الفصل الدراسي الثاني 1447هـ",
        "description": "تعرف على مواعيد بداية الدراسة والاختبارات والإجازات الرسمية لهذا الفصل.",
        "link": "https://uqu.edu.sa/academic-calendar",
        "category": "تقويم"
    },
    {
        "title": "بوابة القبول والتسجيل — جامعة أم القرى",
        "description": "آخر الإعلانات المتعلقة بالقبول والتسجيل وتأجيل الفصول الدراسية.",
        "link": "https://uqu.edu.sa/admission",
        "category": "قبول"
    },
    {
        "title": "الخدمات الإلكترونية للطلاب",
        "description": "تصفح كل الخدمات الإلكترونية المتاحة: السجل الأكاديمي، الحذف والإضافة، وغيرها.",
        "link": "https://uqu.edu.sa/eservices",
        "category": "خدمات"
    },
    {
        "title": "المكتبة الرقمية — موارد البحث العلمي",
        "description": "استفد من قواعد البيانات والمراجع الإلكترونية المتاحة عبر مكتبة الجامعة.",
        "link": "https://uqu.edu.sa/lib",
        "category": "مكتبة"
    },
    {
        "title": "برنامج الإرشاد الأكاديمي",
        "description": "تواصل مع مرشدك الأكاديمي للحصول على نصائح حول خطتك الدراسية وتحسين أدائك.",
        "link": "https://uqu.edu.sa",
        "category": "إرشاد"
    }
]

def get_fallback() -> list[NewsItem]:
    now_iso = datetime.utcnow().isoformat() + "Z"
    return [
        NewsItem(
            title=item["title"],
            description=item["description"],
            link=item["link"],
            date=now_iso,
            category=item["category"],
        )
        for item in FALLBACK_NEWS
    ]

@router.get("", response_model=NewsResponse)
async def get_news():
    """Fetch university news (RSS or Fallback)."""
    # Attempt to fetch live RSS news
    live_items = await fetch_rss(source_urls=RSS_SOURCES, max_items=6, timeout_seconds=6.0)
    
    if live_items and len(live_items) > 0:
        return NewsResponse(items=[NewsItem(**item) for item in live_items])
    
    # Fallback if RSS fetch fails
    return NewsResponse(items=get_fallback())
