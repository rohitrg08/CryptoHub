from __future__ import annotations

import pandas as pd

from ml_models.feature_engineering import build_training_dataset, engineer_features


def make_sample_history(days: int = 180) -> pd.DataFrame:
    dates = pd.date_range("2023-01-01", periods=days, freq="D", tz="UTC")
    closes = 100 + pd.Series(range(days), dtype=float) * 0.8
    frame = pd.DataFrame(
        {
            "date": dates,
            "open": closes * 0.995,
            "high": closes * 1.03,
            "low": closes * 0.97,
            "close": closes,
            "volume": 1000 + pd.Series(range(days), dtype=float) * 7,
        }
    )
    return frame


def test_feature_engineering_generates_required_indicators() -> None:
    frame = make_sample_history()
    features = engineer_features(frame)

    required_columns = {
        "open",
        "high",
        "low",
        "close",
        "volume",
        "close_lag_1",
        "close_lag_7",
        "SMA_7",
        "EMA_7",
        "rolling_volatility",
        "RSI",
        "MACD",
        "bollinger_upper",
        "day_of_week",
        "month",
    }

    assert required_columns.issubset(features.columns)
    assert not features.empty


def test_training_dataset_has_target_and_no_nulls() -> None:
    frame = make_sample_history()
    dataset = build_training_dataset(frame, target_horizon=1)

    assert "target_close" in dataset.columns
    assert len(dataset) > 0
    assert dataset["target_close"].notna().all()
