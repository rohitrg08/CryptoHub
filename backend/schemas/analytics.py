from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class PricePoint(BaseModel):
    timestamp: datetime
    price: float


class ModelMetric(BaseModel):
    model_name: str
    rmse: float
    mae: float
    prediction: float


class BacktestPoint(BaseModel):
    timestamp: datetime
    actual: float
    predicted: float


class ForecastResponse(BaseModel):
    symbol: str
    current_price: float
    predicted_price: float
    best_model: str
    model_metrics: list[ModelMetric]
    backtest: list[BacktestPoint]
    decision: Literal["BUY", "SELL", "HOLD"]
    risk_level: Literal["Low", "Medium", "High"]
    sentiment: str
    sentiment_score: float
    sentiment_impact: str
    volatility: float
    expected_change_pct: float
    forecast_horizon_days: int
    future_forecast: list[PricePoint]


class NewsArticle(BaseModel):
    title: str
    source: str
    url: str
    published_at: datetime
    sentiment: str
    sentiment_score: float


class LivePriceResponse(BaseModel):
    timestamp: datetime
    prices: dict[str, dict[str, float]]
