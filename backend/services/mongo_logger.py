from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.core.config import get_settings

settings = get_settings()

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
except ImportError:  # pragma: no cover
    MongoClient = None
    PyMongoError = Exception


class MongoLogger:
    """Optional logger that stores streaming and analytics events in MongoDB."""

    def __init__(self) -> None:
        self.client = None
        self.database = None
        self.enabled = False
        if settings.mongodb_url and MongoClient:
            self.client = MongoClient(
                settings.mongodb_url,
                serverSelectionTimeoutMS=1500,
                connectTimeoutMS=1500,
                socketTimeoutMS=1500,
            )
            self.database = self.client[settings.mongodb_db]
            self.enabled = True

    def log_event(self, collection: str, payload: dict[str, Any]) -> None:
        if not self.database or not self.enabled:
            return

        document = {"created_at": datetime.now(timezone.utc), **payload}
        try:
            self.database[collection].insert_one(document)
        except PyMongoError:
            # Optional logging should never block app behavior in local/offline setups.
            self.enabled = False


mongo_logger = MongoLogger()
