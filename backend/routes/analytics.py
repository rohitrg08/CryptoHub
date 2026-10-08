from fastapi import APIRouter, HTTPException

from backend.services.model_service import forecast_service
from backend.services.random_forest_service import random_forest_service
from backend.services.technical_analysis_service import technical_analysis_service


router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/forecast/{symbol}")
async def forecast_symbol(symbol: str) -> dict:
    try:
        return await forecast_service.forecast_symbol(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/backtest/{symbol}")
async def backtest_symbol(symbol: str) -> dict:
    try:
        return await random_forest_service.get_backtest(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/model-metrics/{symbol}")
async def model_metrics(symbol: str) -> dict:
    try:
        return await random_forest_service.get_model_metrics(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/technical/{symbol}")
async def technical_analysis(symbol: str, days: int = 180) -> dict:
    try:
        return await technical_analysis_service.get_technical_data(symbol, days=days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/news/{symbol}")
async def news_summary(symbol: str) -> dict:
    try:
        return await forecast_service.get_news_summary(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/snapshot")
async def market_snapshot() -> dict:
    return await forecast_service.market_snapshot()
