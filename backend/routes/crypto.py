from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.core.assets import list_supported_cryptocurrencies, normalize_symbol
from backend.services.coingecko_service import coingecko_service


router = APIRouter(prefix="/crypto", tags=["Crypto"])


@router.get("/supported")
async def get_supported_cryptocurrencies() -> dict:
    return {"cryptocurrencies": list_supported_cryptocurrencies()}


@router.get("/prices/live")
async def get_live_prices() -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prices": await coingecko_service.get_live_prices(),
    }


@router.get("/history/{symbol}")
async def get_history(symbol: str, days: int = 180) -> dict:
    try:
        normalized_symbol = normalize_symbol(symbol)
        frame = await coingecko_service.get_live_ohlcv(normalized_symbol, days=days)
        return {
            "symbol": normalized_symbol,
            "points": [
                {
                    "timestamp": row.date.to_pydatetime().isoformat(),
                    "open": round(float(row.open), 6),
                    "high": round(float(row.high), 6),
                    "low": round(float(row.low), 6),
                    "close": round(float(row.close), 6),
                    "price": round(float(row.close), 6),
                    "volume": round(float(row.volume), 6),
                }
                for row in frame.itertuples()
            ],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
