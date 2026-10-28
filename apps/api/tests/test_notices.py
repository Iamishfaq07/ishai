"""Account notices (orbit_api/notices.py): whatever the account is given — the admin's credits (one account or many),
a plan for some hours, an approval, a referral reward, a purchase — shows in the app's bell until it's read, and the
person gets an email. Each person sees only their own."""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.test_signup_approval import _client, _outbox
from tests.test_signup_approval import _register as _register_named


@pytest.fixture
def console(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, dict[str, str]]]:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    admin, _ = _register_named(client, admin_email)
    yield client, admin
    gen.close()


def _user(client: TestClient) -> tuple[dict[str, str], dict[str, Any]]:
    return _register_named(client, f"n-{uuid.uuid4().hex[:8]}@example.com")


def _notices(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    r = client.get("/v1/notices", headers=h)
    assert r.status_code == 200, r.text
    return dict(r.json())


def _mail_to(email: str) -> list[Any]:
    return [m for m in _outbox().sent if m.to == email]


def test_the_admins_credits_reach_the_person_as_a_notice_and_an_email(console: Any) -> None:
    client, admin = console
    h, user = _user(client)
    r = client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin,
                    json={"resume": 10, "interview_minutes": 30, "note": "launch week"})
    assert r.status_code == 200, r.text
    out = _notices(client, h)
    assert out["unread"] == 1
    n = out["items"][0]
    assert (n["kind"], n["title"], n["link"], n["read"]) == (
        "credits", "You've got 10 AI credits and 30 interview minutes", "/billing", False)
    assert "launch week" in n["body"]
    mail = _mail_to(user["email"])[-1]
    assert mail.subject == "You've got 10 AI credits and 30 interview minutes on Orbit"
    assert "launch week" in mail.text and "/billing" in mail.text
    # One credit, no minutes: singular, and nothing about minutes.
    client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin, json={"resume": 1})
    assert _notices(client, h)["items"][0]["title"] == "You've got 1 AI credit"


def test_bulk_credits_tell_each_account(console: Any) -> None:
    client, admin = console
    (ha, a), (hb, b) = _user(client), _user(client)
    r = client.post("/v1/admin/users/bulk-credits", headers=admin,
                    json={"user_ids": [a["id"], b["id"]], "interview_minutes": 20})
    assert r.status_code == 200, r.text
    for h, u in ((ha, a), (hb, b)):
        assert _notices(client, h)["items"][0]["title"] == "You've got 20 interview minutes"
        assert _mail_to(u["email"])[-1].subject == "You've got 20 interview minutes on Orbit"


def test_a_plan_grant_and_an_approval_are_notices_too(console: Any) -> None:
    client, admin = console
    h, user = _user(client)
    r = client.post(f"/v1/admin/users/{user['id']}/access", headers=admin,
                    json={"action": "grant", "plan": "unlimited", "hours": 2})
    assert r.status_code == 200, r.text
    n = _notices(client, h)["items"][0]
    assert n["kind"] == "plan" and n["title"].startswith("You have Unlimited until")
    assert _mail_to(user["email"])[-1].subject.startswith("You have Orbit Unlimited until")
    client.post(f"/v1/admin/users/{user['id']}/access", headers=admin, json={"action": "approve"})
    items = _notices(client, h)["items"]
    assert [i["kind"] for i in items] == ["approved", "plan"]


def test_reading_notices_one_or_all_and_nobody_elses(console: Any) -> None:
    client, admin = console
    h, user = _user(client)
    other, _ = _user(client)
    for n in (1, 2, 3):
        client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin, json={"resume": n})
    items = _notices(client, h)["items"]
    assert len(items) == 3
    assert _notices(client, other) == {"items": [], "unread": 0}
    # Someone else's ids change nothing.
    assert client.post("/v1/notices/read", headers=other, json={"ids": [items[0]["id"]]}).json()["unread"] == 0
    assert _notices(client, h)["unread"] == 3
    out = client.post("/v1/notices/read", headers=h, json={"ids": [items[0]["id"]]}).json()
    assert out["unread"] == 2 and [i["read"] for i in out["items"]].count(True) == 1
    assert client.post("/v1/notices/read", headers=h, json={}).json()["unread"] == 0
    assert client.get("/v1/notices").status_code == 401
