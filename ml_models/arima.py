from __future__ import annotations

import warnings

import pandas as pd
from statsmodels.tsa.arima.model import ARIMA

from ml_models.common import build_backtest_points, build_future_forecast_points, regression_metrics

warnings.filterwarnings("ignore")


def run_arima_model(frame: pd.DataFrame, test_ratio: float = 0.2, forecast_horizon: int = 7) -> dict:
    series = frame[["timestamp", "price"]].copy().reset_index(drop=True)
    split_index = max(int(len(series) * (1 - test_ratio)), 10)
    split_index = min(split_index, len(series) - 1)
    train = series.iloc[:split_index]
    test = series.iloc[split_index:]

    model = ARIMA(train["price"], order=(5, 1, 0))
    fitted = model.fit()
    test_predictions = fitted.forecast(steps=len(test))
    rmse, mae = regression_metrics(test["price"].to_numpy(), test_predictions.to_numpy())

    final_model = ARIMA(series["price"], order=(5, 1, 0)).fit()
    future_predictions = final_model.forecast(steps=forecast_horizon).to_numpy()

    return {
        "model_name": "ARIMA",
        "rmse": rmse,
        "mae": mae,
        "prediction": float(future_predictions[0]),
        "backtest": build_backtest_points(test["timestamp"], test["price"].to_numpy(), test_predictions.to_numpy()),
        "future_forecast": build_future_forecast_points(
            series["timestamp"].iloc[-1],
            future_predictions.tolist(),
        ),
    }
