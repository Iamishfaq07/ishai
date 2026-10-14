"""Support chat: the bot answers from the help notes, a visitor can ask for a person, and an admin can reply."""

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
    assert seen.headers["cache-control"] == "no-store"
    via_header = client.get(
        f"/v1/support/threads/{thread['id']}", headers={"X-Orbit-Support-Token": token},
    )
    assert via_header.status_code == 200
    assert "token" not in str(via_header.request.url)
    assert client.get(f"/v1/support/threads/{thread['id']}").status_code == 404


def test_signed_in_sees_their_balance_and_last_payment(client: TestClient) -> None:
    headers, user = _register(client, f"buyer-{uuid.uuid4().hex[:8]}@example.com")
    opened = client.post("/v1/support/threads", headers=headers)
    assert opened.status_code == 201, opened.text
    thread = opened.json()
    assert any(item["id"] == "balance" for item in thread["suggestions"])
    token = thread["token"]

    asked = client.post(
        f"/v1/support/threads/{thread['id']}/messages",
        headers=headers,
        json={"token": token, "choice": "balance"},
    )
    assert asked.status_code == 200, asked.text
    text = asked.json()["messages"][-1]["text"]
    assert "20 interview minutes" in text
    assert "1 Resume AI credit" in text

    anon = client.post("/v1/support/threads")
    assert anon.status_code == 201, anon.text
    anon_thread = anon.json()
    assert not any(item["id"] == "balance" for item in anon_thread["suggestions"])
    denied = client.post(
        f"/v1/support/threads/{anon_thread['id']}/messages",
        json={"token": anon_thread["token"], "choice": "balance"},
    )
    assert denied.status_code == 200, denied.text
    assert "Sign in" in denied.json()["messages"][-1]["text"]

    from orbit_api.db import sessionmaker
    from orbit_api.models import Payment

    async def add() -> None:
        async with sessionmaker()() as db:
            db.add(Payment(
                user_id=user["id"],
                plan="mini",
                amount_inr=499,
                days=0,
                resume_credits=5,
                interview_minutes=15,
                reference=f"ORB{uuid.uuid4().hex[:8]}",
                status="approved",
                method="razorpay",
            ))
            await db.commit()

    client.portal.call(add)  # type: ignore[union-attr]
    paid = client.post(
        f"/v1/support/threads/{thread['id']}/messages",
        headers=headers,
        json={"token": token, "text": "what is my last payment status"},
    )
    assert paid.status_code == 200, paid.text
    last = paid.json()["messages"][-1]["text"]
    assert "landed" in last and "₹499" in last and "Mini" in last


def test_the_page_leads_the_menu_but_not_a_follow_up(client: TestClient) -> None:
    billing = client.post("/v1/support/threads?page=/billing")
    assert billing.status_code == 201, billing.text
    assert [item["id"] for item in billing.json()["suggestions"][:3]] == ["buy", "missing", "refund"]

    resume = client.post("/v1/support/threads?page=/resume-ai/editor")
    assert [item["id"] for item in resume.json()["suggestions"][:3]] == ["resume", "what_spends", "prices"]

    token = billing.json()["token"]
    followed = client.post(
        f"/v1/support/threads/{billing.json()['id']}/messages",
        json={"token": token, "choice": "prices", "page": "/billing"},
    )
    assert followed.status_code == 200, followed.text
    ids = [item["id"] for item in followed.json()["suggestions"]]
    assert ids[0] == "welcome"
    assert "menu" in ids


def test_that_helped_returns_to_the_menu(client: TestClient) -> None:
    opened = client.post("/v1/support/threads")
    token = opened.json()["token"]
    asked = client.post(
        f"/v1/support/threads/{opened.json()['id']}/messages",
        json={"token": token, "choice": "prices"},
    )
    assert any(item["id"] == "helped" for item in asked.json()["suggestions"])
    helped = client.post(
        f"/v1/support/threads/{opened.json()['id']}/messages",
        json={"token": token, "choice": "helped"},
    )
    assert helped.status_code == 200, helped.text
    assert helped.json()["messages"][-1]["text"].startswith("Good.")
    assert any(item["id"] == "prices" for item in helped.json()["suggestions"])


def test_admin_sees_the_account_behind_the_chat(client: TestClient) -> None:
    headers, user = _register(client, f"buyer-{uuid.uuid4().hex[:8]}@example.com")
    opened = client.post("/v1/support/threads", headers=headers)
    assert opened.status_code == 201, opened.text
    token = opened.json()["token"]
    handed = client.post(
        f"/v1/support/threads/{opened.json()['id']}/handoff",
        headers=headers,
        json={"token": token, "email": user["email"]},
    )
    assert handed.status_code == 200, handed.text
    assert "red dot" in handed.json()["messages"][-1]["text"]

    admin, _user = _register(client, client.admin_email)  # type: ignore[attr-defined]
    detail = client.get(f"/v1/admin/support/{opened.json()['id']}", headers=admin)
    assert detail.status_code == 200, detail.text
    account = detail.json()["account"]
    assert user["email"] in account
    assert "20 interview minutes" in account
    assert "no payment yet" in account.lower() or "No payment" in account or "no payment" in account


def test_export_includes_the_chat_and_deleting_the_account_removes_it(client: TestClient) -> None:
    headers, user = _register(client, f"gone-{uuid.uuid4().hex[:8]}@example.com")
    opened = client.post("/v1/support/threads", headers=headers)
    assert opened.status_code == 201, opened.text
    thread_id, token = opened.json()["id"], opened.json()["token"]
    export = client.get("/v1/auth/me/export", headers=headers).json()
    chat = export["support_chats"][0]
    assert chat["id"] == thread_id and chat["email"] == user["email"]
    assert "token" not in chat and "token_hash" not in chat
    deleted = client.request("DELETE", "/v1/auth/me", headers=headers, json={"password": "correct horse battery"})
    assert deleted.status_code == 204, deleted.text
    assert client.get(f"/v1/support/threads/{thread_id}", params={"token": token}).status_code == 404
