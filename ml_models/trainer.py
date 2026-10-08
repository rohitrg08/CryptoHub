from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from backend.core.assets import normalize_symbol, supported_symbols
from backend.core.config import get_settings
from ml_models.common import (
    compute_prediction_metrics,
    read_json_file,
    serialize_backtest_points,
    split_train_validation_test,
    write_json_file,
)
from ml_models.feature_engineering import FEATURE_COLUMNS, build_training_dataset, prepare_ohlcv_frame
from ml_models.model_registry import model_registry


settings = get_settings()


class RandomForestTrainer:
    def __init__(self) -> None:
        self.settings = settings

    def data_path_for_symbol(self, symbol: str) -> Path:
        normalized_symbol = normalize_symbol(symbol)
        return self.settings.data_dir / f"{normalized_symbol.lower()}_usd.csv"

    def load_symbol_history(self, symbol: str) -> pd.DataFrame:
        data_path = self.data_path_for_symbol(symbol)
        if not data_path.exists():
            raise FileNotFoundError(
                f"Historical dataset not found for {normalize_symbol(symbol)} at {data_path}."
            )
        frame = pd.read_csv(data_path)
        return prepare_ohlcv_frame(frame)

    def _candidate_params(self) -> list[dict[str, Any]]:
        base = {
            "random_state": self.settings.random_forest_random_state,
            "n_jobs": 1,
        }
        return [
            {
                **base,
                "n_estimators": 300,
                "max_depth": 10,
                "min_samples_split": 4,
                "min_samples_leaf": 2,
            },
            {
                **base,
                "n_estimators": 450,
                "max_depth": 14,
                "min_samples_split": 3,
                "min_samples_leaf": 1,
            },
            {
                **base,
                "n_estimators": 600,
                "max_depth": None,
                "min_samples_split": 2,
                "min_samples_leaf": 1,
            },
        ]

    def train_symbol(
        self,
        symbol: str,
        history_frame: pd.DataFrame | None = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        history = prepare_ohlcv_frame(history_frame) if history_frame is not None else self.load_symbol_history(symbol)
        dataset = build_training_dataset(history, target_horizon=1)

        if len(dataset) < self.settings.minimum_training_rows:
            raise ValueError(
                f"Insufficient historical rows for {normalized_symbol}. "
                f"Need at least {self.settings.minimum_training_rows} training rows after feature engineering."
            )

        train_frame, validation_frame, test_frame = split_train_validation_test(
            dataset,
            train_ratio=self.settings.training_train_ratio,
            validation_ratio=self.settings.training_validation_ratio,
        )

        best_model: RandomForestRegressor | None = None
        best_params: dict[str, Any] | None = None
        best_validation_rmse: float | None = None

        for params in self._candidate_params():
            candidate = RandomForestRegressor(**params)
            candidate.fit(train_frame[FEATURE_COLUMNS], train_frame["target_close"])
            validation_predictions = candidate.predict(validation_frame[FEATURE_COLUMNS])
            validation_metrics = compute_prediction_metrics(
                validation_frame["target_close"].to_numpy(),
                validation_predictions,
                baseline=validation_frame["close"].to_numpy(),
            )
            validation_rmse = validation_metrics["rmse"]
            if best_validation_rmse is None or validation_rmse < best_validation_rmse:
                best_validation_rmse = validation_rmse
                best_model = candidate
                best_params = params

        if best_model is None or best_params is None:
            raise RuntimeError(f"Random Forest training failed for {normalized_symbol}.")

        final_training_frame = pd.concat([train_frame, validation_frame], ignore_index=True)
        final_model = RandomForestRegressor(**best_params)
        final_model.fit(final_training_frame[FEATURE_COLUMNS], final_training_frame["target_close"])

        test_predictions = final_model.predict(test_frame[FEATURE_COLUMNS])
        test_metrics = compute_prediction_metrics(
            test_frame["target_close"].to_numpy(),
            test_predictions,
            baseline=test_frame["close"].to_numpy(),
        )

        trained_at = datetime.now(timezone.utc).isoformat()
        artifact = {
            "symbol": normalized_symbol,
            "model_type": "RandomForestRegressor",
            "model_version": "rf-v2",
            "last_trained": trained_at,
            "training_samples": int(len(final_training_frame)),
            "validation_samples": int(len(validation_frame)),
            "test_samples": int(len(test_frame)),
            "dataset_rows": int(len(dataset)),
            "feature_columns": FEATURE_COLUMNS,
            "best_params": best_params,
            "metrics": test_metrics,
            "validation_rmse": float(best_validation_rmse),
            "backtest": serialize_backtest_points(
                test_frame["target_date"],
                test_frame["target_close"].to_numpy(),
                test_predictions,
                limit=None,
            ),
            "model": final_model,
        }

        if persist:
            self.persist_artifact(normalized_symbol, artifact)

        return artifact

    def persist_artifact(self, symbol: str, artifact: dict[str, Any]) -> None:
        normalized_symbol = normalize_symbol(symbol)
        self.settings.models_dir.mkdir(parents=True, exist_ok=True)

        model_path = model_registry.get_model_path(normalized_symbol)
        metadata_path = model_registry.get_metadata_path(normalized_symbol)

        joblib.dump(artifact, model_path)

        metadata = {
            "symbol": normalized_symbol,
            "model_type": artifact["model_type"],
            "model_version": artifact["model_version"],
            "last_trained": artifact["last_trained"],
            "training_samples": artifact["training_samples"],
            "validation_samples": artifact["validation_samples"],
            "test_samples": artifact["test_samples"],
            "dataset_rows": artifact["dataset_rows"],
            "feature_columns": artifact["feature_columns"],
            "best_params": artifact["best_params"],
            "metrics": artifact["metrics"],
            "validation_rmse": artifact["validation_rmse"],
            "model_path": str(model_path),
        }
        write_json_file(metadata_path, metadata)
        self._update_metrics_store(normalized_symbol, metadata)
        model_registry.clear(normalized_symbol)

    def _update_metrics_store(self, symbol: str, metadata: dict[str, Any]) -> None:
        current = read_json_file(
            self.settings.model_metrics_path,
            default={"generated_at": None, "assets": {}},
        )
        assets = current.setdefault("assets", {})
        assets[symbol] = metadata
        current["generated_at"] = datetime.now(timezone.utc).isoformat()
        write_json_file(self.settings.model_metrics_path, current)

    def train_all_supported_symbols(self) -> dict[str, dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        for symbol in supported_symbols():
            results[symbol] = self.train_symbol(symbol)
        return results


random_forest_trainer = RandomForestTrainer()
