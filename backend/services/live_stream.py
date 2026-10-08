from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import WebSocket

from backend.core.config import get_settings
from backend.services.coingecko_service import coingecko_service
from backend.services.mongo_logger import mongo_logger


settings = get_settings()


class ConnectionManager:
    """Tracks active WebSocket clients and broadcasts live price snapshots."""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        disconnected: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection)


class LivePriceStreamer:
    """Background task that polls live prices and broadcasts them to clients."""

    def __init__(self, manager: ConnectionManager) -> None:
        self.manager = manager
        self.task: asyncio.Task | None = None

    async def start(self) -> None:
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._run())

    async def get_snapshot(self) -> dict:
        return await coingecko_service.get_live_prices()

    async def _run(self) -> None:
        while True:
            try:
                prices = await coingecko_service.get_live_prices()
                payload = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "prices": prices,
                }
                mongo_logger.log_event("live_prices", payload)
                if self.manager.active_connections:
                    await self.manager.broadcast(payload)
            except Exception:
                pass
            await asyncio.sleep(settings.websocket_poll_interval_seconds)


connection_manager = ConnectionManager()
live_price_streamer = LivePriceStreamer(connection_manager)
