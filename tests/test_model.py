from __future__ import annotations

from ml_models.trainer import random_forest_trainer

from .test_features import make_sample_history


def test_random_forest_model_training_returns_metrics() -> None:
    history = make_sample_history(220)
    artifact = random_forest_trainer.train_symbol("BTC", history_frame=history, persist=False)

    assert artifact["symbol"] == "BTC"
    assert artifact["model_type"] == "RandomForestRegressor"
    assert set(["mae", "rmse", "r2", "mape", "directional_accuracy"]).issubset(artifact["metrics"].keys())
    assert artifact["model"] is not None
