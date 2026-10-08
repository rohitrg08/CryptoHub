from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from backend.core.assets import supported_symbols
from backend.core.config import get_settings


settings = get_settings()


BASE_PRICES = {
    "BTC": 64000.0,
    "ETH": 3200.0,
    "BNB": 540.0,
    "XRP": 0.62,
    "SOL": 140.0,
    "ADA": 0.48,
    "DOGE": 0.14,
    "AVAX": 34.0,
}

BASE_VOLUMES = {
    "BTC": 24000.0,
    "ETH": 180000.0,
    "BNB": 420000.0,
    "XRP": 9500000.0,
    "SOL": 2100000.0,
    "ADA": 11000000.0,
    "DOGE": 18000000.0,
    "AVAX": 1600000.0,
}


def build_sample_history(symbol: str, days: int = 540) -> pd.DataFrame:
    base_price = BASE_PRICES[symbol]
    base_volume = BASE_VOLUMES[symbol]
    dates = pd.date_range(end=datetime.now(timezone.utc), periods=days, freq="D")

    rows: list[dict[str, float | str]] = []
    previous_close = base_price
    symbol_factor = (supported_symbols().index(symbol) + 1) * 0.015

    for index, day in enumerate(dates):
        trend = 1 + (index * 0.0009) + (math.sin(index / 21) * 0.028) + symbol_factor
        seasonal = 1 + (math.cos(index / 11) * 0.008)
        open_price = previous_close * (1 + math.sin(index / 9) * 0.003)
        close_price = base_price * trend * seasonal
        intraday_range = close_price * (0.018 + (math.sin(index / 7) + 1) * 0.004)
        high_price = max(open_price, close_price) + intraday_range
        low_price = max(min(open_price, close_price) - intraday_range, 0.000001)
        volume = base_volume * (1 + math.sin(index / 13) * 0.35 + symbol_factor)

        rows.append(
            {
                "date": day.isoformat(),
                "open": round(open_price, 6),
                "high": round(high_price, 6),
                "low": round(low_price, 6),
                "close": round(close_price, 6),
                "volume": round(volume, 6),
            }
        )
        previous_close = close_price

    return pd.DataFrame(rows)


def write_sample_histories(days: int = 540) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    for symbol in supported_symbols():
        output_path = settings.data_dir / f"{symbol.lower()}_usd.csv"
        build_sample_history(symbol, days=days).to_csv(output_path, index=False)
        print(f"Wrote sample OHLCV data for {symbol} -> {output_path}")


if __name__ == "__main__":
    write_sample_histories()
