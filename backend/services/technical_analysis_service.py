from __future__ import annotations

from backend.core.assets import normalize_symbol
from backend.services.coingecko_service import coingecko_service
from ml_models.common import serialize_history_points
from ml_models.feature_engineering import engineer_features


class TechnicalAnalysisService:
    async def get_technical_data(self, symbol: str, days: int = 180) -> dict:
        normalized_symbol = normalize_symbol(symbol)
        history = await coingecko_service.get_historical_ohlcv(normalized_symbol, days=days)
        features = engineer_features(history).dropna().reset_index(drop=True)

        if features.empty:
            raise ValueError(f"Insufficient historical data to compute technical indicators for {normalized_symbol}.")

        latest = features.iloc[-1]
        trend = "UPTREND" if float(latest["close"]) >= float(latest["SMA_30"]) else "DOWNTREND"

        rsi_series = [
            {"timestamp": row.date.to_pydatetime().isoformat(), "value": round(float(row.RSI), 6)}
            for row in features[["date", "RSI"]].tail(days).itertuples(index=False)
        ]
        volatility_series = [
            {
                "timestamp": row.date.to_pydatetime().isoformat(),
                "value": round(float(row.rolling_volatility), 6),
            }
            for row in features[["date", "rolling_volatility"]].tail(days).itertuples(index=False)
        ]
        macd_series = [
            {
                "timestamp": row.date.to_pydatetime().isoformat(),
                "macd": round(float(row.MACD), 6),
                "signal": round(float(row.MACD_signal), 6),
            }
            for row in features[["date", "MACD", "MACD_signal"]].tail(days).itertuples(index=False)
        ]

        return {
            "symbol": normalized_symbol,
            "trend": trend,
            "current_price": round(float(latest["close"]), 6),
            "rsi": round(float(latest["RSI"]), 6),
            "macd": round(float(latest["MACD"]), 6),
            "macd_signal": round(float(latest["MACD_signal"]), 6),
            "volatility": round(float(latest["rolling_volatility"]), 6),
            "daily_return": round(float(latest["daily_return"]), 6),
            "moving_averages": {
                "SMA_7": round(float(latest["SMA_7"]), 6),
                "SMA_14": round(float(latest["SMA_14"]), 6),
                "SMA_30": round(float(latest["SMA_30"]), 6),
                "SMA_50": round(float(latest["SMA_50"]), 6),
                "EMA_7": round(float(latest["EMA_7"]), 6),
                "EMA_14": round(float(latest["EMA_14"]), 6),
                "EMA_30": round(float(latest["EMA_30"]), 6),
            },
            "bollinger_bands": {
                "upper": round(float(latest["bollinger_upper"]), 6),
                "lower": round(float(latest["bollinger_lower"]), 6),
            },
            "history": serialize_history_points(history, value_column="close", limit=days),
            "rsi_series": rsi_series,
            "volatility_series": volatility_series,
            "macd_series": macd_series,
        }


technical_analysis_service = TechnicalAnalysisService()
