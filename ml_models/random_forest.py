from __future__ import annotations

import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from ml_models.common import (
    build_backtest_points,
    build_future_forecast_points,
    build_lagged_dataset,
    recursive_forecast_regressor,
    regression_metrics,
    split_time_series,
)
from ml_models.predictor import random_forest_predictor
from ml_models.trainer import random_forest_trainer


def run_random_forest_model(
    frame: pd.DataFrame,
    window: int = 14,
    test_ratio: float = 0.2,
    forecast_horizon: int = 7,
) -> dict:
    dataset = build_lagged_dataset(frame, window)
    train, test = split_time_series(dataset, test_ratio)
    feature_columns = [column for column in dataset.columns if column.startswith("lag_")]

    model = RandomForestRegressor(
        n_estimators=300,
        random_state=42,
        min_samples_leaf=2,
        n_jobs=1,
    )
    model.fit(train[feature_columns], train["target"])

    test_predictions = model.predict(test[feature_columns])
    rmse, mae = regression_metrics(test["target"].to_numpy(), test_predictions)
    future_predictions = recursive_forecast_regressor(
        model,
        frame["price"].astype(float).tolist(),
        window,
        forecast_horizon,
        feature_columns,
    )

    return {
        "model_name": "Random Forest",
        "rmse": rmse,
        "mae": mae,
        "prediction": float(future_predictions[0]),
        "backtest": build_backtest_points(test["timestamp"], test["target"].to_numpy(), test_predictions),
        "future_forecast": build_future_forecast_points(
            frame["timestamp"].iloc[-1],
            future_predictions,
        ),
    }


def train_random_forest_for_symbol(symbol: str, history_frame: pd.DataFrame | None = None) -> dict:
    return random_forest_trainer.train_symbol(symbol, history_frame=history_frame, persist=True)


def forecast_with_saved_random_forest(symbol: str, history_frame: pd.DataFrame) -> dict:
    return random_forest_predictor.predict(symbol, history_frame)
