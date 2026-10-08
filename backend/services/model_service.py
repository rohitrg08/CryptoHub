from __future__ import annotations

import asyncio
from statistics import mean
from typing import Any

from backend.core.assets import supported_symbols
from backend.services.cache_service import cache_service
from backend.services.coingecko_service import coingecko_service
from backend.services.random_forest_service import random_forest_service
from backend.services.sentiment_service import sentiment_service


class ForecastService:
    """Facade that keeps the route layer stable while the analytics stack evolves."""

    async def forecast_symbol(self, symbol: str) -> dict[str, Any]:
        return await random_forest_service.forecast_symbol(symbol)

    async def get_news_summary(self, symbol: str) -> dict[str, Any]:
        sentiment_result = await sentiment_service.get_news_sentiment(symbol)
        return {
            "symbol": symbol,
            "sentiment": sentiment_result["sentiment"],
            "sentiment_score": sentiment_result["sentiment_score"],
            "impact": sentiment_result["impact"],
            "articles": sentiment_result["articles"],
        }

    async def market_snapshot(self) -> dict[str, Any]:
        cache_key = "market_snapshot"
        cached = cache_service.get(cache_key)
        if cached is not None:
            return cached

        prices = await coingecko_service.get_live_prices()

        # Parallelize sentiment and forecast gathering
        symbols = supported_symbols()
        sentiments_task = asyncio.gather(
            *[self.get_news_summary(symbol) for symbol in symbols],
            return_exceptions=True,
        )
        forecasts_task = asyncio.gather(
            *[random_forest_service.forecast_symbol(symbol) for symbol in symbols],
            return_exceptions=True,
        )

        sentiments, forecasts = await asyncio.gather(sentiments_task, forecasts_task)

        valid_sentiments = [item for item in sentiments if isinstance(item, dict)]
        forecast_by_symbol = {
            item["symbol"]: item
            for item in forecasts
            if isinstance(item, dict) and "symbol" in item
        }

        comparison: list[dict[str, Any]] = []
        for symbol in symbols:
            symbol_price = prices.get(symbol, {})
            forecast = forecast_by_symbol.get(symbol)
            comparison_row = {
                "symbol": symbol,
                "current_price": float(symbol_price.get("price", 0.0)),
                "change_24h": float(symbol_price.get("change_24h", 0.0)),
                "predicted_change_pct": (
                    float(forecast["expected_change_pct"]) if forecast and "expected_change_pct" in forecast else None
                ),
                "risk_score": (
                    float(forecast["signal_score"]) if forecast and "signal_score" in forecast else None
                ),
            }
            comparison.append(comparison_row)

        average_sentiment = mean(item["sentiment_score"] for item in valid_sentiments) if valid_sentiments else 0.0
        payload = {
            "prices": prices,
            "sentiments": valid_sentiments,
            "average_sentiment": round(average_sentiment, 4),
            "comparison": comparison,
        }
        cache_service.set(cache_key, payload, ttl_seconds=30.0)
        return payload


forecast_service = ForecastService()
