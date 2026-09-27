"""Small in-process token-bucket limiter. Swap for Redis when running more than one API instance.

Keys are per client IP (`limit`), per signed-in user (`limit_user`), or any caller-chosen key (`check`, e.g. per
email address on login, so credential stuffing spread over many IPs is still throttled). See `client_ip` for where
the address comes from.
"""

import hmac
import ipaddress
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


PROXY_SECRET_HEADER = "x-orbit-proxy-secret"  # noqa: S105 - a header name, not a secret
CLIENT_IP_HEADER = "x-orbit-client-ip"


def _valid_ip(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    """The caller's IP, for rate limits and the audit log.

    Without ORBIT_PROXY_SECRET: uvicorn's --proxy-headers already put the left-most X-Forwarded-For entry here. With
    it: the web app's edge proxy (which knows the secret) states the real client IP; any other request is keyed by
    the right-most X-Forwarded-For entry, the one the host's own edge appended (a client can only add entries to
    the left), so spoofing the header no longer moves a caller into a fresh bucket.
    """
    fallback = request.client.host if request.client else "unknown"
    secret = get_settings().proxy_secret
    if secret is None:
        return fallback
    sent = request.headers.get(PROXY_SECRET_HEADER, "")
    if sent and hmac.compare_digest(sent.encode(), secret.get_secret_value().encode()):
        return _valid_ip(request.headers.get(CLIENT_IP_HEADER)) or fallback
    hops = [h for h in ",".join(request.headers.getlist("x-forwarded-for")).split(",") if h.strip()]
    return (_valid_ip(hops[-1]) if hops else None) or fallback


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
