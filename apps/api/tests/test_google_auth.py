"""Continue with Google: the button stays hidden until it's configured, and a verified Google email signs in."""

from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from orbit_api.auth import google
from orbit_api.config import get_settings


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
    # The password account never confirmed the inbox, so Google must not take it over.
    assert held.status_code == 302 and held.headers["location"].endswith("/login?error=taken")
    assert google_client.get("/v1/auth/me").status_code == 401

    async def confirm() -> None:
        from sqlalchemy import select

        from orbit_api.db import sessionmaker
        from orbit_api.models import User

        async with sessionmaker()() as db:
            user = await db.scalar(select(User).where(User.email == email))
            assert user is not None and user.google_sub is None and user.email_verified is False
            user.email_verified = True
            await db.commit()

    google_client.portal.call(confirm)  # type: ignore[union-attr]
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
