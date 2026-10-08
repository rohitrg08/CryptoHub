from __future__ import annotations

import argparse

from backend.core.assets import normalize_symbol, supported_symbols
from ml_models.trainer import random_forest_trainer


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and persist Random Forest models for CryptoHub.")
    parser.add_argument(
        "--symbols",
        nargs="*",
        default=supported_symbols(),
        help="Symbols to train, for example BTC ETH BNB.",
    )
    args = parser.parse_args()

    for raw_symbol in args.symbols:
        symbol = normalize_symbol(raw_symbol)
        result = random_forest_trainer.train_symbol(symbol, persist=True)
        metrics = result["metrics"]
        print(
            f"{symbol}: "
            f"MAE={metrics['mae']:.4f}, "
            f"RMSE={metrics['rmse']:.4f}, "
            f"R2={metrics['r2']:.4f}, "
            f"MAPE={metrics['mape']:.4f}, "
            f"Directional Accuracy={metrics['directional_accuracy']:.2f}%"
        )


if __name__ == "__main__":
    main()
