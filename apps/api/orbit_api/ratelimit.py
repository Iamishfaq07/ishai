"""Small in-process token-bucket limiter. Swap for Redis when running more than one API instance."""

import time
from collections.abc import Callable

from fastapi import HTTPException, Request, status

from orbit_api.config import get_settings


class TokenBucket:
    def __init__(self, rate_per_s: float, burst: int) -> None:
        self.rate = rate_per_s
        self.burst = burst
        self._buckets: dict[str, tuple[float, float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        tokens, last = self._buckets.get(key, (float(self.burst), now))
        tokens = min(self.burst, tokens + (now - last) * self.rate)
        if len(self._buckets) > 50_000:
            self._buckets.clear()
        if tokens < 1:
            self._buckets[key] = (tokens, now)
            return False
        self._buckets[key] = (tokens - 1, now)
        return True


def limit(name: str, rate_per_s: float, burst: int) -> Callable[[Request], None]:
    bucket = TokenBucket(rate_per_s, burst)

    def dep(request: Request) -> None:
        if get_settings().env == "test":
            return
        ip = request.client.host if request.client else "unknown"
        if not bucket.allow(f"{name}:{ip}"):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests — slow down.")

    return dep
