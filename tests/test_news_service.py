import pytest

from backend.services.news_service import NewsService


@pytest.mark.asyncio
async def test_fetch_crypto_news_supports_newsdata_response(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "status": "success",
                "results": [
                    {
                        "title": "Bitcoin price rises after ETF news",
                        "description": "Analysts say crypto sentiment improved.",
                        "source_id": "cointelegraph",
                        "link": "https://example.com/bitcoin-news",
                        "pubDate": "2026-08-14T10:00:00+00:00",
                    }
                ],
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params=None):
            return FakeResponse()

    monkeypatch.setattr("backend.services.news_service.settings.news_api_key", "demo-key")
    monkeypatch.setattr("backend.services.news_service.settings.news_api_base_url", "https://newsdata.io/api/1")
    monkeypatch.setattr("backend.services.news_service.httpx.AsyncClient", FakeClient)

    articles = await NewsService().fetch_crypto_news("bitcoin")

    assert len(articles) == 1
    assert articles[0]["title"] == "Bitcoin price rises after ETF news"
    assert articles[0]["source"] == "cointelegraph"
    assert articles[0]["url"] == "https://example.com/bitcoin-news"
