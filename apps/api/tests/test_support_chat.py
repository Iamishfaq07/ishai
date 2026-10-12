"""Support chat: the bot answers from the help notes, a visitor can ask for a person, and an admin reply shows in the thread."""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from orbit_api.support.knowledge import lookup
from tests.test_signup_approval import _client, _register


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setenv("ORBIT_ADMIN_EMAIL", admin_email)
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    app = next(gen)
    app.admin_email = admin_email  # type: ignore[attr-defined]
    yield app
    gen.close()


def test_lookup_knows_the_packs() -> None:
    assert "₹499" in (lookup("how much is the mini pack") or "")
    assert "15 interview minutes" in (lookup("how much is the mini pack") or "")
    assert lookup("hello")
    assert lookup("what is the weather in srinagar") is None
    # A payment that didn't land is not the price list.
    missed = lookup("my payment didn't land") or ""
    assert "Refresh" in missed
    assert "₹499" not in missed


def test_bot_then_a_person(client: TestClient) -> None:
    opened = client.post("/v1/support/threads")
    assert opened.status_code == 201, opened.text
    thread = opened.json()
    token = thread["token"]
    assert thread["messages"][0]["role"] == "bot"
    assert any(item["id"] == "prices" for item in thread["suggestions"])

    asked = client.post(
        f"/v1/support/threads/{thread['id']}/messages",
        json={"token": token, "choice": "mini", "text": "Mini ₹499"},
    )
    assert asked.status_code == 200, asked.text
    body = asked.json()
    assert "₹499" in body["messages"][-1]["text"]
    assert "15 interview minutes" in body["messages"][-1]["text"]
    assert any(item["id"] == "human" for item in body["suggestions"])

    unknown = client.post(
        f"/v1/support/threads/{thread['id']}/messages",
        json={"token": token, "text": "what is the weather in srinagar"},
    )
    assert unknown.status_code == 200, unknown.text
    assert "don't have a sure answer" in unknown.json()["messages"][-1]["text"]
    assert any(item["label"] == "Prices" for item in unknown.json()["suggestions"])

    handed = client.post(
        f"/v1/support/threads/{thread['id']}/handoff",
        json={"token": token, "name": "Asha", "email": "asha@example.com"},
    )
    assert handed.status_code == 200, handed.text
    assert handed.json()["status"] == "waiting"

    admin, _user = _register(client, client.admin_email)  # type: ignore[attr-defined]
    waiting = client.get("/v1/admin/support", headers=admin)
    assert waiting.status_code == 200, waiting.text
    assert any(item["id"] == thread["id"] for item in waiting.json())

    replied = client.post(
        f"/v1/admin/support/{thread['id']}/reply",
        headers=admin,
        json={"text": "I can see the payment. Give me the 12-digit UTR."},
    )
    assert replied.status_code == 200, replied.text
    assert replied.json()["messages"][-1]["role"] == "human"

    seen = client.get(f"/v1/support/threads/{thread['id']}", params={"token": token})
    assert seen.status_code == 200
    assert seen.json()["messages"][-1]["text"].startswith("I can see the payment")
