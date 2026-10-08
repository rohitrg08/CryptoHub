from fastapi import APIRouter, HTTPException

from backend.services.random_forest_service import random_forest_service


router = APIRouter(prefix="/models", tags=["Models"])


@router.get("/{symbol}")
async def model_information(symbol: str) -> dict:
    try:
        return await random_forest_service.get_model_info(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
