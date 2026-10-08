from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "CryptoHub Sales Forecasting Using Machine Learning"
    api_v1_prefix: str = "/api"
    secret_key: str = Field(
        default="change-me-in-production-with-a-secure-random-value",
        min_length=32,
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = f"sqlite:///{(BASE_DIR / 'cryptohub.db').as_posix()}"
    mongodb_url: Optional[str] = None
    mongodb_db: str = "cryptohub"
    news_api_key: Optional[str] = None
    coingecko_base_url: str = "https://api.coingecko.com/api/v3"
    news_api_base_url: str = "https://newsdata.io/api/1"
    frontend_dir: Path = BASE_DIR / "frontend"
    data_dir: Path = BASE_DIR / "data"
    models_dir: Path = BASE_DIR / "models"
    docs_dir: Path = BASE_DIR / "docs"
    allowed_origins: list[str] = ["*"]
    websocket_poll_interval_seconds: int = 15
    default_quote_currency: str = "usd"
    default_history_days: int = 180
    default_ml_window: int = 14
    default_test_ratio: float = 0.2
    forecast_horizon_days: int = 7
    training_train_ratio: float = 0.7
    training_validation_ratio: float = 0.15
    training_test_ratio: float = 0.15
    lstm_epochs: int = 20
    lstm_batch_size: int = 16
    random_forest_random_state: int = 42
    minimum_training_rows: int = 120
    model_metrics_path: Path = BASE_DIR / "data" / "model_metrics.json"
    fiat_rates_to_usd: dict[str, float] = {"USD": 1.0, "EUR": 1.09, "INR": 0.012}
    app_env: Literal["development", "production", "test"] = "development"

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
