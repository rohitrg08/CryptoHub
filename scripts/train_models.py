import argparse
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.core.assets import normalize_symbol, supported_symbols
from ml_models.ensemble import ensemble_trainer
from ml_models.trainer import random_forest_trainer


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and persist Machine Learning models for CryptoHub.")
    parser.add_argument(
        "--model",
        type=str,
        default="ensemble",
        choices=["ensemble", "rf"],
        help="Model architecture to train (ensemble: RF + XGBoost + Momentum, rf: Random Forest).",
    )
    parser.add_argument(
        "--symbols",
        nargs="*",
        default=supported_symbols(),
        help="Symbols to train, for example BTC ETH SOL BNB.",
    )
    args = parser.parse_args()

    trainer = ensemble_trainer if args.model == "ensemble" else random_forest_trainer
    print(f"=== Starting Training for {len(args.symbols)} Cryptocurrencies [{args.model.upper()} Mode] ===")

    for raw_symbol in args.symbols:
        symbol = normalize_symbol(raw_symbol)
        try:
            result = trainer.train_symbol(symbol, persist=True)
            metrics = result["metrics"]
            print(
                f"[SUCCESS] {symbol:4s} | "
                f"R2={metrics['r2']:.4f} | "
                f"MAPE={metrics['mape']:.2f}% | "
                f"MAE=${metrics['mae']:,.2f} | "
                f"RMSE=${metrics['rmse']:,.2f} | "
                f"Samples={result['training_samples']} (Train) / {result['test_samples']} (Test)"
            )
        except Exception as exc:
            print(f"[FAILED]  {symbol}: {exc}")


if __name__ == "__main__":
    main()
