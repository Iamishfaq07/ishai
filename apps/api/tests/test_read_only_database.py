"""A database that answers reads but refuses writes (DECISIONS D56): `/ready` says so instead of "ok", the admin
Overview warns, and a signed-in read doesn't fail just because the device's "last used" time can't be saved."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import db as database
from orbit_api.models import UserSession
from tests.test_admin_console import console  # noqa: F401  (fixture)


async def _read_only(_: AsyncSession) -> bool:
    return True


def test_ready_says_the_database_is_read_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.get("/ready").json()["checks"]["database"] == "ok"
    monkeypatch.setattr(database, "refuses_writes", _read_only)
    r = client.get("/ready")
    # SELECT 1 still works on a read-only database: before D56 this said "ok" with a 200.
    assert r.status_code == 503
    assert r.json() == {"status": "not_ready", "checks": {"database": "read_only"}}


def test_refuses_writes_asks_postgres_and_skips_sqlite(client: TestClient) -> None:
    asked: list[str] = []

    class Result:
        def scalar(self) -> bool:
            return True

    class Postgres:
        def get_bind(self) -> Any:
            return type("Bind", (), {"dialect": type("Dialect", (), {"name": "postgresql"})()})()

        async def execute(self, statement: Any) -> Result:
            asked.append(str(statement))
            return Result()

    assert asyncio.run(database.refuses_writes(Postgres())) is True  # type: ignore[arg-type]
    assert "current_setting('transaction_read_only')" in asked[0] and "pg_is_in_recovery()" in asked[0]

    async def sqlite() -> bool:
        async with database.sessionmaker()() as session:
            return await database.refuses_writes(session)

    assert client.portal.call(sqlite) is False  # type: ignore[union-attr]


def test_the_admin_overview_warns_of_a_read_only_database(console: Any,  # noqa: F811
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    client, admin, _ = console
    assert "database_read_only" not in client.get("/v1/admin/stats", headers=admin).json()["warnings"]
    monkeypatch.setattr(database, "refuses_writes", _read_only)
    assert "database_read_only" in client.get("/v1/admin/stats", headers=admin).json()["warnings"]


def test_a_device_touch_the_database_refuses_doesnt_fail_the_request(client: TestClient,
                                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    email = f"ro-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": "read only test pw"})
    assert r.status_code == 201
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    user_id = r.json()["user"]["id"]

    async def stale() -> None:  # last used an hour ago: this request writes last_seen_at
        async with database.sessionmaker()() as db:
            await db.execute(update(UserSession).where(UserSession.user_id == user_id)
                             .values(last_seen_at=datetime.now(UTC) - timedelta(hours=1)))
            await db.commit()

    client.portal.call(stale)  # type: ignore[union-attr]
    real_commit = AsyncSession.commit

    async def refused(self: AsyncSession) -> None:
        if any(isinstance(o, UserSession) for o in self.dirty):
            raise OperationalError("UPDATE user_sessions", {}, Exception("cannot execute UPDATE in a read-only "
                                                                         "transaction"))
        await real_commit(self)

    monkeypatch.setattr(AsyncSession, "commit", refused)
    me = client.get("/v1/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    assert me.json()["email"] == email
