"""
University news — reads the official UQU RSS feed (https://uqu.edu.sa/App/Rss)
and returns a small, cleaned list of headlines that link back to the source.

* Cached in memory (NEWS_CACHE_SECONDS) so we hit the university site at most
  once per window, however many students open the dashboard.
* On fetch failure we keep serving the last good copy (stale-while-error).
* Only links/images on uqu.edu.sa hosts are passed through.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

FEED_URL = "https://uqu.edu.sa/App/Rss"
NEWS_CACHE_SECONDS = 30 * 60
MAX_FEED_BYTES = 2_000_000
MAX_ITEMS = 20

_CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"
_IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
_TAG_RE = re.compile(r"<[^>]+>")

_cache: dict = {"at": 0.0, "items": []}
_lock = asyncio.Lock()


def _allowed(url: str | None) -> str | None:
    if not url:
        return None
    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if u.scheme == "https" and (host == "uqu.edu.sa" or host.endswith(".uqu.edu.sa")):
        return u.geturl()
    return None


def _clean(text: str | None, limit: int) -> str:
    if not text:
        return ""
    t = html.unescape(_TAG_RE.sub(" ", text))
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def parse_feed(xml_text: str) -> list[dict]:
    """Parse RSS 2.0 into [{title, link, published, summary, image}]."""
    root = ET.fromstring(xml_text)
    items: list[dict] = []
    for it in root.iter("item"):
        title = _clean(it.findtext("title"), 200)
        link = _allowed(it.findtext("link"))
        if not title or not link:
            continue
        published = None
        raw_date = it.findtext("pubDate")
        if raw_date:
            try:
                published = parsedate_to_datetime(raw_date).isoformat()
            except (TypeError, ValueError):
                published = None
        summary = _clean(it.findtext("description"), 220)
        if summary == title:
            summary = ""
        image = None
        content = it.findtext(_CONTENT_NS) or ""
        m = _IMG_RE.search(content)
        if m:
            image = _allowed(html.unescape(m.group(1)))
        items.append({"title": title, "link": link, "published": published, "summary": summary, "image": image})
        if len(items) >= MAX_ITEMS:
            break
    return items


async def _fetch() -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True, headers={"User-Agent": "FatenBot/1.0 (+student assistant)"}) as client:
        r = await client.get(FEED_URL)
        r.raise_for_status()
        if len(r.content) > MAX_FEED_BYTES:
            raise ValueError("feed too large")
        return parse_feed(r.text)


async def get_news(limit: int = 8) -> dict:
    now = time.time()
    if now - _cache["at"] < NEWS_CACHE_SECONDS and _cache["items"]:
        return {"items": _cache["items"][:limit], "source": FEED_URL, "stale": False}
    async with _lock:
        if time.time() - _cache["at"] < NEWS_CACHE_SECONDS and _cache["items"]:
            return {"items": _cache["items"][:limit], "source": FEED_URL, "stale": False}
        try:
            items = await _fetch()
            _cache.update(at=time.time(), items=items)
            return {"items": items[:limit], "source": FEED_URL, "stale": False}
        except Exception as exc:  # network, HTTP or XML errors
            logger.warning("UQU news fetch failed: %s", exc)
            # Retry sooner than a full window, but don't hammer the site.
            _cache["at"] = time.time() - NEWS_CACHE_SECONDS + 300
            return {"items": _cache["items"][:limit], "source": FEED_URL, "stale": True}
