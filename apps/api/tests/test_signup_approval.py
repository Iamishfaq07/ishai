"""Sign-up approval: new accounts wait for the admin, who hears about each one and grants a plan for a while
("Unlimited for 2 hours") or approves them for good. Accounts from before stay as they were."""

import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from orbit_api.providers.email import DevOutbox, get_email_sender


def _client(monkeypatch: pytest.MonkeyPatch, **env: str) -> Iterator[TestClient]:
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        get_settings.cache_clear()


def _outbox() -> DevOutbox:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    return sender


def _register(client: TestClient, email: str) -> tuple[dict[str, str], dict]:  # type: ignore[type-arg]
    r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery", "name": "Ana"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


def _set_grant_until(client: TestClient, user_id: str, until: datetime) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    async def go() -> None:
        async with sessionmaker()() as db:
            u = await db.get(User, user_id)
            assert u is not None
            u.grant_until = until
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]


def test_new_accounts_wait_until_the_admin_grants_or_approves(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_SIGNUP_APPROVAL="true")
    client = next(gen)
    try:
        admin, admin_user = _register(client, admin_email)
        assert admin_user["approval_pending"] is False  # the admin never waits
        email = f"new-{uuid.uuid4().hex[:8]}@example.com"
        h, user = _register(client, email)
        assert user["approval_pending"] is True

        # The admin hears about it, with where to act.
        alert = next(m for m in reversed(_outbox().sent) if m.to == admin_email)
        assert email in alert.subject and "/admin/users" in alert.text and "Ana" in alert.text

        # Nothing that costs anything until then.
        blocked = client.post("/v1/sessions", headers=h, json={"title": "x"})
        assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "approval_pending"
        assert client.get("/v1/entitlements", headers=h).json()["plan"] == "pending"
        ready = client.get("/v1/preflight", headers=h).json()  # says why, rather than "out of minutes"
        assert [c["id"] for c in ready["checks"] if c["status"] == "fail"] == ["account"]
        assert "waiting for approval" in next(c["detail"] for c in ready["checks"] if c["id"] == "account")
        assert client.get("/v1/admin/users", headers=h).status_code == 403  # not for users

        pending = client.get("/v1/admin/users?only=pending", headers=admin).json()
        assert pending["approval_required"] and [u["email"] for u in pending["users"]] == [email]
        uid = pending["users"][0]["id"]

        # Unlimited for 2 hours: usable at once, the user is told, and it shows when it ends.
        row = client.post(f"/v1/admin/users/{uid}/access", headers=admin,
                          json={"action": "grant", "plan": "unlimited", "hours": 2}).json()
        assert row["access"] == "granted" and row["plan_label"] == "Unlimited"
        ent = client.get("/v1/entitlements", headers=h).json()
        assert ent["plan"] == "unlimited" and ent["until"]
        until = datetime.fromisoformat(ent["until"])
        assert timedelta(hours=1, minutes=59) < until - datetime.now(UTC) <= timedelta(hours=2)
        assert client.post("/v1/sessions", headers=h, json={"title": "x"}).status_code == 201
        told = next(m for m in reversed(_outbox().sent) if m.to == email)
        assert "Unlimited" in told.subject and "UTC" in told.subject
        assert client.get("/v1/auth/me", headers=h).json()["approval_pending"] is False

        # The same grant again adds on; a different plan starts from now.
        again = client.post(f"/v1/admin/users/{uid}/access", headers=admin,
                            json={"action": "grant", "plan": "unlimited", "hours": 2}).json()
        assert datetime.fromisoformat(again["grant_until"]) - until > timedelta(hours=1, minutes=59)

        # When the time runs out, they wait again.
        _set_grant_until(client, uid, datetime.now(UTC) - timedelta(minutes=1))
        assert client.post("/v1/sessions", headers=h, json={"title": "x"}).status_code == 403
        assert client.get("/v1/admin/users?only=pending", headers=admin).json()["users"][0]["id"] == uid

        # Approved for good: the Free plan, no end date.
        row = client.post(f"/v1/admin/users/{uid}/access", headers=admin, json={"action": "approve"}).json()
        assert row["access"] == "approved" and row["plan_label"] == "Free"
        assert client.get("/v1/entitlements", headers=h).json()["plan"] == "free"
        assert client.post("/v1/sessions", headers=h, json={"title": "x"}).status_code == 201

        # Revoked: waiting again, grant gone.
        row = client.post(f"/v1/admin/users/{uid}/access", headers=admin, json={"action": "revoke"}).json()
        assert row["access"] == "pending" and row["grant_until"] is None

        me = client.get("/v1/admin/users", headers=admin).json()["users"]
        admin_row = next(u for u in me if u["email"] == admin_email)
        assert admin_row["access"] == "admin"
        own = client.post(f"/v1/admin/users/{admin_row['id']}/access", headers=admin, json={"action": "revoke"})
        assert own.status_code == 422
        bad = client.post(f"/v1/admin/users/{uid}/access", headers=admin,
                          json={"action": "grant", "plan": "free", "hours": 2})
        assert bad.status_code == 422
    finally:
        next(gen, None)


def test_where_email_is_verified_the_admin_hears_once_the_inbox_is_proven(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_SIGNUP_APPROVAL="true",
                  ORBIT_EMAIL_VERIFICATION="required")
    client = next(gen)
    try:
        email = f"new-{uuid.uuid4().hex[:8]}@example.com"
        r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
        assert r.status_code == 202
        assert not [m for m in _outbox().sent if m.to == admin_email and email in m.subject]  # not yet
        mail = next(m for m in reversed(_outbox().sent) if m.to == email and "/verify-email" in m.text)
        token = re.search(r"/verify-email\?token=([\w-]+)", mail.text).group(1)  # type: ignore[union-attr]
        assert client.post("/v1/auth/verify-email/confirm", json={"token": token}).status_code == 200
        assert [m for m in _outbox().sent if m.to == admin_email and email in m.subject]
    finally:
        next(gen, None)


def test_without_approval_new_accounts_start_on_free(client: TestClient) -> None:
    r = client.post("/v1/auth/register", json={"email": f"u-{uuid.uuid4().hex[:8]}@example.com",
                                               "password": "correct horse battery"})
    assert r.json()["user"]["approval_pending"] is False
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.cookies.clear()
    assert client.get("/v1/entitlements", headers=h).json()["plan"] in ("free", "unlimited")  # first user is admin
