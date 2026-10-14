"""Support chat lifecycle (V3-01, V3-05, V3-14): asking for a person makes exactly one Inbox ticket, linked to the
chat it came from, and deleting the account removes that copy of the chat with the chat itself. Messages sent from
the Contact page are the sender's own correspondence and stay (without the account link) as before."""

import asyncio
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tests.test_signup_approval import _client, _register

PASSWORD = "correct horse battery"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    app = next(gen)
    app.admin_email = admin_email  # type: ignore[attr-defined]
    yield app
    gen.close()


def _open(client: TestClient, headers: dict[str, str] | None = None) -> tuple[str, str]:
    r = client.post("/v1/support/threads", headers=headers or {})
    assert r.status_code == 201, r.text
    return r.json()["id"], r.json()["token"]


def _say(client: TestClient, thread_id: str, token: str, text: str, headers: dict[str, str] | None = None) -> None:
    r = client.post(f"/v1/support/threads/{thread_id}/messages", headers=headers or {},
                    json={"token": token, "text": text})
    assert r.status_code == 200, r.text


def _rows(client: TestClient, model: Any, *where: Any) -> list[Any]:
    from orbit_api.db import sessionmaker

    async def go() -> list[Any]:
        async with sessionmaker()() as db:
            return list((await db.scalars(select(model).where(*where))).all())

    return client.portal.call(go)  # type: ignore[union-attr]


def _inbox_search(client: TestClient, admin: dict[str, str], text: str) -> list[dict[str, Any]]:
    r = client.get("/v1/admin/inbox", headers=admin, params={"only": "all", "q": text})
    assert r.status_code == 200, r.text
    return r.json()["items"]  # type: ignore[no-any-return]


def test_handoff_ticket_is_linked_and_deleted_with_the_account(client: TestClient) -> None:
    from orbit_api.models import ContactMessage, SupportMessage, SupportThread

    headers, user = _register(client, f"chat-{uuid.uuid4().hex[:8]}@example.com")
    secret = f"my-passport-{uuid.uuid4().hex}"
    thread_id, token = _open(client, headers)
    _say(client, thread_id, token, f"Please look at {secret}", headers)
    handed = client.post(f"/v1/support/threads/{thread_id}/handoff", headers=headers,
                         json={"token": token, "email": user["email"]})
    assert handed.status_code == 200, handed.text

    # A Contact page message from the same account: the sender's own correspondence, kept as before.
    contact_text = f"A separate question {uuid.uuid4().hex}"
    sent = client.post("/v1/contact", headers=headers, json={
        "name": "Ana", "email": user["email"], "topic": "general", "message": contact_text})
    assert sent.status_code in (200, 201), sent.text

    admin, _admin = _register(client, client.admin_email)  # type: ignore[attr-defined]
    found = _inbox_search(client, admin, secret)
    assert len(found) == 1
    copies = _rows(client, ContactMessage, ContactMessage.source_support_thread_id == thread_id)
    assert len(copies) == 1 and secret in copies[0].message

    export = client.get("/v1/auth/me/export", headers=headers).json()
    linked = [m for m in export["contact_messages"] if m.get("source_support_thread_id") == thread_id]
    assert len(linked) == 1, "the export says which inbox copy came from which chat"

    deleted = client.request("DELETE", "/v1/auth/me", headers=headers, json={"password": PASSWORD})
    assert deleted.status_code == 204, deleted.text

    assert _inbox_search(client, admin, secret) == []
    assert _rows(client, ContactMessage, ContactMessage.message.contains(secret)) == []
    assert _rows(client, SupportMessage, SupportMessage.text.contains(secret)) == []
    assert _rows(client, SupportThread, SupportThread.id == thread_id) == []
    assert client.get(f"/v1/admin/support/{thread_id}", headers=admin).status_code == 404
    kept = _rows(client, ContactMessage, ContactMessage.message == contact_text)
    assert len(kept) == 1 and kept[0].user_id is None


def test_handoff_twice_makes_one_ticket(client: TestClient) -> None:
    from orbit_api.models import ContactMessage, SupportMessage
    from orbit_api.support.knowledge import HANDOFF

    thread_id, token = _open(client)
    for _ in range(3):
        r = client.post(f"/v1/support/threads/{thread_id}/handoff",
                        json={"token": token, "email": "guest@example.com", "name": "Guest"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "waiting"
    assert len(_rows(client, ContactMessage, ContactMessage.source_support_thread_id == thread_id)) == 1
    lines = _rows(client, SupportMessage, SupportMessage.thread_id == thread_id, SupportMessage.text == HANDOFF)
    assert len(lines) == 1


def test_concurrent_handoffs_make_one_ticket(client: TestClient) -> None:
    from orbit_api.models import ContactMessage

    thread_id, token = _open(client)

    async def burst() -> list[int]:
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            replies = await asyncio.gather(*[
                http.post(f"/v1/support/threads/{thread_id}/handoff",
                          json={"token": token, "email": "guest@example.com"})
                for _ in range(6)])
        return [r.status_code for r in replies]

    codes = client.portal.call(burst)  # type: ignore[union-attr]
    assert all(c == 200 for c in codes), codes
    assert len(_rows(client, ContactMessage, ContactMessage.source_support_thread_id == thread_id)) == 1


def test_a_closed_chat_cannot_be_handed_off_again(client: TestClient) -> None:
    from orbit_api.models import ContactMessage

    thread_id, token = _open(client)
    assert client.post(f"/v1/support/threads/{thread_id}/handoff",
                       json={"token": token, "email": "guest@example.com"}).status_code == 200
    admin, _a = _register(client, client.admin_email)  # type: ignore[attr-defined]
    assert client.post(f"/v1/admin/support/{thread_id}/close", headers=admin).status_code == 200
    again = client.post(f"/v1/support/threads/{thread_id}/handoff",
                        json={"token": token, "email": "guest@example.com"})
    assert again.status_code == 409
    assert len(_rows(client, ContactMessage, ContactMessage.source_support_thread_id == thread_id)) == 1


def test_deleting_a_handoff_ticket_in_the_inbox_keeps_the_chat(client: TestClient) -> None:
    from orbit_api.models import ContactMessage, SupportThread

    thread_id, token = _open(client)
    assert client.post(f"/v1/support/threads/{thread_id}/handoff",
                       json={"token": token, "email": "guest@example.com"}).status_code == 200
    admin, _a = _register(client, client.admin_email)  # type: ignore[attr-defined]
    ticket = _rows(client, ContactMessage, ContactMessage.source_support_thread_id == thread_id)[0]
    assert client.delete(f"/v1/admin/inbox/{ticket.id}", headers=admin).status_code == 204
    assert len(_rows(client, SupportThread, SupportThread.id == thread_id)) == 1


def test_the_migration_links_old_tickets_and_drops_orphaned_copies(tmp_path: Any) -> None:
    import json
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "support.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    alembic("upgrade", "a8c1e3f5b7d9")
    now = "2026-10-01 10:00:00"
    with sqlite3.connect(db) as conn:
        conn.execute("insert into support_threads (id, token_hash, name, email, status, updated_at, created_at) "
                     "values ('t-live', 'h', 'A', 'a@example.com', 'waiting', ?, ?)", (now, now))

        def ticket(id_: str, thread: str | None, at: str, replies: list[dict[str, str]] | None = None,
                   note: str | None = None) -> None:
            conn.execute(
                "insert into contact_messages (id, name, email, topic, message, context, status, replies, "
                "admin_note, created_at) values (?, 'A', 'a@example.com', 'technical', ?, ?, 'new', ?, ?, ?)",
                (id_, f"Support chat {thread} is waiting", json.dumps({"support_thread_id": thread}) if thread
                 else None, json.dumps(replies) if replies else None, note, at))

        ticket("m1", "t-live", "2026-10-01 10:01:00", [{"at": now, "by": "x", "text": "first"}], "note one")
        ticket("m2", "t-live", "2026-10-01 10:02:00", [{"at": now, "by": "x", "text": "second"}], "note two")
        ticket("m3", "t-gone", "2026-10-01 10:03:00")  # its chat went with a deleted account
        ticket("m4", None, "2026-10-01 10:04:00")  # a Contact page message

    alembic("upgrade", "c3e5a7b9d1f2")
    with sqlite3.connect(db) as conn:
        rows = {r[0]: r[1:] for r in conn.execute(
            "select id, source_support_thread_id, replies, admin_note from contact_messages")}
    assert set(rows) == {"m1", "m4"}
    assert rows["m1"][0] == "t-live" and rows["m4"][0] is None
    assert [r["text"] for r in json.loads(rows["m1"][1])] == ["first", "second"]
    assert rows["m1"][2] == "note one\n\nnote two"

    alembic("downgrade", "a8c1e3f5b7d9")
    with sqlite3.connect(db) as conn:
        assert "source_support_thread_id" not in {r[1] for r in conn.execute("pragma table_info(contact_messages)")}


def test_a_visitor_deletes_their_chat_and_its_ticket(client: TestClient) -> None:
    from orbit_api.models import ContactMessage, SupportThread

    thread_id, token = _open(client)
    assert client.post(f"/v1/support/threads/{thread_id}/handoff",
                       json={"token": token, "email": "guest@example.com"}).status_code == 200
    # Someone without the token can't.
    assert client.delete(f"/v1/support/threads/{thread_id}",
                         headers={"X-Orbit-Support-Token": "x" * 40}).status_code == 404
    assert client.delete(f"/v1/support/threads/{thread_id}",
                         headers={"X-Orbit-Support-Token": token}).status_code == 204
    assert _rows(client, SupportThread, SupportThread.id == thread_id) == []
    assert _rows(client, ContactMessage, ContactMessage.source_support_thread_id == thread_id) == []
    assert client.get(f"/v1/support/threads/{thread_id}",
                      headers={"X-Orbit-Support-Token": token}).status_code == 404


def test_idle_chats_go_after_retention_but_waiting_ones_stay(client: TestClient) -> None:
    from datetime import UTC, datetime, timedelta

    from orbit_api.db import sessionmaker
    from orbit_api.models import SupportThread
    from orbit_api.support.routes import purge_idle_threads

    idle_id, _t = _open(client)
    waiting_id, token = _open(client)
    assert client.post(f"/v1/support/threads/{waiting_id}/handoff",
                       json={"token": token, "email": "guest@example.com"}).status_code == 200

    async def later() -> int:
        async with sessionmaker()() as db:
            return await purge_idle_threads(db, now=datetime.now(UTC) + timedelta(days=400))

    assert client.portal.call(later) >= 1  # type: ignore[union-attr]
    assert _rows(client, SupportThread, SupportThread.id == idle_id) == []
    assert len(_rows(client, SupportThread, SupportThread.id == waiting_id)) == 1
