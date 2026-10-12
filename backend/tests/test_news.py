"""University news feed parsing and caching."""

import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from services import news

FEED = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>مركز الأخبار - جامعة أم القرى</title><link>https://uqu.edu.sa</link>
<item><title>جدول الاختبارات النصفية</title><link>https://uqu.edu.sa/App/News/179689</link>
<pubDate>Thu, 08 Oct 2026 12:22:35 +0300</pubDate>
<description>جدول الاختبارات النصفية لقسم علوم التأهيل &amp; الطبي</description>
<content:encoded><![CDATA[<p><img src="https://drive.uqu.edu.sa/_/dpt/news/a.jpeg"/></p>]]></content:encoded></item>
<item><title>إعلان</title><link>https://uqu.edu.sa/App/News/1</link><description>إعلان</description>
<content:encoded><![CDATA[<img src="https://evil.example/x.png">]]></content:encoded></item>
<item><title>رابط خارجي</title><link>https://evil.example/phish</link></item>
<item><title>  </title><link>https://uqu.edu.sa/App/News/2</link></item>
</channel></rss>"""


def test_parse_feed_cleans_and_filters():
    items = news.parse_feed(FEED)
    assert [i["title"] for i in items] == ["جدول الاختبارات النصفية", "إعلان"]
    first, second = items
    assert first["link"] == "https://uqu.edu.sa/App/News/179689"
    assert first["published"].startswith("2026-10-08T12:22:35+03:00")
    assert first["summary"] == "جدول الاختبارات النصفية لقسم علوم التأهيل & الطبي"
    assert first["image"] == "https://drive.uqu.edu.sa/_/dpt/news/a.jpeg"
    # summary identical to title is dropped; off-site image rejected
    assert second["summary"] == ""
    assert second["image"] is None


@pytest.fixture(autouse=True)
def _reset_cache():
    news._cache.update(at=0.0, items=[])
    yield
    news._cache.update(at=0.0, items=[])


def test_get_news_caches(monkeypatch):
    calls = {"n": 0}

    async def fake_fetch():
        calls["n"] += 1
        return news.parse_feed(FEED)

    monkeypatch.setattr(news, "_fetch", fake_fetch)
    first = asyncio.run(news.get_news(1))
    second = asyncio.run(news.get_news(5))
    assert calls["n"] == 1
    assert len(first["items"]) == 1 and len(second["items"]) == 2
    assert first["stale"] is False


def test_get_news_serves_stale_copy_on_failure(monkeypatch):
    news._cache.update(at=0.0, items=news.parse_feed(FEED))

    async def broken():
        raise RuntimeError("site down")

    monkeypatch.setattr(news, "_fetch", broken)
    out = asyncio.run(news.get_news())
    assert out["stale"] is True
    assert len(out["items"]) == 2


def test_news_endpoint_is_public(monkeypatch):
    async def fake_fetch():
        return news.parse_feed(FEED)

    monkeypatch.setattr(news, "_fetch", fake_fetch)
    r = TestClient(main.app).get("/api/news?limit=1")
    assert r.status_code == 200
    assert r.json()["items"][0]["title"] == "جدول الاختبارات النصفية"
    assert TestClient(main.app).get("/api/news?limit=99").status_code == 422
