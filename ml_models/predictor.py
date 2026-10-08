from __future__ import annotations

from datetime import timedelta
from typing import Any

import pandas as pd

from backend.core.assets import normalize_symbol
from ml_models.feature_engineering import FEATURE_COLUMNS, engineer_features, prepare_ohlcv_frame
from ml_models.model_registry import model_registry


class RandomForestPredictor:
    def predict(self, symbol: str, history_frame: pd.DataFrame) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        artifact = model_registry.load(normalized_symbol)
        history = prepare_ohlcv_frame(history_frame)
        forecasts = self.recursive_forecast(normalized_symbol, history, horizons=(1, 3, 5, 7))
        current_price = float(history["close"].iloc[-1])

        tomorrow_price = float(forecasts["horizon_predictions"][1])
        expected_change_amount = tomorrow_price - current_price
        expected_change_pct = (expected_change_amount / current_price) * 100 if current_price else 0.0

        return {
            "symbol": normalized_symbol,
            "current_price": current_price,
            "predicted_tomorrow_price": tomorrow_price,
            "predicted_3_day_price": float(forecasts["horizon_predictions"][3]),
            "predicted_5_day_price": float(forecasts["horizon_predictions"][5]),
            "predicted_7_day_price": float(forecasts["horizon_predictions"][7]),
            "expected_change_amount": expected_change_amount,
            "expected_change_pct": expected_change_pct,
            "forecast_points": forecasts["forecast_points"],
            "model_info": {
                "model_type": artifact["model_type"],
                "model_version": artifact["model_version"],
                "last_trained": artifact["last_trained"],
                "metrics": artifact["metrics"],
            },
        }

    def recursive_forecast(
        self,
        symbol: str,
        history_frame: pd.DataFrame,
        horizons: tuple[int, ...] = (1, 3, 7),
    ) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        artifact = model_registry.load(normalized_symbol)
        model = artifact["model"]
        feature_columns = artifact.get("feature_columns", FEATURE_COLUMNS)

        prepared_history = prepare_ohlcv_frame(history_frame)
        max_horizon = max(horizons)
        rolling_history = prepared_history.copy()
        predicted_rows: list[dict[str, float | str]] = []

        for _ in range(max_horizon):
            feature_frame = engineer_features(rolling_history).dropna(subset=feature_columns)
            if feature_frame.empty:
                raise ValueError("Not enough historical data to generate a recursive forecast.")

            latest_row = feature_frame.iloc[-1]
            prediction_input = latest_row[feature_columns].to_frame().T
            raw_prediction = float(model.predict(prediction_input)[0])
            last_close = float(rolling_history["close"].iloc[-1])
            recent_returns = rolling_history["close"].pct_change().tail(7).dropna()
            trend_return = float(recent_returns.median()) if not recent_returns.empty else 0.0
            trend_prediction = last_close * (1 + trend_return)
            next_close = (raw_prediction * 0.7) + (trend_prediction * 0.3)
            max_daily_move = max(last_close * 0.05, 0.01)
            next_close = min(max(next_close, last_close - max_daily_move), last_close + max_daily_move)
            next_date = rolling_history["date"].iloc[-1] + timedelta(days=1)
            next_row = self._build_recursive_row(rolling_history, next_date, next_close)
            rolling_history = pd.concat([rolling_history, pd.DataFrame([next_row])], ignore_index=True)
            predicted_rows.append(
                {
                    "timestamp": pd.Timestamp(next_date).to_pydatetime().isoformat(),
                    "price": round(next_close, 6),
                }
            )

        horizon_predictions = {horizon: float(predicted_rows[horizon - 1]["price"]) for horizon in horizons}
        return {
            "horizon_predictions": horizon_predictions,
            "forecast_points": predicted_rows,
        }

    @staticmethod
    def _build_recursive_row(
        history_frame: pd.DataFrame,
        next_date: pd.Timestamp,
        predicted_close: float,
    ) -> dict[str, float | pd.Timestamp]:
        last_close = float(history_frame["close"].iloc[-1])
        recent_range = (history_frame["high"] - history_frame["low"]).tail(14)
        average_range = float(recent_range.mean()) if not recent_range.empty else 0.0
        average_volume = float(history_frame["volume"].tail(14).mean()) if not history_frame.empty else 0.0

        open_price = last_close
        high_price = max(open_price, predicted_close) + (average_range * 0.1)
        low_price = min(open_price, predicted_close) - (average_range * 0.1)
        low_price = max(low_price, 0.0)

        return {
            "date": _ensure_utc_timestamp(next_date),
            "open": round(open_price, 6),
            "high": round(high_price, 6),
            "low": round(low_price, 6),
            "close": round(predicted_close, 6),
            "volume": round(average_volume, 6),
        }


random_forest_predictor = RandomForestPredictor()


def _ensure_utc_timestamp(value: pd.Timestamp) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize("UTC")
    return timestamp.tz_convert("UTC")
