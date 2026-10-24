"""Controlled interleavings enforce the authorization boundary before Gmail delivery."""
import json
import uuid

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete

from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.gmail import routes
from orbit_api.models import GmailConnection
from orbit_api.runtime_config import encrypt_secret
from tests.business_helpers import auth, db_call, register


def setup(client, monkeypatch):
    s = get_settings()
    for key, value in {
        "google_client_id": "audit-client",
        "google_client_secret": SecretStr("audit-secret"),
        "config_secret": SecretStr("audit-encryption"),
        "gmail_redirect_uri": "http://localhost/v1/gmail/callback",
    }.items():
        monkeypatch.setattr(s, key, value)
    h = auth(register(client, f"audit-{uuid.uuid4().hex}@example.com"))
    user = client.get("/v1/auth/me", headers=h).json()["id"]
    entry = client.post("/v1/jobs/tracker/manual", headers=h, json={"title": "Engineer", "company": "AuditCo"}).json()[
        "id"
    ]

    async def seed(db):
        db.add(
            GmailConnection(user_id=user, data={"email": "sender@example.com", "refresh": encrypt_secret("refresh")})
        )

    db_call(client, seed)
    payload = {
        "recipient": "hiring@example.com",
        "subject": "Application",
        "body": "Please review my application for the role.",
    }
    draft = client.post(f"/v1/gmail/draft/{entry}", headers=h, data={"payload": json.dumps(payload)}).json()["id"]
    return h, user, entry, draft, payload


@pytest.mark.parametrize("mode", ["closed", "disconnect", "reconnect"])
def test_closed_job_or_disconnect_prevents_send(client, monkeypatch, mode):
    h, user, entry, draft, _ = setup(client, monkeypatch)
    if mode == "closed":
        client.patch(f"/v1/jobs/tracker/{entry}", headers=h, json={"status": "withdrawn"})
    original = httpx.AsyncClient
    sends = []

    async def handle(request):
        if request.url.host == "oauth2.googleapis.com":
            if mode == "disconnect":
                async with sessionmaker()() as db:
                    await db.execute(delete(GmailConnection).where(GmailConnection.user_id == user))
                    await db.commit()
            if mode == "reconnect":
                async with sessionmaker()() as db:
                    row = await db.get(GmailConnection, user)
                    row.data = {**row.data, "generation": "new-connection"}
                    await db.commit()
            return httpx.Response(200, json={"access_token": "token"})
        sends.append(1)
        return httpx.Response(200, json={"id": "receipt"})

    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda: original(transport=httpx.MockTransport(handle)))
    result = client.post(f"/v1/gmail/attempts/{draft}/send", headers=h, json={"confirmed": True})
    assert result.status_code == 409 and len(sends) == 0
    if mode == "disconnect":
        assert client.get("/v1/gmail", headers=h).json()["connected"] is False


def test_tracker_delete_cannot_erase_delivery_history(client, monkeypatch):
    h, user, entry, draft, _payload = setup(client, monkeypatch)
    original = httpx.AsyncClient

    async def handle(request):
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "token"})
        from fastapi import HTTPException

        from orbit_api.job_portal.routes import delete_tracker
        from orbit_api.models import User

        async with sessionmaker()() as db:
            person = await db.get(User, user)
            try:
                await delete_tracker(entry, person, db)
            except HTTPException as exc:
                assert exc.status_code == 409
            else:
                raise AssertionError("In-flight job deletion must be blocked")
        return httpx.Response(200, json={"id": "accepted-but-lost"})

    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda: original(transport=httpx.MockTransport(handle)))
    result = client.post(f"/v1/gmail/attempts/{draft}/send", headers=h, json={"confirmed": True})
    assert result.status_code == 200
    attempts = client.get("/v1/auth/me/export", headers=h).json()["gmail_attempts"]
    assert len(attempts) == 1 and attempts[0]["data"]["message_id"] == "accepted-but-lost"
    assert client.delete(f"/v1/jobs/tracker/{entry}", headers=h).status_code == 409
