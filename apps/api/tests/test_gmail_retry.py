"""Definite rejection recovery never replays uncertain delivery or erases history."""
import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.gmail import routes
from orbit_api.models import GmailAttempt, GmailConnection
from orbit_api.runtime_config import encrypt_secret
from tests.business_helpers import auth, db_call, register


@pytest.mark.parametrize("code", [401, 403, 429, 408, 503, 400])
def test_review_retry_preserves_content_and_history(client: TestClient, monkeypatch: pytest.MonkeyPatch,
                                                   code: int) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "test-client")
    monkeypatch.setattr(settings, "google_client_secret", SecretStr("test-secret"))
    monkeypatch.setattr(settings, "config_secret", SecretStr("encryption-test-secret"))
    monkeypatch.setattr(settings, "gmail_redirect_uri", "http://localhost/v1/gmail/callback")
    headers = auth(register(client, f"retry-{uuid.uuid4().hex}@example.com"))
    user_id = client.get("/v1/auth/me", headers=headers).json()["id"]
    entry = client.post("/v1/jobs/tracker/manual", headers=headers,
                        json={"title": "Developer", "company": "Example"}).json()["id"]

    async def connect(db: AsyncSession) -> None:
        db.add(GmailConnection(user_id=user_id, data={"email": "sender@example.com",
                                                   "refresh": encrypt_secret("refresh-secret")}))
    db_call(client, connect)
    original = httpx.AsyncClient
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "access-secret"})
        requests.append(json.loads(request.content)["raw"])
        return (httpx.Response(code, json={}, headers={"Retry-After": "3600"}) if len(requests) == 1
                else httpx.Response(200, json={"id": "retry-receipt"}))
    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda: original(transport=httpx.MockTransport(handle)))
    draft = client.post(f"/v1/gmail/draft/{entry}", headers=headers, data={"payload": json.dumps({
        "recipient": "hiring@example.com", "subject": "My application",
        "body": "Please review my application for this role."})})
    assert draft.status_code == 201, draft.text
    identity = draft.json()["id"]
    url = f"/v1/gmail/attempts/{identity}"
    confirmed = {"confirmed": True}
    result = client.post(f"{url}/send", headers=headers, json=confirmed)
    assert result.status_code == 200, result.text
    assert client.post(f"{url}/send", headers=headers, json=confirmed).status_code == 409
    assert client.post(f"{url}/retry", headers=headers, json=confirmed).status_code == 409
    assert len(requests) == 1

    async def elapsed(db: AsyncSession) -> None:
        row = await db.get(GmailAttempt, identity)
        assert row is not None
        row.data = {**row.data, "retry_after": (datetime.now(UTC) - timedelta(seconds=1)).isoformat()}
        await db.commit()
    db_call(client, elapsed)
    if code not in {401, 403, 429}:
        assert client.post(f"{url}/retry", headers=headers, json=confirmed).status_code == 409
        assert len(requests) == 1
        return
    other = auth(register(client, f"retry-other-{uuid.uuid4().hex}@example.com"))
    assert client.post(f"{url}/retry", headers=other, json=confirmed).status_code == 404
    assert client.post(f"{url}/retry", headers=headers, json={"confirmed": False}).status_code == 422
    assert client.post(f"{url}/retry", headers=headers, json=confirmed).status_code == 200
    record = client.get(f"/v1/gmail/attempts/{entry}", headers=headers).json()[0]
    assert record["status"] == "ready"
    assert record["deliveries"][0]["status"] == "rejected"
    assert "mime" not in record
    assert client.post(f"{url}/retry", headers=headers, json=confirmed).status_code == 409
    assert client.delete(url, headers=headers).status_code == 409
    assert client.delete(f"/v1/jobs/tracker/{entry}", headers=headers).status_code == 409
    assert client.post(f"{url}/send", headers=headers, json={"confirmed": False}).status_code == 422
    sent = client.post(f"{url}/send", headers=headers, json=confirmed)
    assert sent.status_code == 200, sent.text
    assert sent.json()["message_id"] == "retry-receipt"
    assert len(requests) == 2 and requests[0] == requests[1]
    record = client.get(f"/v1/gmail/attempts/{entry}", headers=headers).json()[0]
    assert [d["status"] for d in record["deliveries"]] == ["rejected", "sent"]
    assert client.post(f"{url}/retry", headers=headers, json=confirmed).status_code == 409

    async def limit(db: AsyncSession) -> None:
        row = await db.get(GmailAttempt, identity)
        assert row is not None
        row.status = "rejected"
        row.data = {**row.data, "retryable": True,
                    "retry_after": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
                    "deliveries": [{"number": i + 1, "status": "rejected"} for i in range(5)]}
        await db.commit()
    db_call(client, limit)
    assert client.post(f"{url}/retry", headers=headers, json=confirmed).status_code == 409
    assert len(requests) == 2
