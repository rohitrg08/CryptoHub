from __future__ import annotations

from typing import Any

from backend.core.assets import normalize_symbol, supported_symbols
from backend.core.config import get_settings
from backend.services.cache_service import cache_service
from backend.services.coingecko_service import coingecko_service
from backend.services.decision_engine import decision_engine
from backend.services.mongo_logger import mongo_logger
from backend.services.sentiment_service import sentiment_service
from backend.services.technical_analysis_service import technical_analysis_service
from ml_models.model_registry import model_registry
from ml_models.predictor import random_forest_predictor
from ml_models.trainer import random_forest_trainer


settings = get_settings()


class RandomForestService:
    async def forecast_symbol(self, symbol: str) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        cache_key = f"forecast:{normalized_symbol}"
        cached = cache_service.get(cache_key)
        if cached is not None:
            return cached

        history = await coingecko_service.get_live_ohlcv(normalized_symbol)
        prediction = random_forest_predictor.predict(normalized_symbol, history)
        technical = await technical_analysis_service.get_technical_data(normalized_symbol)
        sentiment = await sentiment_service.get_news_sentiment(normalized_symbol)
        metadata = model_registry.get_metadata(normalized_symbol)
        artifact = model_registry.load(normalized_symbol)
        metrics = metadata.get("metrics", {})

        decision = decision_engine.generate_signal(
            current_price=float(prediction["current_price"]),
            predicted_price=float(prediction["predicted_tomorrow_price"]),
            rsi=float(technical["rsi"]),
            volatility=float(technical["volatility"]),
            trend=str(technical["trend"]),
            sentiment_score=float(sentiment["sentiment_score"]),
            model_mape=float(metrics.get("mape", 0.0)),
        )

        mongo_logger.log_event(
            "forecasts",
            {
                "symbol": normalized_symbol,
                "current_price": prediction["current_price"],
                "predicted_tomorrow_price": prediction["predicted_tomorrow_price"],
                "signal_score": decision["signal_score"],
                "decision": decision["decision"],
                "risk_level": decision["risk_level"],
            },
        )

        model_metric_row = {
            "model_name": "Random Forest",
            "mae": float(metrics.get("mae", 0.0)),
            "rmse": float(metrics.get("rmse", 0.0)),
            "r2": float(metrics.get("r2", 0.0)),
            "mape": float(metrics.get("mape", 0.0)),
            "directional_accuracy": float(metrics.get("directional_accuracy", 0.0)),
            "prediction_error_pct": float(metrics.get("prediction_error_pct", 0.0)),
            "prediction": float(prediction["predicted_tomorrow_price"]),
        }

        return {
            "symbol": normalized_symbol,
            "current_price": round(float(prediction["current_price"]), 6),
            "predicted_price": round(float(prediction["predicted_tomorrow_price"]), 6),
            "predicted_tomorrow_price": round(float(prediction["predicted_tomorrow_price"]), 6),
            "predicted_3_day_price": round(float(prediction["predicted_3_day_price"]), 6),
            "predicted_5_day_price": round(float(prediction["predicted_5_day_price"]), 6),
            "predicted_7_day_price": round(float(prediction["predicted_7_day_price"]), 6),
            "expected_change_pct": round(float(prediction["expected_change_pct"]), 6),
            "expected_change_amount": round(float(prediction["expected_change_amount"]), 6),
            "best_model": "Random Forest",
            "model_type": metadata.get("model_type", "RandomForestRegressor"),
            "model_metrics": [model_metric_row],
            "metrics": metrics,
            "backtest": artifact.get("backtest", []),
            "decision": decision["decision"],
            "recommendation": decision["decision"],
            "risk": decision["risk_level"],
            "risk_level": decision["risk_level"],
            "signal_score": decision["signal_score"],
            "signal_rationale": decision["rationale"],
            "sentiment": sentiment["sentiment"],
            "sentiment_score": float(sentiment["sentiment_score"]),
            "sentiment_impact": sentiment["impact"],
            "volatility": float(technical["volatility"]),
            "technical": technical,
            "future_forecast": prediction["forecast_points"],
            "forecast_horizon_days": settings.forecast_horizon_days,
            "last_trained": metadata.get("last_trained"),
            "disclaimer": "Model forecast for educational purposes only. Not financial advice.",
        }
        cache_service.set(cache_key, result, ttl_seconds=180.0)
        return result

    async def get_backtest(self, symbol: str) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        metadata = model_registry.get_metadata(normalized_symbol)
        artifact = model_registry.load(normalized_symbol)
        return {
            "symbol": normalized_symbol,
            "metrics": metadata.get("metrics", {}),
            "backtest": artifact.get("backtest", []),
            "last_trained": metadata.get("last_trained"),
            "model_type": metadata.get("model_type", "RandomForestRegressor"),
        }

    async def get_model_metrics(self, symbol: str) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        metadata = model_registry.get_metadata(normalized_symbol)
        return {
            "symbol": normalized_symbol,
            "metrics": metadata.get("metrics", {}),
            "last_trained": metadata.get("last_trained"),
            "model_version": metadata.get("model_version"),
        }

    async def get_model_info(self, symbol: str) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        metadata = model_registry.get_metadata(normalized_symbol)
        return {
            "symbol": normalized_symbol,
            "model_type": metadata.get("model_type"),
            "training_samples": metadata.get("training_samples"),
            "validation_samples": metadata.get("validation_samples"),
            "test_samples": metadata.get("test_samples"),
            "features_used": metadata.get("feature_columns", []),
            "last_trained": metadata.get("last_trained"),
            "model_version": metadata.get("model_version"),
            "metrics": metadata.get("metrics", {}),
        }

    async def train_models(self, symbols: list[str] | None = None) -> dict[str, Any]:
        requested_symbols = [normalize_symbol(symbol) for symbol in (symbols or supported_symbols())]
        results: dict[str, Any] = {}
        for symbol in requested_symbols:
            result = random_forest_trainer.train_symbol(symbol, persist=True)
            results[symbol] = {
                "training_samples": result["training_samples"],
                "validation_samples": result["validation_samples"],
                "test_samples": result["test_samples"],
                "metrics": result["metrics"],
                "last_trained": result["last_trained"],
            }
        return {"trained_symbols": requested_symbols, "results": results}


random_forest_service = RandomForestService()
