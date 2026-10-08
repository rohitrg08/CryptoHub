from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_supported_assets_endpoint_returns_all_symbols() -> None:
    response = client.get("/api/crypto/supported")
    payload = response.json()

    assert response.status_code == 200
    assert len(payload["cryptocurrencies"]) >= 8
    symbols = {entry["symbol"] for entry in payload["cryptocurrencies"]}
    assert {"BTC", "ETH", "BNB", "XRP", "SOL", "ADA", "DOGE", "AVAX"}.issubset(symbols)


def test_live_history_and_snapshot_endpoints_work() -> None:
    prices_response = client.get("/api/crypto/prices/live")
    history_response = client.get("/api/crypto/history/BTC?days=30")
    snapshot_response = client.get("/api/analytics/snapshot")

    assert prices_response.status_code == 200
    assert history_response.status_code == 200
    assert snapshot_response.status_code == 200
    assert "prices" in snapshot_response.json()
