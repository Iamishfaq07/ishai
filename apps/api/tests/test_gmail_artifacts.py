"""Reviewed MIME stays out of ordinary queries but remains in the owner's streamed export."""
import base64
import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db import get_engine
from orbit_api.gmail import routes
from orbit_api.models import GmailArtifact, GmailAttempt
from tests.business_helpers import db_call
from tests.test_gmail_lifecycle_boundaries import setup


def test_artifact_separation_export_isolation_and_discard_cascade(client: TestClient,
                                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    headers, _user, entry, identity, payload = setup(client, monkeypatch)
    next_entry = client.post("/v1/jobs/tracker/manual", headers=headers,
        json={"title": "Second application", "company": "ExportCo"}).json()["id"]
    second = client.post(f"/v1/gmail/draft/{next_entry}", headers=headers,
        data={"payload": json.dumps({**payload, "subject": "Second reviewed application"})}).json()["id"]
    captured: dict[str, bytes] = {}

    async def check_storage(db: AsyncSession) -> None:
        for attempt_id in (identity, second):
            attempt = await db.get(GmailAttempt, attempt_id)
            artifact = await db.get(GmailArtifact, attempt_id)
            assert attempt is not None and artifact is not None
            assert "mime" not in attempt.data
            assert hashlib.sha256(artifact.content).hexdigest() == attempt.data["sha256"]
            captured[attempt_id] = artifact.content
    db_call(client, check_storage)
    statements: list[str] = []

    def queries(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())
    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", queries)
    try:
        assert client.get(f"/v1/gmail/attempts/{entry}", headers=headers).status_code == 200
        assert client.get("/v1/jobs/actions", headers=headers).status_code == 200
        assert not any("gmail_artifacts" in sql for sql in statements)
        statements.clear()
        exported = client.get("/v1/auth/me/export", headers=headers)
        assert exported.status_code == 200
        assert exported.headers["cache-control"] == "no-store"
        assert "content-length" not in exported.headers
        records = exported.json()["gmail_attempts"]
        assert len(records) == 2
        for record in records:
            assert base64.b64decode(record["data"]["mime"]) == captured[record["id"]]
            assert record["data"]["recipient"] == payload["recipient"]
        artifact_queries = [sql for sql in statements if "gmail_artifacts" in sql]
        assert artifact_queries and all("limit" in sql for sql in artifact_queries)
    finally:
        event.remove(engine, "before_cursor_execute", queries)
    other_headers, *_ = setup(client, monkeypatch)
    other_export = client.get("/v1/auth/me/export", headers=other_headers).json()
    assert identity not in {r["id"] for r in other_export["gmail_attempts"]}
    assert client.delete(f"/v1/gmail/attempts/{identity}", headers=headers).status_code == 204

    async def deleted(db: AsyncSession) -> None:
        assert await db.get(GmailArtifact, identity) is None
        assert await db.get(GmailArtifact, second) is not None
    db_call(client, deleted)
    erased = client.request("DELETE", "/v1/auth/me", headers=headers, json={"password": "correct horse battery"})
    assert erased.status_code == 204, erased.text

    async def erased_artifacts(db: AsyncSession) -> None:
        assert await db.get(GmailArtifact, second) is None
    db_call(client, erased_artifacts)


def test_storage_quota_counts_owned_artifacts_and_discard_frees_space(client: TestClient,
                                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    headers, _user, _entry, identity, payload = setup(client, monkeypatch)
    limit: list[int] = []

    async def size(db: AsyncSession) -> None:
        artifact = await db.get(GmailArtifact, identity)
        assert artifact is not None
        limit.append(len(artifact.content))
    db_call(client, size)
    monkeypatch.setattr(routes, "MAX_STORED_MIME_BYTES", limit[0] + 10)
    entry = client.post("/v1/jobs/tracker/manual", headers=headers,
                        json={"title": "Another engineer", "company": "QuotaCo"}).json()["id"]
    blocked = client.post(f"/v1/gmail/draft/{entry}", headers=headers, data={"payload": json.dumps(payload)})
    assert blocked.status_code == 409 and "storage" in blocked.text
    assert client.get(f"/v1/gmail/attempts/{entry}", headers=headers).json() == []
    # Another account's storage cannot consume this account's quota.
    other, *_ = setup(client, monkeypatch)
    assert other
    assert client.delete(f"/v1/gmail/attempts/{identity}", headers=headers).status_code == 204
    assert client.post(f"/v1/gmail/draft/{entry}", headers=headers,
                       data={"payload": json.dumps(payload)}).status_code == 201


@pytest.mark.parametrize("missing", [False, True])
def test_corrupt_or_missing_mime_never_sends(client: TestClient, monkeypatch: pytest.MonkeyPatch,
                                           missing: bool) -> None:
    headers, _user, _entry, identity, _payload = setup(client, monkeypatch)

    async def corrupt(db: AsyncSession) -> None:
        artifact = await db.get(GmailArtifact, identity)
        assert artifact is not None
        if missing:
            await db.delete(artifact)
        else:
            artifact.content = b"Changed after review"
        await db.commit()
    db_call(client, corrupt)
    sent = client.post(f"/v1/gmail/attempts/{identity}/send", headers=headers, json={"confirmed": True})
    assert sent.status_code == 409

    async def unchanged(db: AsyncSession) -> None:
        assert await db.scalar(select(GmailAttempt.status).where(GmailAttempt.id == identity)) == "ready"
    db_call(client, unchanged)
