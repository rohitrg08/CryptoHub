from __future__ import annotations

from datetime import datetime, timezone

from backend.core.assets import FIAT_CURRENCIES, is_fiat_currency, normalize_currency
from backend.core.config import get_settings
from backend.services.coingecko_service import coingecko_service


settings = get_settings()


class ConversionService:
    async def convert(self, from_currency: str, to_currency: str, amount: float) -> dict:
        if amount <= 0:
            raise ValueError("Amount must be greater than zero.")

        source = normalize_currency(from_currency)
        target = normalize_currency(to_currency)
        if source == target:
            return {
                "from_currency": source,
                "to_currency": target,
                "amount": amount,
                "converted_amount": amount,
                "rate": 1.0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        live_prices = await coingecko_service.get_live_prices()
        amount_in_usd = amount * self._unit_price_in_usd(source, live_prices)
        target_price_usd = self._unit_price_in_usd(target, live_prices)
        converted_amount = amount_in_usd / target_price_usd
        rate = converted_amount / amount

        return {
            "from_currency": source,
            "to_currency": target,
            "amount": round(float(amount), 8),
            "converted_amount": round(float(converted_amount), 8),
            "rate": round(float(rate), 8),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _unit_price_in_usd(self, currency: str, live_prices: dict[str, dict[str, float]]) -> float:
        if is_fiat_currency(currency):
            rate_to_usd = settings.fiat_rates_to_usd.get(currency) or FIAT_CURRENCIES[currency]["rate_to_usd"]
            return float(rate_to_usd)

        market_price = live_prices.get(currency, {}).get("price")
        if market_price is None:
            raise ValueError(f"Live market price is unavailable for {currency}.")
        return float(market_price)


conversion_service = ConversionService()
