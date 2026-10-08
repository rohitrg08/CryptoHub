from __future__ import annotations

import pytest

from backend.services.conversion_service import conversion_service


@pytest.mark.asyncio
async def test_crypto_and_fiat_conversion_output() -> None:
    btc_to_usd = await conversion_service.convert("BTC", "USD", 1)
    usd_to_inr = await conversion_service.convert("USD", "INR", 1)

    assert btc_to_usd["converted_amount"] > 0
    assert btc_to_usd["rate"] > 0
    assert usd_to_inr["converted_amount"] > 0
    assert usd_to_inr["rate"] > 0
