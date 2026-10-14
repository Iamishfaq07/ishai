"""Outbound HTTP for the job sources: only to the providers' own fixed hosts, never a URL a user gave.

Every request names itself (USER_AGENT, so a provider can see who's calling and reach us), has a short timeout, a
size cap on the body, no proxy from the environment and no redirects (an API that suddenly redirects has changed,
and following it could lead anywhere). A 429 or a 503 becomes `RateLimited` with the wait the provider asked for, so
the source backs off instead of retrying.
"""

import json
from typing import Any
from urllib.parse import urlsplit

import httpx

USER_AGENT = "OrbitJobs/1.0 (+https://orbitanswer.com)"
TIMEOUT = httpx.Timeout(20.0, connect=8.0)
MAX_BYTES = 30_000_000  # the biggest boards (Databricks' ~900 posts with their text) are ~10 MB


class SourceError(Exception):
    """A fetch that failed; the message is for logs and the admin, never shown to users as is."""


class RateLimited(SourceError):
    def __init__(self, message: str, retry_after_s: float) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


def _retry_after(value: str | None) -> float:
    try:
        return max(60.0, min(float(value or ""), 24 * 3600.0))
    except ValueError:
        return 3600.0


class FeedClient:
    """One client per refresh run. `transport` is for tests (httpx.MockTransport): nothing here reaches the network
    in the test suite."""

    def __init__(self, allowed_hosts: frozenset[str], transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.allowed_hosts = allowed_hosts
        self._client = httpx.AsyncClient(transport=transport, timeout=TIMEOUT, trust_env=False,
                                         follow_redirects=False,
                                         headers={"User-Agent": USER_AGENT, "Accept": "application/json"})

    async def __aenter__(self) -> "FeedClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def get_json(self, url: str, *, params: dict[str, Any] | None = None,
                       headers: dict[str, str] | None = None, max_bytes: int = MAX_BYTES) -> Any:
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.hostname not in self.allowed_hosts:
            raise SourceError(f"refused to call {parts.hostname!r}: not a job source host")
        try:
            async with self._client.stream("GET", url, params=params, headers=headers) as resp:
                if resp.status_code in (429, 503):
                    raise RateLimited(f"HTTP {resp.status_code} from {parts.hostname}",
                                      _retry_after(resp.headers.get("retry-after")))
                if resp.is_redirect:
                    raise SourceError(f"HTTP {resp.status_code} redirect from {parts.hostname}")
                if resp.status_code >= 400:
                    raise SourceError(f"HTTP {resp.status_code} from {parts.hostname}")
                body = bytearray()
                async for chunk in resp.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise SourceError(f"response from {parts.hostname} is over {max_bytes // 1_000_000} MB")
        except httpx.HTTPError as e:
            raise SourceError(f"{type(e).__name__} calling {parts.hostname}") from e
        try:
            return json.loads(body)  # straight from the bytearray: a copy of a 10 MB board would double the peak
        except ValueError as e:
            raise SourceError(f"{parts.hostname} sent something that isn't JSON") from e
