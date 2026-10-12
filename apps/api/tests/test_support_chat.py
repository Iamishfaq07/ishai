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
    assert lookup("hello")
    assert lookup("what is the weather in srinagar") is None


def test_bot_then_a_person(client: TestClient) -> None:
    opened = client.post("/v1/support/threads")
    assert opened.status_code == 201, opened.text
    thread = opened.json()
    token = thread["token"]
    assert thread["messages"][0]["role"] == "bot"

    asked = client.post(
        f"/v1/support/threads/{thread['id']}/messages",
        json={"token": token, "text": "How much is the Mini pack?"},
    )
    assert asked.status_code == 200, asked.text
    assert "₹499" in asked.json()["messages"][-1]["text"]

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
