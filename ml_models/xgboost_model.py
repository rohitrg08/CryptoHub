from __future__ import annotations

import pandas as pd

from ml_models.common import (
    build_backtest_points,
    build_future_forecast_points,
    build_lagged_dataset,
    regression_metrics,
    recursive_forecast_regressor,
    split_time_series,
)


def run_xgboost_model(
    frame: pd.DataFrame,
    window: int = 14,
    test_ratio: float = 0.2,
    forecast_horizon: int = 7,
) -> dict:
    try:
        from xgboost import XGBRegressor
    except ImportError as exc:  # pragma: no cover
        raise ImportError("xgboost is not installed.") from exc

    dataset = build_lagged_dataset(frame, window)
    train, test = split_time_series(dataset, test_ratio)
    feature_columns = [column for column in dataset.columns if column.startswith("lag_")]

    model = XGBRegressor(
        objective="reg:squarederror",
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
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
        "model_name": "XGBoost",
        "rmse": rmse,
        "mae": mae,
        "prediction": float(future_predictions[0]),
        "backtest": build_backtest_points(test["timestamp"], test["target"].to_numpy(), test_predictions),
        "future_forecast": build_future_forecast_points(
            frame["timestamp"].iloc[-1],
            future_predictions,
        ),
    }
