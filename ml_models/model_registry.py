from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib

from backend.core.assets import normalize_symbol, supported_symbols
from backend.core.config import get_settings
from ml_models.common import read_json_file


settings = get_settings()


class ModelRegistry:
    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}

    def get_model_path(self, symbol: str) -> Path:
        normalized_symbol = normalize_symbol(symbol)
        return settings.models_dir / f"{normalized_symbol}_random_forest.joblib"

    def get_metadata_path(self, symbol: str) -> Path:
        normalized_symbol = normalize_symbol(symbol)
        return settings.models_dir / f"{normalized_symbol}_random_forest.meta.json"

    def load(self, symbol: str) -> dict[str, Any]:
        normalized_symbol = normalize_symbol(symbol)
        if normalized_symbol in self._cache:
            return self._cache[normalized_symbol]

        model_path = self.get_model_path(normalized_symbol)
        if not model_path.exists():
            raise FileNotFoundError(
                f"No saved Random Forest model found for {normalized_symbol}. Run scripts/train_models.py first."
            )

        artifact = joblib.load(model_path)
        model = artifact.get("model")
        if model is not None and hasattr(model, "set_params"):
            model.set_params(n_jobs=1)
        self._cache[normalized_symbol] = artifact
        return artifact

    def get_metadata(self, symbol: str) -> dict[str, Any]:
        metadata_path = self.get_metadata_path(symbol)
        if not metadata_path.exists():
            raise FileNotFoundError(
                f"No metadata file found for {normalize_symbol(symbol)}. Train the model before requesting metadata."
            )
        return read_json_file(metadata_path)

    def clear(self, symbol: str | None = None) -> None:
        if symbol is None:
            self._cache.clear()
            return
        self._cache.pop(normalize_symbol(symbol), None)

    def available_models(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for symbol in supported_symbols():
            model_path = self.get_model_path(symbol)
            metadata_path = self.get_metadata_path(symbol)
            if not model_path.exists():
                continue
            metadata = read_json_file(metadata_path, default={})
            entries.append(
                {
                    "symbol": symbol,
                    "model_path": str(model_path),
                    "metadata_path": str(metadata_path),
                    "last_trained": metadata.get("last_trained"),
                    "metrics": metadata.get("metrics", {}),
                }
            )
        return entries


model_registry = ModelRegistry()
