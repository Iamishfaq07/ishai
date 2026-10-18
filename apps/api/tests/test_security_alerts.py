"""Telling the owner when the way into an account changes (auth/alerts.py): an email for a passkey or two-step sign-in
added or removed and a password reset or changed, the same events in the app (Settings, Home), and the admin's audited
"turn off two-step sign-in" for someone who lost their phone and their recovery codes."""

import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api.providers.email import DevOutbox, get_email_sender
from tests.test_signup_approval import _client
from tests.test_signup_approval import _register as _register_named
from tests.test_two_factor import PW, _account, _now_code, _turn_on


def _mail_to(to: str) -> list[str]:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    return [m.subject + "\n" + m.text for m in sender.sent if m.to == to]


def test_turning_two_step_on_and_off_and_a_new_password_are_emailed_and_listed(client: TestClient) -> None:
    email, h = _account(client)
    before = len(_mail_to(email))
    secret, _codes = _turn_on(client, h)
    mails = _mail_to(email)[before:]
    assert len(mails) == 1 and mails[0].startswith("Orbit security: two-step sign-in was turned on")
    assert "Reset your password now" in mails[0] and "/forgot-password" in mails[0]

    r = client.post("/v1/auth/me/password", headers=h,
                    json={"current_password": PW, "new_password": "a different long password"})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert _mail_to(email)[-1].startswith("Orbit security: the password was changed")
    assert client.post("/v1/auth/2fa/disable", headers=h, json={"code": _now_code(secret)}).status_code == 204
    assert _mail_to(email)[-1].startswith("Orbit security: two-step sign-in was turned off")

    items = client.get("/v1/auth/security-activity", headers=h).json()["items"]
    assert [i["action"] for i in items] == ["auth.2fa_off", "auth.password_change", "auth.2fa_on"]
    assert all(i["notice"] for i in items) and items[0]["text"] == "Two-step sign-in was turned off"
    client.cookies.clear()
    assert client.get("/v1/auth/security-activity").status_code == 401


def test_the_admin_can_turn_two_step_off_for_someone_locked_out(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        email = f"locked-{uuid.uuid4().hex[:8]}@example.com"
        h, user = _register_named(client, email)
        _turn_on(client, h)
        rows = client.get("/v1/admin/users?only=all", headers=admin).json()["users"]
        assert next(u for u in rows if u["id"] == user["id"])["two_factor"] is True

        path = f"/v1/admin/users/{user['id']}/2fa/off"
        assert client.post(path, headers=h, json={"reason": "it is me, honestly"}).status_code == 403
        assert client.post(path, headers=admin, json={"reason": "asked"}).status_code == 422  # say how you checked
        r = client.post(path, headers=admin, json={"reason": "Video call, matched ID and the last payment's UTR"})
        assert r.status_code == 200, r.text
        assert r.json()["two_factor"] is False
        assert client.post(path, headers=admin, json={"reason": "Video call, matched ID again"}).status_code == 409

        assert _mail_to(email)[-1].startswith("Orbit security: orbit's admin turned off two-step sign-in")
        assert client.get("/v1/auth/me", headers=h).status_code == 401  # every device signed out
        login = client.post("/v1/auth/login", json={"email": email, "password": "correct horse battery"})
        assert login.status_code == 200 and login.json().get("access_token")  # the password alone works again
        mine = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert client.get("/v1/auth/security-activity", headers=mine).json()["items"][0]["action"] == \
            "auth.2fa_off_by_admin"
        audit = client.get("/v1/admin/audit?action=admin.user.2fa_off", headers=admin).json()
        assert any(e["target"].startswith(user["id"]) and "Video call" in e["target"] for e in audit["items"])
        # Never the admin's own account, or the admin account.
        me = client.get("/v1/auth/me", headers=admin).json()
        assert client.post(f"/v1/admin/users/{me['id']}/2fa/off", headers=admin,
                           json={"reason": "Video call, matched ID"}).status_code == 422
    finally:
        gen.close()


def test_a_new_passkey_is_emailed(client: TestClient) -> None:
    from tests.test_passkeys import Authenticator, _add
    from tests.test_passkeys import _account as _passkey_account

    email, h = _passkey_account(client)
    _add(client, h, Authenticator(), "Laptop")
    assert _mail_to(email)[-1].startswith("Orbit security: a passkey was added")
    assert client.get("/v1/auth/security-activity", headers=h).json()["items"][0]["action"] == "auth.passkey_added"
