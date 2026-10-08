from fastapi import APIRouter, Body, Depends, HTTPException

from backend.auth.dependencies import require_role
from backend.models.user import User, UserRole
from backend.services.random_forest_service import random_forest_service


router = APIRouter(prefix="/admin", tags=["Admin"])


@router.post("/models/train")
async def retrain_models(
    payload: dict | None = Body(default=None),
    _: User = Depends(require_role(UserRole.ADMIN)),
) -> dict:
    symbols = None
    if payload and isinstance(payload.get("symbols"), list):
        symbols = [str(symbol) for symbol in payload["symbols"]]

    try:
        return await random_forest_service.train_models(symbols=symbols)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
