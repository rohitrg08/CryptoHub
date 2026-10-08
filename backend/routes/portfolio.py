from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from backend.core.assets import asset_name, display_symbol, normalize_symbol
from backend.core.database import get_db
from backend.models.portfolio import PortfolioEntry
from backend.models.user import User
from backend.schemas.portfolio import PortfolioEntryCreate, PortfolioEntryRead
from backend.services.coingecko_service import coingecko_service


router = APIRouter(prefix="/portfolio", tags=["Portfolio"])


@router.get("/", response_model=list[PortfolioEntryRead])
async def get_portfolio(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PortfolioEntryRead]:
    entries = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.user_id == current_user.id)
        .order_by(PortfolioEntry.id.desc())
        .all()
    )

    live_prices = await coingecko_service.get_live_prices()
    response: list[PortfolioEntryRead] = []
    for entry in entries:
        try:
            lookup_symbol = normalize_symbol(entry.symbol)
        except ValueError:
            lookup_symbol = None

        current_price = live_prices.get(lookup_symbol, {}).get("price") if lookup_symbol else None
        current_value = round(current_price * entry.quantity, 2) if current_price else None
        profit_loss = (
            round((current_price - entry.average_buy_price) * entry.quantity, 2)
            if current_price
            else None
        )
        response.append(
            PortfolioEntryRead(
                id=entry.id,
                symbol=entry.symbol,
                asset_name=entry.asset_name,
                quantity=entry.quantity,
                average_buy_price=entry.average_buy_price,
                target_price=entry.target_price,
                current_price=current_price,
                current_value=current_value,
                profit_loss=profit_loss,
            )
        )
    return response


@router.post("/", response_model=PortfolioEntryRead, status_code=status.HTTP_201_CREATED)
def create_portfolio_entry(
    payload: PortfolioEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PortfolioEntryRead:
    try:
        normalized_symbol = normalize_symbol(payload.symbol)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    entry = PortfolioEntry(
        symbol=display_symbol(normalized_symbol),
        asset_name=asset_name(normalized_symbol),
        quantity=payload.quantity,
        average_buy_price=payload.average_buy_price,
        target_price=payload.target_price,
        user_id=current_user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return PortfolioEntryRead.model_validate(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    entry = (
        db.query(PortfolioEntry)
        .filter(PortfolioEntry.id == entry_id, PortfolioEntry.user_id == current_user.id)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Portfolio entry not found.")

    db.delete(entry)
    db.commit()
