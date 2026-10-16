"""GET /v1/region (orbit_api/geo.py): the visitor's country for signed-out pages, believed only from the web app's
edge (the proxy secret), the way prices are (billing/pricing.py)."""

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from orbit_api.config import get_settings

PROXY = "p" * 32


def _edge(country: str) -> dict[str, str]:
    """A request through the web app's edge proxy, which states the visitor's country."""
    return {"X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-Country": country}


def test_the_edge_says_where_the_visitor_is(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    client.cookies.clear()
    r = client.get("/v1/region", headers=_edge("us"))
    assert r.status_code == 200 and r.json() == {"country": "US"}
    assert r.headers["cache-control"] == "no-store"  # per visitor, like everything else here
    assert "set-cookie" not in r.headers  # the cookie notice promises only the sign-in cookie
    assert client.get("/v1/region", headers=_edge("GB")).json() == {"country": "GB"}
    assert client.get("/v1/region", headers=_edge("IN")).json() == {"country": "IN"}


def test_unknown_or_unbelievable_is_null(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    client.cookies.clear()
    # Nothing said, or something that isn't a country (Cloudflare's "XX" and Tor's "T1" never reach here).
    assert client.get("/v1/region").json() == {"country": None}
    assert client.get("/v1/region", headers=_edge("XX")).json() == {"country": None}
    # A direct caller can't choose its country: without the secret the header is ignored.
    assert client.get("/v1/region", headers={"X-Orbit-Client-Country": "US"}).json() == {"country": None}
    wrong = {"X-Orbit-Proxy-Secret": "q" * 32, "X-Orbit-Client-Country": "US"}
    assert client.get("/v1/region", headers=wrong).json() == {"country": None}
