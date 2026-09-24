"""Small in-process token-bucket limiter. Swap for Redis when running more than one API instance.

Keys are per client IP (`limit`), per signed-in user (`limit_user`), or any caller-chosen key (`check`, e.g. per
email address on login, so credential stuffing spread over many IPs is still throttled). Client IPs come from
`X-Forwarded-For` only because uvicorn runs with `--forwarded-allow-ips` behind the host's proxy; without it every
request would share the proxy's address, and so one bucket.
"""

import time
import weakref
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.models import User

TOO_MANY = "Too many requests — slow down."
# Limits are skipped in the test environment so the suite can hammer endpoints; rate-limit tests flip this.
ENFORCE_IN_TESTS = False


_all_buckets: "weakref.WeakSet[TokenBucket]" = weakref.WeakSet()


class TokenBucket:
    def __init__(self, rate_per_s: float, burst: int) -> None:
        self.rate = rate_per_s
        self.burst = burst
        self._buckets: dict[str, tuple[float, float]] = {}
        _all_buckets.add(self)

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


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check(bucket: TokenBucket, key: str, message: str = TOO_MANY) -> None:
    if get_settings().env == "test" and not ENFORCE_IN_TESTS:
        return
    if not bucket.allow(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)


def limit(name: str, rate_per_s: float, burst: int) -> Callable[[Request], None]:
    """Per client IP."""
    bucket = TokenBucket(rate_per_s, burst)

    def dep(request: Request) -> None:
        check(bucket, f"{name}:{client_ip(request)}")

    return dep


def limit_user(name: str, rate_per_s: float, burst: int) -> Callable[..., Awaitable[None]]:
    """Per signed-in user — for provider-cost endpoints, where IP limits alone are easy to spread out."""
    bucket = TokenBucket(rate_per_s, burst)

    async def dep(user: Annotated[User, Depends(current_user)]) -> None:
        check(bucket, f"{name}:{user.id}")

    return dep


def reset_all() -> None:
    """Forget every bucket's state (tests)."""
    for bucket in list(_all_buckets):
        bucket._buckets.clear()
