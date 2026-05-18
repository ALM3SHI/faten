"""
================================================================
UQU Academic Assistant — RSS Service
================================================================
Server-side RSS fetcher with in-memory TTL cache.

Used by routers/news.py to back the GET /api/news endpoint, which
replaces the direct rss2json call previously made from
assets/uqu-news.js (browser).

Returns items in the same shape that uqu-news.js renderNews(items)
already consumes:
  { title, description, link, date, category }
"""

import time
import logging
from typing import Any
import httpx

logger = logging.getLogger(__name__)

RSS_PROXY = "https://api.rss2json.com/v1/api.json?rss_url="

# Process-local cache: { source_url: (timestamp, items) }
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL_SECONDS = 60 * 60  # 60 min — matches the spirit of uqu-news.js but server-side


def _cache_get(key: str) -> list[dict[str, Any]] | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    ts, items = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        return None
    return items


def _cache_put(key: str, items: list[dict[str, Any]]) -> None:
    _CACHE[key] = (time.time(), items)


def _normalize_items(raw: list[dict[str, Any]], is_x: bool, max_items: int = 6) -> list[dict[str, Any]]:
    """Mirror the same normalization assets/uqu-news.js performs after rss2json:
       - strip HTML
       - clamp description to 160 chars
       - clamp title to 120 chars
       - rewrite nitter links to x.com if from Twitter source
       - assign category from item.categories or 'إكس'/'أخبار'
    """
    import re
    items: list[dict[str, Any]] = []
    for item in raw[:max_items]:
        desc_raw = item.get("description") or item.get("content") or ""
        desc = re.sub(r"<[^>]*>", "", desc_raw)
        desc = re.sub(r"\s+", " ", desc).strip()[:160]

        link = item.get("link") or "#"
        if is_x and link:
            link = re.sub(r"https?://(www\.)?nitter\.[^/]+", "https://x.com", link, flags=re.IGNORECASE)

        title = (item.get("title") or "")[:120] or ("تحديث من حساب الجامعة" if is_x else "خبر")

        if is_x:
            category = "إكس"
        else:
            cats = item.get("categories") or []
            category = cats[0] if cats else "أخبار"

        items.append({
            "title": title,
            "description": desc,
            "link": link,
            "date": item.get("pubDate") or "",
            "category": category,
        })
    return items


async def fetch_rss(source_urls: list[str], max_items: int = 6, timeout_seconds: float = 6.0) -> list[dict[str, Any]] | None:
    """Try each source in order via the rss2json proxy. First success wins.

    Returns the normalized items list, or None if every source failed.
    Cache hits short-circuit the network round-trips entirely.
    """
    cache_key = "|".join(source_urls)
    cached = _cache_get(cache_key)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        for src in source_urls:
            try:
                resp = await client.get(RSS_PROXY + src)
                if resp.status_code != 200:
                    continue
                data = resp.json()
            except (httpx.RequestError, ValueError):
                continue

            if not isinstance(data, dict):
                continue
            if data.get("status") != "ok":
                continue
            raw_items = data.get("items") or []
            if not raw_items:
                continue

            is_x = "nitter" in src.lower() or "twitter" in src.lower()
            normalized = _normalize_items(raw_items, is_x=is_x, max_items=max_items)
            if normalized:
                _cache_put(cache_key, normalized)
                return normalized

    return None
