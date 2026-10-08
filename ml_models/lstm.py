from __future__ import annotations

import os
import random

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

from ml_models.common import build_backtest_points, build_future_forecast_points, regression_metrics


os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")


def run_lstm_model(
    frame: pd.DataFrame,
    window: int = 14,
    test_ratio: float = 0.2,
    epochs: int = 20,
    batch_size: int = 16,
    forecast_horizon: int = 7,
) -> dict:
    try:
        import tensorflow as tf
        from tensorflow.keras import Sequential
        from tensorflow.keras.callbacks import EarlyStopping
        from tensorflow.keras.layers import Bidirectional, Dense, Dropout, LSTM
    except ImportError as exc:  # pragma: no cover
        raise ImportError("tensorflow is not installed.") from exc

    tf.random.set_seed(42)
    np.random.seed(42)
    random.seed(42)

    series = frame[["timestamp", "price"]].copy().reset_index(drop=True)
    prices = series["price"].values.reshape(-1, 1)
    split_index = max(int(len(prices) * (1 - test_ratio)), window + 5)
    split_index = min(split_index, len(prices) - 1)

    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(prices[:split_index])
    scaled_prices = scaler.transform(prices)

    X, y, timestamps = [], [], []
    for idx in range(window, len(scaled_prices)):
        X.append(scaled_prices[idx - window:idx, 0])
        y.append(scaled_prices[idx, 0])
        timestamps.append(series["timestamp"].iloc[idx])

    X = np.array(X)
    y = np.array(y)
    timestamps = pd.Series(timestamps)

    target_indices = np.arange(window, len(series))
    train_mask = target_indices < split_index
    test_mask = target_indices >= split_index

    X_train = X[train_mask].reshape((-1, window, 1))
    y_train = y[train_mask]
    X_test = X[test_mask].reshape((-1, window, 1))
    y_test = y[test_mask]
    test_timestamps = timestamps[test_mask].reset_index(drop=True)

    model = Sequential(
        [
            Bidirectional(LSTM(64, return_sequences=True), input_shape=(window, 1)),
            Dropout(0.15),
            Bidirectional(LSTM(32)),
            Dense(16, activation="relu"),
            Dense(1),
        ]
    )
    model.compile(optimizer="adam", loss="huber")
    model.fit(
        X_train,
        y_train,
        epochs=epochs,
        batch_size=batch_size,
        validation_split=0.1,
        verbose=0,
        callbacks=[EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True)],
    )

    scaled_predictions = model.predict(X_test, verbose=0)
    predicted_prices = scaler.inverse_transform(scaled_predictions).flatten()
    actual_prices = scaler.inverse_transform(y_test.reshape(-1, 1)).flatten()
    rmse, mae = regression_metrics(actual_prices, predicted_prices)

    rolling_window = scaled_prices[-window:, 0].copy()
    future_predictions: list[float] = []
    for _ in range(forecast_horizon):
        next_scaled = float(model.predict(rolling_window.reshape((1, window, 1)), verbose=0)[0][0])
        next_price = float(scaler.inverse_transform(np.array([[next_scaled]])).flatten()[0])
        future_predictions.append(next_price)
        rolling_window = np.append(rolling_window[1:], next_scaled)

    return {
        "model_name": "LSTM",
        "rmse": rmse,
        "mae": mae,
        "prediction": float(future_predictions[0]),
        "backtest": build_backtest_points(test_timestamps, actual_prices, predicted_prices),
        "future_forecast": build_future_forecast_points(
            series["timestamp"].iloc[-1],
            future_predictions,
        ),
    }
