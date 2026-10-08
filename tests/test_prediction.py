from __future__ import annotations

from ml_models.predictor import RandomForestPredictor
from ml_models.trainer import random_forest_trainer

from .test_features import make_sample_history


def test_recursive_prediction_has_future_horizons() -> None:
    history = make_sample_history(250)
    random_forest_trainer.train_symbol("BTC", history_frame=history, persist=True)

    predictor = RandomForestPredictor()
    result = predictor.predict("BTC", history)

    assert result["current_price"] > 0
    assert result["predicted_tomorrow_price"] > 0
    assert result["predicted_3_day_price"] > 0
    assert result["predicted_7_day_price"] > 0
    assert len(result["forecast_points"]) >= 7
