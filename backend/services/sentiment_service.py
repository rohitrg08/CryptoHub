from __future__ import annotations

from statistics import mean
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from backend.core.assets import asset_name, display_symbol, normalize_symbol
from backend.services.cache_service import cache_service
from backend.services.news_service import news_service

analyzer = SentimentIntensityAnalyzer()


class SentimentService:
    """Analyzes market news and derives a portfolio-friendly sentiment summary."""

    async def get_news_sentiment(self, symbol: str) -> dict:
        normalized_symbol = normalize_symbol(symbol)
        cache_key = f"sentiment:{normalized_symbol}"
        cached = cache_service.get(cache_key)
        if cached is not None:
            return cached

        asset_label = asset_name(normalized_symbol)
        ticker = display_symbol(normalized_symbol)
        articles = await news_service.fetch_crypto_news(f"{asset_label} OR {ticker} cryptocurrency")

        if not articles:
            result = {
                "sentiment": "Neutral",
                "sentiment_score": 0.0,
                "impact": "Market sentiment remains balanced with steady on-chain volume.",
                "articles": [],
            }
            cache_service.set(cache_key, result, ttl_seconds=300)
            return result

        scored_articles = []
        scores = []
        for article in articles:
            text = f"{article['title']} {article['description']}".strip()
            score = analyzer.polarity_scores(text)["compound"]
            scores.append(score)
            label = self._label_from_score(score)
            scored_articles.append({**article, "sentiment": label, "sentiment_score": round(score, 4)})

        avg_score = mean(scores) if scores else 0.0
        overall = self._label_from_score(avg_score)
        impact = self._impact_from_score(avg_score)
        result = {
            "sentiment": overall,
            "sentiment_score": round(avg_score, 4),
            "impact": impact,
            "articles": scored_articles,
        }
        cache_service.set(cache_key, result, ttl_seconds=600)
        return result

    @staticmethod
    def _label_from_score(score: float) -> str:
        if score >= 0.15:
            return "Positive"
        if score <= -0.15:
            return "Negative"
        return "Neutral"

    @staticmethod
    def _impact_from_score(score: float) -> str:
        if score >= 0.25:
            return "Bullish market coverage and on-chain growth are supporting upside momentum."
        if score <= -0.25:
            return "Cautious headlines and macro headwinds are increasing downside pressure."
        return "News flow is balanced with consolidation signals across spot and derivatives markets."


sentiment_service = SentimentService()
