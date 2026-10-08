from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Coroutine, Optional


class InMemoryCache:
    """High-performance async in-memory cache with TTL and stale-while-revalidate."""

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    def get(self, key: str) -> Optional[Any]:
        """Return value if key exists and has not expired."""
        entry = self._cache.get(key)
        if not entry:
            return None

        now = time.monotonic()
        if now > entry["expires_at"]:
            return None
        return entry["value"]

    def get_stale(self, key: str) -> Optional[Any]:
        """Return value even if expired (used as fallback during network failure)."""
        entry = self._cache.get(key)
        if not entry:
            return None
        return entry["value"]

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        """Store value with expiration timestamp."""
        self._cache[key] = {
            "value": value,
            "expires_at": time.monotonic() + ttl_seconds,
            "stored_at": time.time(),
        }

    def delete(self, key: str) -> None:
        """Remove key from cache."""
        self._cache.pop(key, None)

    def clear(self) -> None:
        """Clear all cache entries."""
        self._cache.clear()

    async def get_or_set(
        self,
        key: str,
        producer: Callable[[], Coroutine[Any, Any, Any]],
        ttl_seconds: float,
        stale_fallback: bool = True,
    ) -> Any:
        """Get cached value, or compute using async producer function."""
        cached_value = self.get(key)
        if cached_value is not None:
            return cached_value

        async with self._lock:
            # Check again after acquiring lock
            cached_value = self.get(key)
            if cached_value is not None:
                return cached_value

            try:
                computed_value = await producer()
                self.set(key, computed_value, ttl_seconds)
                return computed_value
            except Exception as exc:
                if stale_fallback:
                    stale = self.get_stale(key)
                    if stale is not None:
                        return stale
                raise exc


cache_service = InMemoryCache()
