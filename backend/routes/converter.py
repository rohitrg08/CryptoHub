from fastapi import APIRouter, HTTPException, Query

from backend.services.conversion_service import conversion_service


router = APIRouter(prefix="/converter", tags=["Converter"])


@router.get("/convert")
async def convert_currency(
    from_currency: str = Query(..., alias="from_currency"),
    to_currency: str = Query(..., alias="to_currency"),
    amount: float = Query(..., gt=0),
) -> dict:
    try:
        return await conversion_service.convert(from_currency, to_currency, amount)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
