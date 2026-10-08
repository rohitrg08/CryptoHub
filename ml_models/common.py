from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


REQUIRED_OHLCV_COLUMNS = ("date", "open", "high", "low", "close", "volume")


def build_lagged_dataset(frame: pd.DataFrame, window: int) -> pd.DataFrame:
    dataset = frame[["timestamp", "price"]].copy().reset_index(drop=True)
    for lag in range(1, window + 1):
        dataset[f"lag_{lag}"] = dataset["price"].shift(lag)
    dataset["target"] = dataset["price"]
    return dataset.dropna().reset_index(drop=True)


def build_future_feature_frame(frame: pd.DataFrame, window: int) -> pd.DataFrame:
    ordered_prices = frame["price"].reset_index(drop=True)
    features = {f"lag_{lag}": [float(ordered_prices.iloc[-lag])] for lag in range(1, window + 1)}
    return pd.DataFrame(features)


def recursive_forecast_regressor(
    model,
    price_history: list[float],
    window: int,
    steps: int,
    feature_columns: list[str],
) -> list[float]:
    history = [float(price) for price in price_history]
    forecasts: list[float] = []
    for _ in range(steps):
        features = {f"lag_{lag}": [float(history[-lag])] for lag in range(1, window + 1)}
        feature_frame = pd.DataFrame(features)[feature_columns]
        next_prediction = float(model.predict(feature_frame)[0])
        forecasts.append(next_prediction)
        history.append(next_prediction)
    return forecasts


def split_time_series(dataset: pd.DataFrame, test_ratio: float) -> Tuple[pd.DataFrame, pd.DataFrame]:
    split_index = max(int(len(dataset) * (1 - test_ratio)), 1)
    split_index = min(split_index, len(dataset) - 1)
    train = dataset.iloc[:split_index].copy()
    test = dataset.iloc[split_index:].copy()
    return train, test


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> tuple[float, float]:
    rmse = math.sqrt(mean_squared_error(actual, predicted))
    mae = mean_absolute_error(actual, predicted)
    return rmse, mae


def build_backtest_points(
    timestamps: pd.Series,
    actual: np.ndarray,
    predicted: np.ndarray,
    limit: int = 30,
) -> list[dict]:
    recent_timestamps = timestamps.iloc[-limit:]
    recent_actual = actual[-limit:]
    recent_predicted = predicted[-limit:]
    points: list[dict] = []
    for timestamp, actual_value, predicted_value in zip(
        recent_timestamps,
        recent_actual,
        recent_predicted,
    ):
        points.append(
            {
                "timestamp": pd.Timestamp(timestamp).to_pydatetime().isoformat(),
                "actual": round(float(actual_value), 4),
                "predicted": round(float(predicted_value), 4),
            }
        )
    return points


def build_future_forecast_points(
    last_timestamp,
    predicted_values: list[float],
) -> list[dict]:
    last_point = pd.Timestamp(last_timestamp)
    if last_point.tzinfo is None:
        last_point = last_point.tz_localize("UTC")

    points: list[dict] = []
    for step, value in enumerate(predicted_values, start=1):
        points.append(
            {
                "timestamp": (last_point + pd.Timedelta(days=step)).to_pydatetime().isoformat(),
                "price": round(float(value), 4),
            }
        )
    return points


def split_train_validation_test(
    dataset: pd.DataFrame,
    train_ratio: float,
    validation_ratio: float,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    if dataset.empty:
        raise ValueError("Cannot split an empty dataset.")

    if not 0 < train_ratio < 1 or not 0 <= validation_ratio < 1:
        raise ValueError("Train and validation ratios must be within the range (0, 1).")

    if train_ratio + validation_ratio >= 1:
        raise ValueError("Train and validation ratios must leave room for a test segment.")

    total_rows = len(dataset)
    train_end = max(int(total_rows * train_ratio), 1)
    validation_end = max(int(total_rows * (train_ratio + validation_ratio)), train_end + 1)
    validation_end = min(validation_end, total_rows - 1)

    train = dataset.iloc[:train_end].copy()
    validation = dataset.iloc[train_end:validation_end].copy()
    test = dataset.iloc[validation_end:].copy()

    if validation.empty or test.empty:
        raise ValueError("The dataset is too small for the requested chronological split.")

    return train, validation, test


def compute_prediction_metrics(
    actual: np.ndarray,
    predicted: np.ndarray,
    baseline: np.ndarray | None = None,
) -> dict[str, float]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    baseline = np.asarray(baseline, dtype=float) if baseline is not None else None

    mae = float(mean_absolute_error(actual, predicted))
    rmse = float(math.sqrt(mean_squared_error(actual, predicted)))
    r2 = float(r2_score(actual, predicted)) if len(actual) > 1 else 0.0

    denominator = np.where(np.abs(actual) < 1e-9, 1e-9, np.abs(actual))
    absolute_percentage_error = np.abs((actual - predicted) / denominator) * 100
    signed_percentage_error = ((predicted - actual) / denominator) * 100
    mape = float(np.mean(absolute_percentage_error))
    prediction_error_pct = float(np.mean(signed_percentage_error))

    if baseline is None:
        shifted = np.roll(actual, 1)
        shifted[0] = actual[0]
        baseline = shifted

    actual_direction = np.sign(actual - baseline)
    predicted_direction = np.sign(predicted - baseline)
    directional_accuracy = float(np.mean(actual_direction == predicted_direction) * 100)

    return {
        "mae": round(mae, 6),
        "rmse": round(rmse, 6),
        "r2": round(r2, 6),
        "mape": round(mape, 6),
        "directional_accuracy": round(directional_accuracy, 6),
        "prediction_error_pct": round(prediction_error_pct, 6),
    }


def serialize_backtest_points(
    dates: pd.Series | list[Any],
    actual: np.ndarray,
    predicted: np.ndarray,
    limit: int | None = None,
) -> list[dict[str, float | str]]:
    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(pd.Series(dates), utc=True),
            "actual": np.asarray(actual, dtype=float),
            "predicted": np.asarray(predicted, dtype=float),
        }
    )
    if limit:
        frame = frame.tail(limit)

    return [
        {
            "timestamp": row.date.to_pydatetime().isoformat(),
            "actual": round(float(row.actual), 6),
            "predicted": round(float(row.predicted), 6),
        }
        for row in frame.itertuples(index=False)
    ]


def serialize_history_points(
    frame: pd.DataFrame,
    value_column: str = "close",
    limit: int | None = None,
) -> list[dict[str, float | str]]:
    ordered = frame.copy()
    if limit:
        ordered = ordered.tail(limit)

    return [
        {
            "timestamp": pd.Timestamp(row.date).to_pydatetime().isoformat(),
            "price": round(float(getattr(row, value_column)), 6),
        }
        for row in ordered.itertuples(index=False)
    ]


def normalize_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): normalize_for_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_for_json(item) for item in value]
    if isinstance(value, tuple):
        return [normalize_for_json(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (pd.Timestamp,)):
        return value.to_pydatetime().isoformat()
    return value


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalize_for_json(payload), indent=2), encoding="utf-8")


def read_json_file(path: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    if not path.exists():
        return default or {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default or {}
