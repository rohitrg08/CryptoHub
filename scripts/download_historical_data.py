from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import httpx
import pandas as pd

from backend.core.assets import binance_symbol, normalize_symbol, supported_symbols
from backend.core.config import get_settings


settings = get_settings()
BINANCE_MARKET_DATA_BASE = "https://data-api.binance.vision"


def download_symbol_history(symbol: str, days: int = 730) -> pd.DataFrame:
    normalized_symbol = normalize_symbol(symbol)
    market_symbol = binance_symbol(normalized_symbol)
    start_time = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000)

    params = {
        "symbol": market_symbol,
        "interval": "1d",
        "startTime": start_time,
        "limit": 1000,
    }

    with httpx.Client(timeout=30) as client:
        response = client.get(f"{BINANCE_MARKET_DATA_BASE}/api/v3/klines", params=params)
        response.raise_for_status()
        klines = response.json()

    if not klines:
        raise ValueError(f"No historical OHLCV rows were returned for {normalized_symbol}.")

    frame = pd.DataFrame(
        [
            {
                "date": datetime.fromtimestamp(row[0] / 1000, tz=timezone.utc).isoformat(),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
            for row in klines
        ]
    )
    return frame


def save_symbol_history(symbol: str, output_dir: Path | None = None, days: int = 730) -> Path:
    normalized_symbol = normalize_symbol(symbol)
    target_dir = output_dir or settings.data_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    output_path = target_dir / f"{normalized_symbol.lower()}_usd.csv"
    frame = download_symbol_history(normalized_symbol, days=days)
    frame.to_csv(output_path, index=False)
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Download OHLCV crypto history into local CSV files.")
    parser.add_argument("--days", type=int, default=730, help="Number of daily rows to request.")
    parser.add_argument(
        "--symbols",
        nargs="*",
        default=supported_symbols(),
        help="Symbols to download, for example BTC ETH SOL.",
    )
    args = parser.parse_args()

    for symbol in args.symbols:
        try:
            output_path = save_symbol_history(symbol, days=args.days)
            print(f"Downloaded {normalize_symbol(symbol)} -> {output_path}")
        except Exception as exc:
            print(f"Failed to download {symbol}: {exc}")


if __name__ == "__main__":
    main()
