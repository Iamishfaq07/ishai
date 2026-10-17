"""Continue with Google: the button stays hidden until it's configured, and a verified Google email signs in."""

import re
import uuid
from collections.abc import Iterator
from typing import Any
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


def test_password_reset_then_google_keeps_the_account_resumes_credits_and_history(
    google_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = "reset-link-state@example.com"
    registered = google_client.post("/v1/auth/register", json={"email": email, "password": "a real password 1"})
    assert registered.status_code == 201
    uid = google_client.get("/v1/auth/me").json()["id"]
    resume = google_client.post("/v1/resumes", json={"title": "Keep this"}).json()["id"]
    session = google_client.post("/v1/sessions", json={"title": "My practice", "type": "mock"}).json()["id"]
    balances = google_client.get("/v1/entitlements").json()["credits"]
    assert google_client.post("/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    google_client.cookies.clear()
    reset = google_client.post("/v1/auth/password-reset/confirm",
                               json={"token": _token(email, "/reset-password"), "password": "brand new password 2"})
    assert reset.status_code == 200
    google_client.cookies.clear()
    _sign_in_with_google(google_client, monkeypatch, email, "google-sub-state-preserved")
    me = google_client.get("/v1/auth/me").json()
    assert me["id"] == uid and me["has_password"] is True
    assert google_client.get("/v1/entitlements").json()["credits"] == balances
    assert google_client.get(f"/v1/resumes/{resume}").status_code == 200
    assert google_client.get(f"/v1/sessions/{session}").status_code == 200


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



def test_a_new_google_account_is_for_the_country_it_signed_up_from(google_client: TestClient,
                                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    import os

    worker = {"X-Orbit-Proxy-Secret": os.environ["ORBIT_PROXY_SECRET"]}
    who = {"sub": "google-sub-gb", "email": "grace@gmail.com", "name": "Grace Hopper"}

    async def fake(code: str, verifier: str, uri: str) -> dict[str, str]:
        return who

    monkeypatch.setattr(google, "fetch_identity", fake)

    def sign_in(headers: dict[str, str]) -> str | None:
        google_client.cookies.clear()
        start = google_client.get("/v1/auth/google/start", follow_redirects=False)
        done = google_client.get(f"/v1/auth/google/callback?code=ok&state={_state(start.headers['location'])}",
                                 headers=headers, follow_redirects=False)
        assert done.status_code == 302
        me: str | None = google_client.get("/v1/auth/me").json()["country"]
        return me

    assert sign_in({**worker, "X-Orbit-Client-Country": "GB"}) == "GB"
    # Signing in again from somewhere else doesn't move the account: only settings change it.
    assert sign_in({**worker, "X-Orbit-Client-Country": "US"}) == "GB"
    # A country the Worker didn't vouch for is no guess at all.
    who = {"sub": "google-sub-xx", "email": "ada-unsure@gmail.com", "name": "Ada"}
    assert sign_in({"X-Orbit-Client-Country": "US"}) is None


def test_a_database_error_lands_on_the_sign_in_page_not_a_bare_500(
    google_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The browser is on the API's address during the callback: an error there used to show a plain-text "Internal
    Server Error". Now it goes back to the sign-in page, and nothing half made is left behind."""
    from sqlalchemy import select
    from sqlalchemy.exc import OperationalError

    from orbit_api import credits
    from orbit_api.auth import devices
    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    email = f"db-error-{uuid.uuid4().hex[:8]}@gmail.com"
    refused = OperationalError("INSERT", {}, Exception("cannot execute INSERT in a read-only transaction"))
    real_welcome, real_session = credits.grant_welcome, devices.start_session

    async def broken(*_: object) -> Any:
        raise refused

    def callback() -> Any:
        start = google_client.get("/v1/auth/google/start", follow_redirects=False)
        return google_client.get(f"/v1/auth/google/callback?code=ok&state={_state(start.headers['location'])}",
                                 follow_redirects=False)

    async def account() -> Any:
        async with sessionmaker()() as db:
            return await db.scalar(select(User).where(User.email == email))

    async def fake(code: str, verifier: str, uri: str) -> dict[str, str | None]:
        return {"sub": f"sub-{email}", "email": email, "name": None}

    monkeypatch.setattr(google, "fetch_identity", fake)
    # The new account is flushed and nothing is committed yet when the welcome credits fail.
    monkeypatch.setattr(credits, "grant_welcome", broken)
    done = callback()
    assert done.status_code == 302 and done.headers["location"].endswith("/login?error=server")
    assert 'orbit_google=""' in done.headers["set-cookie"]
    assert google_client.get("/v1/auth/me").status_code == 401
    assert google_client.portal.call(account) is None  # type: ignore[union-attr]  # rolled back, not half made

    # A failure after the account is made (its device row): the same page, and trying again signs in.
    monkeypatch.setattr(credits, "grant_welcome", real_welcome)
    monkeypatch.setattr(devices, "start_session", broken)
    done = callback()
    assert done.status_code == 302 and done.headers["location"].endswith("/login?error=server")
    assert google_client.get("/v1/auth/me").status_code == 401
    monkeypatch.setattr(devices, "start_session", real_session)
    assert callback().status_code == 302
    me = google_client.get("/v1/auth/me")
    assert me.status_code == 200 and me.json()["email"] == email


def test_a_google_only_account_sets_a_password_only_after_a_recent_sign_in(
    google_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No password to re-enter, so a sign-in in the last 15 minutes stands in for it (as for two-step sign-in and
    passkeys): a session left open or stolen used to be able to set one, and keep a way in after it ended."""
    import time

    from orbit_api.auth.security import create_access_token
    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    email = f"pw-{uuid.uuid4().hex[:8]}@gmail.com"
    _sign_in_with_google(google_client, monkeypatch, email, f"sub-{email}")
    uid = google_client.get("/v1/auth/me").json()["id"]
    google_client.cookies.clear()

    async def version() -> Any:
        async with sessionmaker()() as db:
            return (await db.get(User, uid)).token_version  # type: ignore[union-attr]

    ver = google_client.portal.call(version)  # type: ignore[union-attr]
    body = {"current_password": "", "new_password": "a brand new password 9"}
    old = {"Authorization": "Bearer " + create_access_token(uid, ver, signed_in_at=int(time.time()) - 3600)}
    r = google_client.post("/v1/auth/me/password", headers=old, json=body)
    assert r.status_code == 403 and "sign in with Google again" in r.json()["detail"]
    fresh = {"Authorization": "Bearer " + create_access_token(uid, ver)}
    r = google_client.post("/v1/auth/me/password", headers=fresh, json=body)
    assert r.status_code == 200 and r.json()["user"]["has_password"] is True
