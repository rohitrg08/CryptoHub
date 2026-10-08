from __future__ import annotations

import numpy as np
import pandas as pd

from ml_models.common import REQUIRED_OHLCV_COLUMNS


LAG_WINDOWS = (1, 2, 3, 7, 14, 30)
SMA_WINDOWS = (7, 14, 30, 50)
EMA_WINDOWS = (7, 14, 30)

FEATURE_COLUMNS = [
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_lag_1",
    "close_lag_2",
    "close_lag_3",
    "close_lag_7",
    "close_lag_14",
    "close_lag_30",
    "SMA_7",
    "SMA_14",
    "SMA_30",
    "SMA_50",
    "EMA_7",
    "EMA_14",
    "EMA_30",
    "rolling_volatility",
    "daily_return",
    "rolling_std_dev",
    "RSI",
    "MACD",
    "MACD_signal",
    "bollinger_upper",
    "bollinger_lower",
    "day_of_week",
    "month",
]


def prepare_ohlcv_frame(frame: pd.DataFrame) -> pd.DataFrame:
    rename_map = {
        "timestamp": "date",
        "datetime": "date",
    }
    normalized = frame.copy()
    normalized.columns = [str(column).strip().lower() for column in normalized.columns]
    normalized = normalized.rename(columns=rename_map)

    missing_columns = [column for column in REQUIRED_OHLCV_COLUMNS if column not in normalized.columns]
    if missing_columns:
        missing = ", ".join(missing_columns)
        raise ValueError(f"Historical dataset is missing required OHLCV columns: {missing}.")

    normalized["date"] = pd.to_datetime(normalized["date"], utc=True, errors="coerce")
    for column in REQUIRED_OHLCV_COLUMNS[1:]:
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")

    normalized = normalized.dropna(subset=list(REQUIRED_OHLCV_COLUMNS))
    normalized = normalized.sort_values("date").drop_duplicates(subset=["date"], keep="last")
    return normalized.reset_index(drop=True)


def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    average_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    average_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    relative_strength = average_gain / average_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + relative_strength))
    return rsi.fillna(50.0)


def engineer_features(frame: pd.DataFrame) -> pd.DataFrame:
    engineered = prepare_ohlcv_frame(frame)

    for lag in LAG_WINDOWS:
        engineered[f"close_lag_{lag}"] = engineered["close"].shift(lag)

    for window in SMA_WINDOWS:
        engineered[f"SMA_{window}"] = engineered["close"].rolling(window=window, min_periods=window).mean()

    for window in EMA_WINDOWS:
        engineered[f"EMA_{window}"] = engineered["close"].ewm(span=window, adjust=False).mean()

    engineered["daily_return"] = engineered["close"].pct_change()
    engineered["rolling_std_dev"] = engineered["daily_return"].rolling(window=14, min_periods=14).std()
    engineered["rolling_volatility"] = engineered["rolling_std_dev"] * np.sqrt(14)
    engineered["RSI"] = calculate_rsi(engineered["close"], period=14)
    engineered["RSI"] = engineered["RSI"].replace([np.inf, -np.inf], np.nan).fillna(50.0)

    ema_12 = engineered["close"].ewm(span=12, adjust=False).mean()
    ema_26 = engineered["close"].ewm(span=26, adjust=False).mean()
    engineered["MACD"] = ema_12 - ema_26
    engineered["MACD_signal"] = engineered["MACD"].ewm(span=9, adjust=False).mean()

    bollinger_mid = engineered["close"].rolling(window=20, min_periods=20).mean()
    bollinger_std = engineered["close"].rolling(window=20, min_periods=20).std()
    engineered["bollinger_upper"] = bollinger_mid + (2 * bollinger_std)
    engineered["bollinger_lower"] = bollinger_mid - (2 * bollinger_std)

    engineered["day_of_week"] = engineered["date"].dt.dayofweek
    engineered["month"] = engineered["date"].dt.month

    for column in FEATURE_COLUMNS:
        if column in engineered.columns:
            engineered[column] = engineered[column].replace([np.inf, -np.inf], np.nan)
            engineered[column] = engineered[column].ffill().bfill()

    return engineered


def build_training_dataset(frame: pd.DataFrame, target_horizon: int = 1) -> pd.DataFrame:
    if target_horizon < 1:
        raise ValueError("Target horizon must be at least 1 day.")

    dataset = engineer_features(frame)
    dataset["target_close"] = dataset["close"].shift(-target_horizon)
    dataset["target_date"] = dataset["date"].shift(-target_horizon)
    dataset = dataset.ffill().bfill()
    dataset = dataset.dropna(subset=["target_close", "target_date"]).reset_index(drop=True)
    return dataset


def latest_feature_row(frame: pd.DataFrame, feature_columns: list[str] | None = None) -> pd.Series:
    columns = feature_columns or FEATURE_COLUMNS
    engineered = engineer_features(frame).dropna(subset=columns)
    if engineered.empty:
        raise ValueError("Not enough historical data to build the latest feature row.")
    return engineered.iloc[-1][columns]
