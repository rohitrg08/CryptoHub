from pydantic import BaseModel, ConfigDict, Field


class PortfolioEntryCreate(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    asset_name: str | None = Field(default=None, min_length=2, max_length=50)
    quantity: float = Field(gt=0)
    average_buy_price: float = Field(gt=0)
    target_price: float | None = Field(default=None, gt=0)


class PortfolioEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    asset_name: str
    quantity: float
    average_buy_price: float
    target_price: float | None = None
    current_price: float | None = None
    current_value: float | None = None
    profit_loss: float | None = None
