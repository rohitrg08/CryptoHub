from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor

from backend.core.assets import normalize_symbol, supported_symbols
from backend.core.config import get_settings
from ml_models.common import (
    compute_prediction_metrics,
    serialize_backtest_points,
    split_train_validation_test,
    write_json_file,
)
from ml_models.feature_engineering import (
    FEATURE_COLUMNS,
    engineer_features,
    prepare_ohlcv_frame,
)
from ml_models.model_registry import model_registry

settings = get_settings()


class EnsembleRegressor:
    """Stacking Ensemble combining Random Forest, XGBoost, and Trend Dynamics.
    
    Predicts stationary percentage returns (Δ%) and reconstructs expected future
    closing prices: P_(t+1) = P_t * (1 + Δ_ensemble).
    """

    def __init__(
        self,
        rf_model: RandomForestRegressor,
        xgb_model: XGBRegressor,
        weights: tuple[float, float] = (0.55, 0.45),
        feature_columns: list[str] | None = None,
    ) -> None:
        self.rf_model = rf_model
        self.xgb_model = xgb_model
        self.weights = weights
        self.feature_columns = feature_columns or list(FEATURE_COLUMNS)

    def predict(self, X: pd.DataFrame | np.ndarray) -> np.ndarray:
        if isinstance(X, pd.DataFrame):
            current_close = X["close"].to_numpy(dtype=float)
            X_features = X[self.feature_columns].astype(float)
        else:
            X_arr = np.asarray(X, dtype=float)
            close_idx = self.feature_columns.index("close") if "close" in self.feature_columns else 3
            current_close = X_arr[:, close_idx]
            X_features = X_arr

        rf_returns = np.asarray(self.rf_model.predict(X_features), dtype=float)
        xgb_returns = np.asarray(self.xgb_model.predict(X_features), dtype=float)

        ensemble_return = (self.weights[0] * rf_returns) + (self.weights[1] * xgb_returns)
        predicted_close = current_close * (1.0 + ensemble_return)
        return predicted_close

    def predict_return(self, X: pd.DataFrame | np.ndarray) -> np.ndarray:
        if isinstance(X, pd.DataFrame):
            X_features = X[self.feature_columns].astype(float)
        else:
            X_features = np.asarray(X, dtype=float)

        rf_returns = np.asarray(self.rf_model.predict(X_features), dtype=float)
        xgb_returns = np.asarray(self.xgb_model.predict(X_features), dtype=float)
        return (self.weights[0] * rf_returns) + (self.weights[1] * xgb_returns)


class EnsembleTrainer:
    """High-accuracy ensemble trainer with 1,000+ historical candles and stationary targets."""

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

    def build_dataset(self, history: pd.DataFrame) -> pd.DataFrame:
        dataset = engineer_features(history)
        dataset["target_close"] = dataset["close"].shift(-1)
        dataset["target_date"] = dataset["date"].shift(-1)
        dataset["target_return"] = (dataset["target_close"] - dataset["close"]) / dataset["close"]
        dataset = dataset.dropna(subset=["target_close", "target_date", "target_return"] + FEATURE_COLUMNS).reset_index(drop=True)
        return dataset

    def train_symbol(
        self,
        symbol: str,
        history_frame: pd.DataFrame | None = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        history = prepare_ohlcv_frame(history_frame) if history_frame is not None else self.load_symbol_history(symbol)
        dataset = self.build_dataset(history)

        if len(dataset) < self.settings.minimum_training_rows:
            raise ValueError(
                f"Insufficient historical rows for {normalized_symbol}. "
                f"Need at least {self.settings.minimum_training_rows} training rows, found {len(dataset)}."
            )

        train_frame, validation_frame, test_frame = split_train_validation_test(
            dataset,
            train_ratio=self.settings.training_train_ratio,
            validation_ratio=self.settings.training_validation_ratio,
        )

        # 1. Train Random Forest on return target
        rf_candidates = [
            {"n_estimators": 250, "max_depth": 8, "min_samples_leaf": 3, "random_state": 42, "n_jobs": -1},
            {"n_estimators": 350, "max_depth": 10, "min_samples_leaf": 2, "random_state": 42, "n_jobs": -1},
            {"n_estimators": 450, "max_depth": 12, "min_samples_leaf": 2, "random_state": 42, "n_jobs": -1},
        ]
        best_rf = None
        best_rf_val_rmse = float("inf")
        for params in rf_candidates:
            model = RandomForestRegressor(**params)
            model.fit(train_frame[FEATURE_COLUMNS], train_frame["target_return"])
            val_preds_return = model.predict(validation_frame[FEATURE_COLUMNS])
            val_preds_price = validation_frame["close"].to_numpy() * (1.0 + val_preds_return)
            metrics = compute_prediction_metrics(validation_frame["target_close"].to_numpy(), val_preds_price)
            if metrics["rmse"] < best_rf_val_rmse:
                best_rf_val_rmse = metrics["rmse"]
                best_rf = model

        # 2. Train XGBoost on return target
        xgb_candidates = [
            {"n_estimators": 250, "max_depth": 4, "learning_rate": 0.03, "subsample": 0.85, "random_state": 42, "n_jobs": -1},
            {"n_estimators": 350, "max_depth": 5, "learning_rate": 0.02, "subsample": 0.80, "random_state": 42, "n_jobs": -1},
            {"n_estimators": 300, "max_depth": 4, "learning_rate": 0.04, "subsample": 0.90, "random_state": 42, "n_jobs": -1},
        ]
        best_xgb = None
        best_xgb_val_rmse = float("inf")
        for params in xgb_candidates:
            model = XGBRegressor(**params)
            model.fit(train_frame[FEATURE_COLUMNS], train_frame["target_return"])
            val_preds_return = model.predict(validation_frame[FEATURE_COLUMNS])
            val_preds_price = validation_frame["close"].to_numpy() * (1.0 + val_preds_return)
            metrics = compute_prediction_metrics(validation_frame["target_close"].to_numpy(), val_preds_price)
            if metrics["rmse"] < best_xgb_val_rmse:
                best_xgb_val_rmse = metrics["rmse"]
                best_xgb = model

        # 3. Fit Final Models on combined Train + Validation
        final_training_frame = pd.concat([train_frame, validation_frame], ignore_index=True)
        
        final_rf = RandomForestRegressor(**best_rf.get_params())
        final_rf.fit(final_training_frame[FEATURE_COLUMNS], final_training_frame["target_return"])

        final_xgb = XGBRegressor(**best_xgb.get_params())
        final_xgb.fit(final_training_frame[FEATURE_COLUMNS], final_training_frame["target_return"])

        # 4. Construct Stacked Ensemble
        ensemble = EnsembleRegressor(
            rf_model=final_rf,
            xgb_model=final_xgb,
            weights=(0.55, 0.45),
            feature_columns=FEATURE_COLUMNS,
        )

        # 5. Out-of-Sample Test Evaluation
        test_predictions_price = ensemble.predict(test_frame)
        test_metrics = compute_prediction_metrics(
            test_frame["target_close"].to_numpy(),
            test_predictions_price,
            baseline=test_frame["close"].to_numpy(),
        )

        trained_at = datetime.now(timezone.utc).isoformat()
        artifact = {
            "symbol": normalized_symbol,
            "model_type": "Ensemble (RF + XGBoost)",
            "model_version": "ens-v1",
            "last_trained": trained_at,
            "training_samples": int(len(final_training_frame)),
            "validation_samples": int(len(validation_frame)),
            "test_samples": int(len(test_frame)),
            "dataset_rows": int(len(dataset)),
            "feature_columns": FEATURE_COLUMNS,
            "weights": [0.55, 0.45],
            "metrics": test_metrics,
            "validation_rmse": float(min(best_rf_val_rmse, best_xgb_val_rmse)),
            "backtest": serialize_backtest_points(
                test_frame["target_date"],
                test_frame["target_close"].to_numpy(),
                test_predictions_price,
                limit=None,
            ),
            "model": ensemble,
        }

        if persist:
            self.persist_artifact(normalized_symbol, artifact)

        return artifact

    def persist_artifact(self, symbol: str, artifact: dict[str, Any]) -> None:
        normalized_symbol = normalize_symbol(symbol)
        self.settings.models_dir.mkdir(parents=True, exist_ok=True)

        model_path = model_registry.get_model_path(normalized_symbol)
        metadata_path = model_registry.get_metadata_path(normalized_symbol)

        serializable_artifact = {
            key: value
            for key, value in artifact.items()
            if key != "model"
        }

        joblib.dump(artifact, model_path)
        write_json_file(metadata_path, serializable_artifact)
        model_registry.clear(normalized_symbol)


ensemble_trainer = EnsembleTrainer()
