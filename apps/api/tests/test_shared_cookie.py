"""D80: the web app's cookies are shared with the API's own address (api.orbitanswer.com), so the site can call the
API directly instead of through its slow edge proxy, and a host-only cookie from before is moved over."""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from orbit_api.auth.security import COOKIE_DOMAIN_HEADER, cookie_domain
from orbit_api.config import get_settings
from orbit_api.ratelimit import PROXY_SECRET_HEADER

PW = "correct horse battery staple 42"
API = "https://api.orbitanswer.com"


def _request(host: str) -> Request:
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"host", host.encode())],
                    "query_string": b"", "scheme": "https", "server": (host, 443)})


@pytest.mark.parametrize(("env", "web", "host", "override", "expected"), [
    ("production", "https://orbitanswer.com", "api.orbitanswer.com", None, "orbitanswer.com"),
    ("production", "https://orbitanswer.com", "orbitanswer.com", None, "orbitanswer.com"),
    # An API on another site: a Domain the browser can't match would lose the cookie, so host-only.
    ("production", "https://orbitanswer.com", "orbit-api.up.railway.app", None, None),
    ("production", "https://orbitanswer.com", "evilorbitanswer.com", None, None),
    ("production", "http://localhost:5173", "localhost", None, None),
    ("production", "http://127.0.0.1:5173", "127.0.0.1", None, None),
    ("test", "https://orbitanswer.com", "api.orbitanswer.com", None, None),
    ("production", "https://orbitanswer.com", "api.orbitanswer.com", "", None),
    ("test", "http://localhost:5173", "api.example.com", ".Example.com", "example.com"),
])
def test_cookie_domain(monkeypatch: pytest.MonkeyPatch, env: str, web: str, host: str, override: str | None,
                       expected: str | None) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "env", env)
    monkeypatch.setattr(s, "web_url", web)
    monkeypatch.setattr(s, "cookie_domain", override)
    assert cookie_domain(_request(host)) == expected


@pytest.fixture
def shared(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The API at its own address on the web app's site, with its cookies shared."""
    from orbit_api.main import create_app

    monkeypatch.setattr(get_settings(), "cookie_domain", "orbitanswer.com")
    with TestClient(create_app(), base_url=API) as c:
        yield c


def _web() -> dict[str, str]:
    return {"Origin": get_settings().web_url.rstrip("/")}


def _set_cookies(response: object) -> list[str]:
    return [v.lower() for v in response.headers.get_list("set-cookie")]  # type: ignore[attr-defined]


def _sign_in(c: TestClient) -> dict:
    email = f"shared-{uuid.uuid4().hex[:10]}@example.com"
    assert c.post("/v1/auth/register", headers=_web(), json={"email": email, "password": PW}).status_code == 201
    c.cookies.clear()
    r = c.post("/v1/auth/login", headers=_web(), json={"email": email, "password": PW})
    assert r.status_code == 200
    return r.json()


def test_sign_in_sets_one_shared_cookie_and_clears_a_host_only_one(shared: TestClient) -> None:
    c = shared
    email = f"shared-{uuid.uuid4().hex[:10]}@example.com"
    assert c.post("/v1/auth/register", headers=_web(), json={"email": email, "password": PW}).status_code == 201
    c.cookies.clear()
    r = c.post("/v1/auth/login", headers=_web(), json={"email": email, "password": PW})
    cookies = _set_cookies(r)
    gone, kept = cookies[0], cookies[-1]
    # The host-only copy is cleared first, then the shared one set (httpOnly, Lax, the whole site).
    assert gone.startswith(("orbit_session=\"\"", "orbit_session=;")) and "max-age=0" in gone and "domain=" not in gone
    assert kept.startswith("orbit_session=ey") and "domain=orbitanswer.com" in kept and "httponly" in kept
    assert "samesite=lax" in kept and "path=/" in kept
    assert r.headers[COOKIE_DOMAIN_HEADER] == "orbitanswer.com"
    # The shared cookie is the one the next request carries.
    assert c.get("/v1/auth/me").json()["email"] == email

    out = c.post("/v1/auth/logout", headers={**_web(), "X-CSRF-Token": r.json()["user"]["csrf_token"]})
    assert out.status_code == 204
    cleared = _set_cookies(out)
    assert len(cleared) == 2 and all("max-age=0" in v for v in cleared)
    assert ["domain=orbitanswer.com" in v for v in cleared] == [False, True]  # both ways it may be stored
    assert c.get("/v1/auth/me").status_code == 401


def test_a_host_only_cookie_is_shared_when_it_comes_through_the_site(shared: TestClient) -> None:
    c = shared
    _sign_in(c)
    token = c.cookies.get("orbit_session")
    assert token
    # Straight to the API: a fresh cookie isn't touched.
    assert not _set_cookies(c.get("/v1/auth/me"))
    # Through the site's proxy (it signs its requests): the same token again, shared, the host-only copy cleared.
    secret = get_settings().proxy_secret
    assert secret is not None
    r = c.get("/v1/auth/me", headers={PROXY_SECRET_HEADER: secret.get_secret_value()})
    assert r.status_code == 200
    cookies = _set_cookies(r)
    assert "domain=" not in cookies[0] and "max-age=0" in cookies[0]
    assert cookies[-1].startswith(f"orbit_session={token.lower()}") and "domain=orbitanswer.com" in cookies[-1]
    # A wrong secret isn't the site: nothing moved.
    assert not _set_cookies(c.get("/v1/auth/me", headers={PROXY_SECRET_HEADER: "nope"}))


def test_not_shared_no_domain_and_no_header(client: TestClient) -> None:
    email = f"local-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/v1/auth/register", headers=_web(), json={"email": email, "password": PW})
    assert r.status_code == 201
    assert all("domain=" not in v for v in _set_cookies(r))
    assert COOKIE_DOMAIN_HEADER not in r.headers
    client.cookies.clear()


def test_no_header_without_the_proxy_secret(shared: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # A host-only cookie can't be moved over without the site's signed requests: the web app isn't told to go direct.
    monkeypatch.setattr(get_settings(), "proxy_secret", None)
    assert COOKIE_DOMAIN_HEADER not in shared.get("/health").headers
