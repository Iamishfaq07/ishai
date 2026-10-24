import json
import uuid
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.gmail import routes
from orbit_api.models import GmailConnection
from orbit_api.runtime_config import encrypt_secret
from tests.business_helpers import auth, db_call, register


def test_gmail_review_send_and_oauth_state(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-client")
    monkeypatch.setattr(settings, "google_client_secret", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "config_secret", SecretStr("encryption-test-secret"))
    monkeypatch.setattr(settings, "gmail_redirect_uri", "http://localhost/v1/gmail/callback")
    h = auth(register(client, f"gmail-{uuid.uuid4().hex}@example.com"))
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]
    entry = client.post("/v1/jobs/tracker/manual", headers=h,
                        json={"title": "Developer", "company": "Example"}).json()["id"]
    async def connected(db: AsyncSession) -> None:
        db.add(GmailConnection(user_id=user_id, data={"email": "sender@example.com",
                                                   "refresh": encrypt_secret("refresh-secret")}))
    db_call(client, connected)
    original = httpx.AsyncClient
    sends = []
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "access-secret"})
        sends.append(request)
        return httpx.Response(200, json={"id": "gmail-receipt"})
    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda: original(transport=httpx.MockTransport(handle)))
    payload = {"recipient": "hiring@example.com", "subject": "My application",
               "body": "Please review my application for this role."}
    created = client.post(f"/v1/gmail/draft/{entry}", headers=h,
                          data={"payload": json.dumps(payload)})
    assert created.status_code == 201, created.text
    identity = created.json()["id"]
    assert "mime" not in created.json()
    assert "refresh-secret" not in client.get("/v1/gmail", headers=h).text
    assert client.post(f"/v1/gmail/attempts/{identity}/send", headers=h,
                       json={"confirmed": False}).status_code == 422
    result = client.post(f"/v1/gmail/attempts/{identity}/send", headers=h, json={"confirmed": True})
    assert result.status_code == 200, result.text
    assert result.json()["message_id"] == "gmail-receipt"
    assert client.post(f"/v1/gmail/attempts/{identity}/send", headers=h,
                       json={"confirmed": True}).status_code == 409
    assert len(sends) == 1
    assert client.delete(f"/v1/gmail/attempts/{identity}", headers=h).status_code == 409
    exported = client.get("/v1/auth/me/export", headers=h).json()
    assert exported["gmail_attempts"][0]["data"]["message_id"] == "gmail-receipt"
    assert "refresh-secret" not in json.dumps(exported)
    other = auth(register(client, f"gmail-other-{uuid.uuid4().hex}@example.com"))
    assert client.get(f"/v1/gmail/attempts/{entry}", headers=other).status_code == 404
    assert client.post(f"/v1/gmail/attempts/{identity}/send", headers=other,
                       json={"confirmed": True}).status_code == 404
    start = client.post("/v1/gmail/connect", headers=h)
    query = parse_qs(urlsplit(start.json()["url"]).query)
    assert query["code_challenge_method"] == ["S256"]
    state = query["state"][0]
    denied = client.get("/v1/gmail/callback", headers=h, params={"state": state, "error": "denied"},
                        follow_redirects=False)
    assert denied.status_code == 303
    assert client.get("/v1/gmail/callback", headers=h,
                      params={"state": state, "error": "denied"}).status_code == 409
    assert client.delete("/v1/gmail", headers=h).status_code == 204
    assert client.get("/v1/gmail", headers=h).json()["connected"] is False


def test_successful_oauth_verifies_identity_and_encrypts_refresh(client: TestClient,
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa

    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-client")
    monkeypatch.setattr(settings, "google_client_secret", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "config_secret", SecretStr("encryption-test-secret"))
    monkeypatch.setattr(settings, "gmail_redirect_uri", "http://localhost/v1/gmail/callback")
    h = auth(register(client, f"oauth-{uuid.uuid4().hex}@example.com"))
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]
    start = client.post("/v1/gmail/connect", headers=h).json()
    query = parse_qs(urlsplit(start["url"]).query)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    identity = jwt.encode({"aud": "test-client", "iss": "https://accounts.google.com",
        "exp": datetime.now(UTC) + timedelta(minutes=5), "nonce": query["nonce"][0],
        "email": "connected@example.com", "email_verified": True}, key, algorithm="RS256")
    monkeypatch.setattr(routes._jwks, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key=key.public_key()))
    original = httpx.AsyncClient
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id_token": identity, "scope": routes.SCOPE,
                                        "refresh_token": "private-refresh-token"})
    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda: original(transport=httpx.MockTransport(handle)))
    result = client.get("/v1/gmail/callback", headers=h,
        params={"state": query["state"][0], "code": "test-authorization-code"}, follow_redirects=False)
    assert result.status_code == 303, result.text
    assert client.get("/v1/gmail", headers=h).json()["email"] == "connected@example.com"
    async def encrypted(db: AsyncSession) -> None:
        row = await db.get(GmailConnection, user_id)
        assert row is not None
        assert "private-refresh-token" not in json.dumps(row.data)
        assert "pending" not in row.data
    db_call(client, encrypted)
