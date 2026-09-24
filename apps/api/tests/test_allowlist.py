"""Private-server gate: ORBIT_ALLOWED_EMAILS / admin decide who can sign up and sign in."""

import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings


def _s(**kw: object) -> Settings:
    return Settings.model_construct(**{"env": "test", "admin_email": None, "allowed_emails": None, **kw})


def test_email_allowed_rules() -> None:
    assert _s().email_allowed("anyone@x.com")  # dev/test default: open
    assert _s(env="production").email_allowed("anyone@x.com")  # no admin configured: nothing to lock to
    prod = _s(env="production", admin_email="Me@Mine.com")
    assert prod.email_allowed(" me@mine.COM ") and not prod.email_allowed("stranger@x.com")
    listed = _s(env="production", admin_email="me@mine.com", allowed_emails="friend@a.com, @team.io")
    assert listed.email_allowed("me@mine.com") and listed.email_allowed("FRIEND@a.com")
    assert listed.email_allowed("bob@team.io") and not listed.email_allowed("bob@evilteam.io")
    assert not listed.email_allowed("friend@a.com.evil")
    assert _s(env="production", admin_email="me@mine.com", allowed_emails="*").email_allowed("x@y.z")
    assert not _s(allowed_emails="friend@a.com").email_allowed("other@a.com")  # explicit list applies in dev too


def test_register_login_and_existing_sessions_are_gated(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    friend = f"friend-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setenv("ORBIT_ALLOWED_EMAILS", friend)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            pw = {"password": "correct horse battery"}
            r = c.post("/v1/auth/register", json={"email": f"stranger-{uuid.uuid4().hex[:6]}@example.com", **pw})
            assert r.status_code == 403 and "private" in r.json()["detail"]
            r = c.post("/v1/auth/register", json={"email": friend, **pw})
            assert r.status_code == 201
            c.cookies.clear()
            h = {"Authorization": f"Bearer {r.json()['access_token']}"}
            assert c.get("/v1/auth/me", headers=h).status_code == 200

            # tightening the list cuts off the existing account and its live tokens
            monkeypatch.setenv("ORBIT_ALLOWED_EMAILS", "someone-else@example.com")
            get_settings.cache_clear()
            assert c.get("/v1/auth/me", headers=h).status_code == 403
            assert c.post("/v1/auth/login", json={"email": friend, **pw}).status_code == 403
            assert c.post("/v1/auth/login", json={"email": friend, "password": "wrong password"}).status_code == 401
    finally:
        get_settings.cache_clear()


def test_legacy_password_hash_upgraded_on_login(client: TestClient) -> None:
    import asyncio

    from argon2 import PasswordHasher
    from sqlalchemy import select

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    email = f"legacy-{uuid.uuid4().hex[:6]}@example.com"
    assert client.post("/v1/auth/register", json={"email": email, "password": "legacy password"}).status_code == 201
    legacy = PasswordHasher().hash("legacy password")  # library defaults, as before the tuning

    async def set_and_get(value: str | None) -> str:
        async with sessionmaker()() as db:
            user = await db.scalar(select(User).where(User.email == email))
            assert user is not None
            if value:
                user.password_hash = value
                await db.commit()
            return user.password_hash

    asyncio.run(set_and_get(legacy))
    client.cookies.clear()
    assert client.post("/v1/auth/login", json={"email": email, "password": "legacy password"}).status_code == 200
    upgraded = asyncio.run(set_and_get(None))
    assert upgraded != legacy and "m=19456,t=2,p=1" in upgraded


def test_admin_is_never_capped_by_the_free_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    admin = f"owner-{uuid.uuid4().hex[:6]}@example.com"
    monkeypatch.setenv("ORBIT_ADMIN_EMAIL", admin)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            def usage(email: str) -> dict[str, object]:
                r = c.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
                c.cookies.clear()
                return c.get("/v1/usage", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()

            owner = usage(admin.upper())  # admin match is case-insensitive
            assert owner["plan"] == "unlimited" and owner["live_minutes_limit"] is None
            assert usage(f"guest-{uuid.uuid4().hex[:6]}@example.com")["plan"] == "free"
    finally:
        get_settings.cache_clear()
