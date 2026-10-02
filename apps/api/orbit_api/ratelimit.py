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
MAX_KEYS = 50_000


class TokenBucket:
    def __init__(self, rate_per_s: float, burst: int) -> None:
        self.rate = rate_per_s
        self.burst = burst
        self._buckets: dict[str, tuple[float, float]] = {}
        _all_buckets.add(self)

    def _tokens(self, key: str, now: float) -> float:
        tokens, last = self._buckets.get(key, (float(self.burst), now))
        return min(self.burst, tokens + (now - last) * self.rate)

    def _evict(self) -> None:
        # Full: forget the least recently touched tenth, not everything. Clearing all of it would let a flood of
        # junk keys reset every throttle (a victim's login bucket included).
        if len(self._buckets) <= MAX_KEYS:
            return
        oldest = sorted(self._buckets.items(), key=lambda kv: kv[1][1])[: MAX_KEYS // 10]
        for k, _ in oldest:
            del self._buckets[k]

    def peek(self, key: str) -> bool:
        """Whether a request would be allowed, without spending a token (e.g. before checking a password)."""
        return self._tokens(key, time.monotonic()) >= 1

    def spend(self, key: str) -> None:
        """Take a token whether or not one is left (e.g. after a failed password)."""
        now = time.monotonic()
        self._evict()
        self._buckets[key] = (max(self._tokens(key, now) - 1, -1.0), now)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        tokens = self._tokens(key, now)
        self._evict()
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

    The web app's edge proxy (which knows ORBIT_PROXY_SECRET) states the real client IP. Any other request is keyed
    by the right-most X-Forwarded-For entry, the one the host's own edge appended: a client can only add entries to
    the left, so a spoofed header can't move a caller into a fresh bucket. (uvicorn's --proxy-headers takes the
    left-most entry, which the caller controls, so `request.client` is only the last resort.)
    """
    fallback = request.client.host if request.client else "unknown"
    secret = get_settings().proxy_secret
    sent = request.headers.get(PROXY_SECRET_HEADER, "")
    if secret is not None and sent and hmac.compare_digest(sent.encode(), secret.get_secret_value().encode()):
        return _valid_ip(request.headers.get(CLIENT_IP_HEADER)) or fallback
    hops = [h for h in ",".join(request.headers.getlist("x-forwarded-for")).split(",") if h.strip()]
    return (_valid_ip(hops[-1]) if hops else None) or fallback


def network_of(ip: str) -> str:
    """What counts as one caller for limits: an IPv4 address, or an IPv6 /64 (one home or one server usually owns a
    whole /64, so keying on the full address hands an attacker 2^64 fresh buckets)."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.IPv6Network((addr, 64), strict=False))
    return str(addr)


def client_network(request: Request) -> str:
    return network_of(client_ip(request))


def check(bucket: TokenBucket, key: str, message: str = TOO_MANY) -> None:
    if get_settings().env == "test" and not ENFORCE_IN_TESTS:
        return
    if not bucket.allow(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)


def _enforced() -> bool:
    return get_settings().env != "test" or ENFORCE_IN_TESTS


def blocked(bucket: TokenBucket, key: str) -> bool:
    """Out of tokens (without spending one): for throttles that count only failures."""
    return _enforced() and not bucket.peek(key)


def failed(bucket: TokenBucket, key: str) -> None:
    """Count a failure (a wrong password) against `key`."""
    if _enforced():
        bucket.spend(key)


def limit(name: str, rate_per_s: float, burst: int) -> Callable[[Request], None]:
    """Per client IP."""
    bucket = TokenBucket(rate_per_s, burst)

    def dep(request: Request) -> None:
        check(bucket, f"{name}:{client_network(request)}")

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
