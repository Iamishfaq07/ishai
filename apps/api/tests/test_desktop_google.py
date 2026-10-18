"""Continue with Google from the desktop app (D81): loopback redirect + PKCE on top of the web's Google flow.

Google is mocked as in test_google_auth.py (fetch_identity). The browser's half is the TestClient following the API's
redirects by hand; the app's half is the exchange with the verifier.
"""

import hashlib
import secrets
import time
import uuid
from base64 import urlsafe_b64encode
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from functools import partial
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from orbit_api import ratelimit
from orbit_api.auth import desktop_sign_in, google
from orbit_api.auth.two_factor import code_at
from orbit_api.config import get_settings
from tests.test_google_auth import _sign_in_with_google, _state, google_client  # noqa: F401  (fixture)

DESKTOP_UA = {"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0 Tauri/2"}


class App:
    """What the desktop app holds: a verifier, its S256 challenge, a state and the listener's port."""

    def __init__(self, port: int = 49152) -> None:
        self.verifier = secrets.token_urlsafe(48)
        self.challenge = urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).rstrip(b"=").decode()
        self.state = secrets.token_urlsafe(24)
        self.port = port

    def start_path(self) -> str:
        return "/v1/auth/google/start?" + urlencode({
            "desktop_port": self.port, "desktop_challenge": self.challenge, "desktop_state": self.state})


def _fake_google(monkeypatch: pytest.MonkeyPatch, email: str, sub: str | None = None,
                 check: Callable[[str], None] | None = None) -> None:
    async def fake(code: str, verifier: str, uri: str) -> dict[str, str]:
        if check:
            check(uri)
        return {"sub": sub or f"sub-{email}", "email": email, "name": "Ada"}

    monkeypatch.setattr(google, "fetch_identity", fake)


def _browser(client: TestClient, app: App, **callback: str) -> Response:
    """The browser's trip: the start, Google (mocked), and the callback's redirect."""
    start = client.get(app.start_path(), follow_redirects=False)
    assert start.status_code == 302 and start.headers["location"].startswith("https://accounts.google.com/"), start
    query = {"code": "the-code", "state": _state(start.headers["location"]), **callback}
    done: Response = client.get(f"/v1/auth/google/callback?{urlencode(query)}", follow_redirects=False)
    return done


def _loopback(app: App, response: Response) -> dict[str, str]:
    assert response.status_code == 302
    where = urlparse(response.headers["location"])
    assert (where.scheme, where.hostname, where.port, where.path) == ("http", "127.0.0.1", app.port, "/callback")
    query = {k: v[0] for k, v in parse_qs(where.query).items()}
    assert query["state"] == app.state
    return query


def _exchange(client: TestClient, code: str, verifier: str) -> Response:
    r: Response = client.post("/v1/auth/desktop/exchange", json={"code": code, "verifier": verifier},
                              headers=DESKTOP_UA)
    return r


def _email() -> str:
    return f"desk-{uuid.uuid4().hex[:8]}@gmail.com"


def _run(client: TestClient, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    return client.portal.call(partial(fn, *args, **kwargs))  # type: ignore[union-attr]


async def _set_user(email: str, **fields: Any) -> None:
    from sqlalchemy import select

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    async with sessionmaker()() as db:
        user = await db.scalar(select(User).where(User.email == email))
        assert user is not None
        for key, value in fields.items():
            setattr(user, key, value)
        await db.commit()


@pytest.fixture(autouse=True)
def _fresh() -> Iterator[None]:
    desktop_sign_in.forget_all()
    yield
    desktop_sign_in.forget_all()


def test_the_desktop_signs_in_through_the_browser(google_client: TestClient,  # noqa: F811
                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    email, app = _email(), App()
    _fake_google(monkeypatch, email)
    done = _browser(google_client, app)
    query = _loopback(app, done)
    assert set(query) == {"code", "state"}
    # No web session in the browser: the sign-in belongs to the app.
    cookies = done.headers.get_list("set-cookie")
    assert not any(c.startswith("orbit_session=") for c in cookies)
    assert any(c.startswith('orbit_google=""') for c in cookies)
    assert google_client.get("/v1/auth/me").status_code == 401

    google_client.cookies.clear()
    signed = _exchange(google_client, query["code"], app.verifier)
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert body["user"]["email"] == email and body["user"]["has_password"] is False
    token = body["access_token"]
    assert token
    google_client.cookies.clear()
    bearer = {"Authorization": f"Bearer {token}"}
    assert google_client.get("/v1/auth/me", headers=bearer).json()["email"] == email
    # The same device row and label as an email/password sign-in from the app.
    devices = google_client.get("/v1/auth/sessions", headers=bearer).json()
    assert [(d["kind"], d["label"], d["current"]) for d in devices] == [("desktop", "Orbit for Windows", True)]


def test_a_code_works_once_and_only_with_its_verifier(google_client: TestClient,  # noqa: F811
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    email = _email()
    _fake_google(monkeypatch, email)
    app = App()
    code = _loopback(app, _browser(google_client, app))["code"]
    assert _exchange(google_client, code, app.verifier).status_code == 200
    again = _exchange(google_client, code, app.verifier)
    assert again.status_code == 400 and "expired or was already used" in again.json()["detail"]

    # A wrong verifier (someone who saw the code in the browser's history, say) spends the code too.
    app = App()
    code = _loopback(app, _browser(google_client, app))["code"]
    wrong = _exchange(google_client, code, App().verifier)
    assert wrong.status_code == 400 and "access_token" not in wrong.text
    assert _exchange(google_client, code, app.verifier).status_code == 400
    # Junk is refused before anything is looked up.
    assert _exchange(google_client, "nope", "short").status_code == 422
    assert _exchange(google_client, "nope", "x" * 43).status_code == 400


def test_a_code_expires_after_a_minute(google_client: TestClient,  # noqa: F811
                                       monkeypatch: pytest.MonkeyPatch) -> None:
    email, app = _email(), App()
    _fake_google(monkeypatch, email)
    code = _loopback(app, _browser(google_client, app))["code"]
    later = time.monotonic() + desktop_sign_in.CODE_TTL_S + 1
    monkeypatch.setattr(desktop_sign_in, "_clock", lambda: later)
    assert _exchange(google_client, code, app.verifier).status_code == 400


def test_signing_out_everywhere_voids_a_code_not_yet_traded(google_client: TestClient,  # noqa: F811
                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    email, app = _email(), App()
    _fake_google(monkeypatch, email)
    code = _loopback(app, _browser(google_client, app))["code"]
    _run(google_client, _set_user, email, token_version=5)
    assert _exchange(google_client, code, app.verifier).status_code == 400


@pytest.mark.parametrize("port", ["80", "1023", "65536", "0", "-1", "8000@evil.example", "abc", "", "１２３４５"])
def test_a_bad_port_never_leaves_the_site(google_client: TestClient, port: str) -> None:  # noqa: F811
    app = App()
    query = urlencode({"desktop_port": port, "desktop_challenge": app.challenge, "desktop_state": app.state})
    r = google_client.get(f"/v1/auth/google/start?{query}", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "http://localhost:5173/login?error=google"


@pytest.mark.parametrize("query", [
    {"desktop_port": "49152"},
    {"desktop_port": "49152", "desktop_challenge": "x" * 43},
    {"desktop_port": "49152", "desktop_challenge": "not a challenge!", "desktop_state": "s" * 20},
    {"desktop_port": "49152", "desktop_challenge": "c" * 43, "desktop_state": "short"},
    {"desktop_port": "49152", "desktop_challenge": "c" * 44, "desktop_state": "s" * 20},
])
def test_half_a_desktop_request_is_refused(google_client: TestClient, query: dict[str, str]) -> None:  # noqa: F811
    r = google_client.get(f"/v1/auth/google/start?{urlencode(query)}", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].endswith("/login?error=google")


def test_refusals_go_back_to_the_app(google_client: TestClient,  # noqa: F811
                                     monkeypatch: pytest.MonkeyPatch) -> None:
    # Google's page: "Cancel".
    app = App()
    start = google_client.get(app.start_path(), follow_redirects=False)
    denied = google_client.get(
        f"/v1/auth/google/callback?error=access_denied&state={_state(start.headers['location'])}",
        follow_redirects=False)
    assert _loopback(app, denied) == {"error": "denied", "state": app.state}

    # A Google account without a confirmed email.
    async def unverified(code: str, verifier: str, uri: str) -> dict[str, str]:
        raise google.GoogleDenied("unverified")

    monkeypatch.setattr(google, "fetch_identity", unverified)
    app = App()
    assert _loopback(app, _browser(google_client, app))["error"] == "unverified"

    # A forged state.
    app = App()
    google_client.get(app.start_path(), follow_redirects=False)
    forged = google_client.get("/v1/auth/google/callback?code=x&state=nope", follow_redirects=False)
    assert _loopback(app, forged)["error"] == "google"

    # Anything unexpected.
    async def broken(code: str, verifier: str, uri: str) -> dict[str, str]:
        raise RuntimeError("boom")

    monkeypatch.setattr(google, "fetch_identity", broken)
    app = App()
    assert _loopback(app, _browser(google_client, app))["error"] == "server"


def test_google_off_goes_back_to_the_app(client: TestClient) -> None:
    app = App()
    off = client.get(app.start_path(), follow_redirects=False)
    assert _loopback(app, off) == {"error": "google_off", "state": app.state}


def test_too_many_attempts_go_back_to_the_app(google_client: TestClient,  # noqa: F811
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    ratelimit.reset_all()
    try:
        app = App()
        answers = [google_client.get(app.start_path(), follow_redirects=False) for _ in range(12)]
        assert _loopback(app, answers[-1]) == {"error": "busy", "state": app.state}
        # The exchange is held to the same sign-in limit.
        assert _exchange(google_client, "x", "y" * 43).status_code == 429
    finally:
        ratelimit.reset_all()


def test_a_suspended_account_is_told_in_the_app(google_client: TestClient,  # noqa: F811
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    email = _email()
    _sign_in_with_google(google_client, monkeypatch, email, f"sub-{email}")
    google_client.cookies.clear()
    _run(google_client, _set_user, email, suspended_at=datetime.now(UTC))
    app = App()
    assert _loopback(app, _browser(google_client, app))["error"] == "suspended"

    # Suspended between Google and the exchange: no token either.
    _run(google_client, _set_user, email, suspended_at=None)
    app = App()
    code = _loopback(app, _browser(google_client, app))["code"]
    _run(google_client, _set_user, email, suspended_at=datetime.now(UTC))
    refused = _exchange(google_client, code, app.verifier)
    assert refused.status_code == 403 and "access_token" not in refused.text


def test_two_step_sign_in_is_asked_for_as_after_a_password(google_client: TestClient,  # noqa: F811
                                                           monkeypatch: pytest.MonkeyPatch) -> None:
    email = _email()
    _sign_in_with_google(google_client, monkeypatch, email, f"sub-{email}")
    h = {"X-CSRF-Token": google_client.get("/v1/auth/me").json()["csrf_token"]}
    secret = google_client.post("/v1/auth/2fa/setup", headers=h, json={"password": ""}).json()["secret"]
    step = int(time.time() // 30) - 1
    assert google_client.post("/v1/auth/2fa/enable", headers=h, json={"code": code_at(secret, step)}).status_code == 200
    google_client.cookies.clear()

    app = App()
    done = _browser(google_client, app)
    code = _loopback(app, done)["code"]
    assert not any(c.startswith("orbit_2fa=") for c in done.headers.get_list("set-cookie"))
    pending = _exchange(google_client, code, app.verifier)
    assert pending.status_code == 200
    assert pending.json()["two_factor_required"] is True and "access_token" not in pending.json()
    google_client.cookies.clear()
    finished = google_client.post("/v1/auth/login/2fa", headers=DESKTOP_UA,
                                  json={"challenge": pending.json()["challenge"], "code": code_at(secret, step + 1)})
    assert finished.status_code == 200, finished.text
    assert finished.json()["access_token"] and finished.json()["user"]["email"] == email


def test_the_web_flow_is_unchanged(google_client: TestClient,  # noqa: F811
                                   monkeypatch: pytest.MonkeyPatch) -> None:
    email = _email()
    _fake_google(monkeypatch, email)
    start = google_client.get("/v1/auth/google/start?next=/jobs", follow_redirects=False)
    done = google_client.get(f"/v1/auth/google/callback?code=c&state={_state(start.headers['location'])}",
                             follow_redirects=False)
    assert done.headers["location"] == "http://localhost:5173/welcome"
    assert google_client.get("/v1/auth/me").json()["email"] == email


@pytest.mark.parametrize("redirect", [None, "https://api.orbitanswer.com/v1/auth/google/callback"])
def test_both_redirect_uris_work(monkeypatch: pytest.MonkeyPatch, redirect: str | None) -> None:
    """Production today: Google returns through the site's /api proxy (no ORBIT_GOOGLE_REDIRECT_URI), the app opened
    the start at api.orbitanswer.com, and the state cookie is shared across the site (D80). Soon, maybe: Google returns
    to the API's own address. The desktop flow needs no new redirect URI in Google's console either way."""
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_ID", "orbit-client")
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_SECRET", "orbit-secret")
    monkeypatch.setenv("ORBIT_WEB_URL", "https://orbitanswer.com")
    monkeypatch.setenv("ORBIT_COOKIE_DOMAIN", "orbitanswer.com")
    if redirect:
        monkeypatch.setenv("ORBIT_GOOGLE_REDIRECT_URI", redirect)
    else:
        monkeypatch.delenv("ORBIT_GOOGLE_REDIRECT_URI", raising=False)
    expected = redirect or "https://orbitanswer.com/api/v1/auth/google/callback"
    get_settings.cache_clear()
    from orbit_api.main import create_app

    email, app = _email(), App()

    def check(uri: str) -> None:
        assert uri == expected

    _fake_google(monkeypatch, email, check=check)
    try:
        with TestClient(create_app(), base_url="https://api.orbitanswer.com") as direct:
            start = direct.get(app.start_path(), follow_redirects=False)
            assert parse_qs(urlparse(start.headers["location"]).query)["redirect_uri"] == [expected]
            state, packed = _state(start.headers["location"]), direct.cookies.get("orbit_google")
            callback_host = urlparse(expected).netloc
            with TestClient(create_app(), base_url=f"https://{callback_host}") as back:
                back.cookies.set("orbit_google", packed or "", domain=".orbitanswer.com")
                path = urlparse(expected).path.removeprefix("/api")
                done = back.get(f"{path}?code=c&state={state}", follow_redirects=False)
                code = _loopback(app, done)["code"]
            direct.cookies.clear()
            signed = direct.post("/v1/auth/desktop/exchange", json={"code": code, "verifier": app.verifier},
                                 headers={**DESKTOP_UA, "origin": "http://tauri.localhost"})
            assert signed.status_code == 200 and signed.json()["access_token"]
    finally:
        get_settings.cache_clear()


def test_parse_and_loopback_build_only_127_0_0_1() -> None:
    app = App(port=65535)
    desktop = desktop_sign_in.parse("65535", app.challenge, app.state)
    assert desktop is not None
    assert desktop_sign_in.loopback(desktop, code="a b&c").startswith("http://127.0.0.1:65535/callback?code=a+b%26c&")
    assert desktop_sign_in.from_claims(desktop_sign_in.claims(desktop)) == desktop
    assert desktop_sign_in.from_claims({"dp": "65535", "dc": app.challenge, "ds": app.state}) is None
    assert desktop_sign_in.parse("1024", app.challenge, app.state) is not None
    assert desktop_sign_in.s256(app.verifier) == app.challenge
    # RFC 7636 appendix B.
    assert desktop_sign_in.s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == \
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
