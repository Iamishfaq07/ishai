"""Continue with Google: the button stays hidden until it's configured, and a verified Google email signs in."""

import re
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from orbit_api.auth import google
from orbit_api.config import get_settings
from orbit_api.providers.email import DevOutbox, get_email_sender


@pytest.fixture
def google_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_ID", "orbit-client")
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_SECRET", "orbit-secret")
    monkeypatch.setenv("ORBIT_GOOGLE_REDIRECT_URI", "http://testserver/v1/auth/google/callback")
    get_settings.cache_clear()
    from orbit_api.main import create_app

    with TestClient(create_app()) as client:
        yield client
    get_settings.cache_clear()


def _state(location: str) -> str:
    return parse_qs(urlparse(location).query)["state"][0]


def test_google_is_off_until_configured(client: TestClient) -> None:
    assert client.get("/v1/auth/config").json()["google"] is False
    assert client.get("/v1/auth/google/start", follow_redirects=False).status_code == 404


def test_google_creates_then_signs_in_again(google_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    ident = {"sub": "google-sub-1", "email": "ada@gmail.com", "name": "Ada Lovelace"}

    async def fake(code: str, verifier: str, uri: str) -> dict[str, str]:
        assert code == "the-code" and verifier and uri.endswith("/google/callback")
        return ident

    monkeypatch.setattr(google, "fetch_identity", fake)
    start = google_client.get("/v1/auth/google/start?next=/jobs", follow_redirects=False)
    assert start.status_code == 302
    assert start.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    state = _state(start.headers["location"])

    done = google_client.get(f"/v1/auth/google/callback?code=the-code&state={state}", follow_redirects=False)
    assert done.status_code == 302
    assert done.headers["location"].endswith("/welcome")
    me = google_client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "ada@gmail.com"
    assert me.json()["email_verified"] is True
    assert me.json()["has_password"] is False

    again = google_client.get("/v1/auth/google/start?next=/jobs", follow_redirects=False)
    back = google_client.get(
        f"/v1/auth/google/callback?code=the-code&state={_state(again.headers['location'])}",
        follow_redirects=False,
    )
    assert back.headers["location"].endswith("/jobs")


def test_google_links_a_confirmed_email_only(google_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    email = "existing-google@example.com"
    created = google_client.post("/v1/auth/register", json={"email": email, "password": "a real password 1"})
    assert created.status_code == 201
    google_client.cookies.clear()

    async def fake(code: str, verifier: str, uri: str) -> dict[str, str | None]:
        return {"sub": "google-sub-2", "email": email, "name": None}

    monkeypatch.setattr(google, "fetch_identity", fake)
    start = google_client.get("/v1/auth/google/start", follow_redirects=False)
    held = google_client.get(
        f"/v1/auth/google/callback?code=ok&state={_state(start.headers['location'])}",
        follow_redirects=False,
    )
    # The password account never confirmed the inbox. Google just did, so it takes the account and the old
    # password stops working (whoever registered the address first no longer has a way in).
    assert held.status_code == 302 and "google=claimed" in held.headers["location"]
    me = google_client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == email and me.json()["has_password"] is False and me.json()["email_verified"] is True
    google_client.cookies.clear()
    denied = google_client.post("/v1/auth/login", json={"email": email, "password": "a real password 1"})
    assert denied.status_code == 401

    async def confirm() -> None:
        from sqlalchemy import select

        from orbit_api.db import sessionmaker
        from orbit_api.models import User

        async with sessionmaker()() as db:
            user = await db.scalar(select(User).where(User.email == email))
            assert user is not None and user.google_sub == "google-sub-2" and user.email_verified is True
            user.email_verified = True
            user.has_password = True
            await db.commit()

    google_client.portal.call(confirm)  # type: ignore[union-attr]
    # A confirmed account keeps its password when the same Google account signs in again.
    google_client.cookies.clear()
    again = google_client.get("/v1/auth/google/start", follow_redirects=False)
    done = google_client.get(
        f"/v1/auth/google/callback?code=ok&state={_state(again.headers['location'])}",
        follow_redirects=False,
    )
    assert done.headers["location"].endswith("/")
    me = google_client.get("/v1/auth/me").json()
    assert me["email"] == email and me["has_password"] is True and me["email_verified"] is True


def test_google_redirect_uri_rejects_a_lookalike_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_ID", "orbit-client")
    monkeypatch.setenv("ORBIT_GOOGLE_CLIENT_SECRET", "orbit-secret")
    monkeypatch.delenv("ORBIT_GOOGLE_REDIRECT_URI", raising=False)
    get_settings.cache_clear()
    from orbit_api.main import create_app

    with TestClient(create_app()) as client:
        lookalike = client.get("/v1/auth/google/start", headers={"host": "localhost.evil.com"}, follow_redirects=False)
        local = client.get("/v1/auth/google/start", headers={"host": "localhost:8000"}, follow_redirects=False)
    get_settings.cache_clear()
    assert parse_qs(urlparse(lookalike.headers["location"]).query)["redirect_uri"] == [
        "http://localhost:5173/api/v1/auth/google/callback",
    ]
    assert parse_qs(urlparse(local.headers["location"]).query)["redirect_uri"] == [
        "http://localhost:8000/v1/auth/google/callback",
    ]


def test_google_rejects_a_bad_state(google_client: TestClient) -> None:
    google_client.get("/v1/auth/google/start", follow_redirects=False)
    bad = google_client.get("/v1/auth/google/callback?code=ok&state=nope", follow_redirects=False)
    assert bad.status_code == 302 and bad.headers["location"].endswith("/login?error=google")
    assert google_client.get("/v1/auth/me").status_code == 401


def _token(to: str, path: str) -> str:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    mail = next(m for m in reversed(sender.sent) if m.to == to and path in m.text)
    match = re.search(re.escape(path) + r"\?token=([\w-]+)", mail.text)
    assert match, mail.text
    return match.group(1)


def _sign_in_with_google(client: TestClient, monkeypatch: pytest.MonkeyPatch, email: str, sub: str) -> None:
    async def fake(code: str, verifier: str, uri: str) -> dict[str, str]:
        return {"sub": sub, "email": email, "name": "Ada"}

    monkeypatch.setattr(google, "fetch_identity", fake)
    start = client.get("/v1/auth/google/start", follow_redirects=False)
    done = client.get(
        f"/v1/auth/google/callback?code=ok&state={_state(start.headers['location'])}",
        follow_redirects=False,
    )
    assert done.status_code == 302


def test_password_reset_gives_a_google_account_a_real_password(
    google_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = "reset-google@example.com"
    _sign_in_with_google(google_client, monkeypatch, email, "google-sub-reset")
    assert google_client.get("/v1/auth/me").json()["has_password"] is False
    assert google_client.post("/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    google_client.cookies.clear()
    reset = google_client.post(
        "/v1/auth/password-reset/confirm",
        json={"token": _token(email, "/reset-password"), "password": "brand new password 2"},
    )
    assert reset.status_code == 200 and reset.json()["user"]["has_password"] is True
    google_client.cookies.clear()
    signed = google_client.post("/v1/auth/login", json={"email": email, "password": "brand new password 2"})
    assert signed.status_code == 200 and signed.json()["user"]["has_password"] is True


def test_changing_the_email_disconnects_google(google_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    email = "move-google@example.com"
    _sign_in_with_google(google_client, monkeypatch, email, "google-sub-move")
    set_pw = google_client.post(
        "/v1/auth/me/password", json={"current_password": "", "new_password": "a real password 1"},
    )
    assert set_pw.status_code == 200
    new = "moved-google@example.com"
    asked = google_client.post("/v1/auth/me/email", json={"new_email": new, "password": "a real password 1"})
    assert asked.status_code == 202
    changed = google_client.post("/v1/auth/email-change/confirm", json={"token": _token(new, "/confirm-email-change")})
    assert changed.status_code == 200
    assert changed.json() == {"email": new, "google_disconnected": True}

    async def linked() -> str | None:
        from sqlalchemy import select

        from orbit_api.db import sessionmaker
        from orbit_api.models import User

        async with sessionmaker()() as db:
            user = await db.scalar(select(User).where(User.email == new))
            assert user is not None and user.has_password is True
            return user.google_sub

    assert google_client.portal.call(linked) is None  # type: ignore[union-attr]

