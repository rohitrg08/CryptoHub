from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.models import ForecastHistory, ModelMetricRecord, PortfolioEntry, PredictionHistory, User
from backend.core.config import get_settings
from backend.core.database import Base, engine
from backend.routes.admin import router as admin_router
from backend.routes.analytics import router as analytics_router
from backend.routes.auth import router as auth_router
from backend.routes.converter import router as converter_router
from backend.routes.crypto import router as crypto_router
from backend.routes.models import router as model_router
from backend.routes.portfolio import router as portfolio_router
from backend.services.live_stream import connection_manager, live_price_streamer


settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)

app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(portfolio_router, prefix=settings.api_v1_prefix)
app.include_router(analytics_router, prefix=settings.api_v1_prefix)
app.include_router(crypto_router, prefix=settings.api_v1_prefix)
app.include_router(converter_router, prefix=settings.api_v1_prefix)
app.include_router(model_router, prefix=settings.api_v1_prefix)
app.include_router(admin_router, prefix=settings.api_v1_prefix)


@app.on_event("startup")
async def on_startup() -> None:
    await live_price_streamer.start()


@app.websocket("/ws/prices")
async def price_stream(websocket: WebSocket) -> None:
    await connection_manager.connect(websocket)
    try:
        prices = await live_price_streamer.get_snapshot()
        await websocket.send_json({"timestamp": datetime.now(timezone.utc).isoformat(), "prices": prices})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket)
    except Exception:
        connection_manager.disconnect(websocket)


frontend_dir = Path(settings.frontend_dir)
assets_dir = frontend_dir / "assets"
if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    return FileResponse(frontend_dir / "index.html")


@app.get("/{page_name}.html", include_in_schema=False)
async def serve_frontend_page(page_name: str) -> FileResponse:
    page_path = frontend_dir / f"{page_name}.html"
    if not page_path.is_file():
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Page not found")
    return FileResponse(page_path)
