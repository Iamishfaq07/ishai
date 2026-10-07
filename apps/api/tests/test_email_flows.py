"""Email verification + password reset: single-use tokens, no account enumeration, session revocation."""

import re
import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from orbit_api.providers.email import DevOutbox, get_email_sender


def _outbox() -> DevOutbox:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    return sender


def _last_token(to: str, path: str) -> str:
    mail = next(m for m in reversed(_outbox().sent) if m.to == to and path in m.text)
    match = re.search(re.escape(path) + r"\?token=([\w-]+)", mail.text)
    assert match, mail.text
    return match.group(1)


def _register(client: TestClient, password: str = "original password 1") -> tuple[str, dict[str, str]]:
    email = f"flow-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201
    client.cookies.clear()
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_register_sends_verification_and_link_verifies_once(client: TestClient) -> None:
    email, h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["email_verified"] is False
    token = _last_token(email, "/verify-email")
    assert "localhost:5173/verify-email?token=" in _outbox().sent[-1].text

    r = client.post("/v1/auth/verify-email/confirm", json={"token": token})
    assert r.status_code == 200 and r.json()["email_verified"] is True
    assert client.post("/v1/auth/verify-email/confirm", json={"token": token}).status_code == 400  # single use
    assert client.post("/v1/auth/verify-email/request", headers=h).json()["status"] == "already_verified"


def test_resend_verification_is_throttled_and_invalidates_old_link(client: TestClient) -> None:
    email, h = _register(client)
    first = _last_token(email, "/verify-email")
    assert client.post("/v1/auth/verify-email/request", headers=h).status_code == 429  # just sent at signup

    from orbit_api.auth import email_tokens

    original = email_tokens.RESEND_COOLDOWN
    email_tokens.RESEND_COOLDOWN = timedelta(0)
    try:
        assert client.post("/v1/auth/verify-email/request", headers=h).status_code == 202
    finally:
        email_tokens.RESEND_COOLDOWN = original
    second = _last_token(email, "/verify-email")
    assert second != first
    assert client.post("/v1/auth/verify-email/confirm", json={"token": first}).status_code == 400
    assert client.post("/v1/auth/verify-email/confirm", json={"token": second}).status_code == 200


def test_password_reset_does_not_reveal_whether_account_exists(client: TestClient) -> None:
    email, _ = _register(client)
    last = _outbox().sent[-1]
    known = client.post("/v1/auth/password-reset/request", json={"email": email})
    unknown = client.post("/v1/auth/password-reset/request", json={"email": "nobody-here@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    # Only the real account got mail. (The dev outbox keeps the last 100, so count from the end, not the length.)
    sent = _outbox().sent
    new = sent[len(sent) - 1 - sent[::-1].index(last) + 1:]
    assert [m.to for m in new] == [email]


def test_password_reset_changes_password_and_signs_out_everywhere(client: TestClient) -> None:
    email, old_session = _register(client, "original password 1")
    assert client.get("/v1/auth/me", headers=old_session).status_code == 200
    client.post("/v1/auth/password-reset/request", json={"email": email})
    token = _last_token(email, "/reset-password")

    assert client.post("/v1/auth/password-reset/confirm",
                       json={"token": token, "password": "short"}).status_code == 422
    r = client.post("/v1/auth/password-reset/confirm", json={"token": token, "password": "brand new password 2"})
    assert r.status_code == 200
    new_session = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.cookies.clear()

    assert client.get("/v1/auth/me", headers=old_session).status_code == 401  # old desktop/web tokens revoked
    assert client.get("/v1/auth/me", headers=new_session).json()["email_verified"] is True
    assert client.post("/v1/auth/login", json={"email": email, "password": "original password 1"}).status_code == 401
    assert client.post("/v1/auth/login", json={"email": email, "password": "brand new password 2"}).status_code == 200
    client.cookies.clear()
    assert client.post("/v1/auth/password-reset/confirm",
                       json={"token": token, "password": "third password 33"}).status_code == 400  # single use


async def test_expired_reset_token_is_rejected() -> None:
    from orbit_api.auth import email_tokens
    from orbit_api.db import create_all, sessionmaker
    from orbit_api.models import EmailToken, User

    await create_all()
    async with sessionmaker()() as db:
        user = User(email=f"exp-{uuid.uuid4().hex[:6]}@example.com", password_hash="x")
        db.add(user)
        await db.flush()
        token = await email_tokens.issue(db, user.id, "reset_password")
        await db.commit()
        row = (await db.execute(EmailToken.__table__.select().where(EmailToken.user_id == user.id))).first()
        assert row is not None
        await db.execute(EmailToken.__table__.update().where(EmailToken.user_id == user.id)
                         .values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        await db.commit()
        assert await email_tokens.consume(db, token, "reset_password") is None
        assert await email_tokens.consume(db, token, "verify_email") is None  # wrong purpose never matches


def test_logout_all_revokes_every_token(client: TestClient) -> None:
    email, a = _register(client)
    b = {"Authorization": "Bearer " + client.post(
        "/v1/auth/login", json={"email": email, "password": "original password 1"}).json()["access_token"]}
    client.cookies.clear()
    assert client.post("/v1/auth/logout-all", headers=a).status_code == 204
    assert client.get("/v1/auth/me", headers=a).status_code == 401
    assert client.get("/v1/auth/me", headers=b).status_code == 401
