"""Weekly goals stay account-owned, revisioned and tied to actual recorded activity."""
import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from orbit_api.models import CareerWeeklyGoal, JobApplication, JobContact, LiveSessionRow, User
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def person(client: TestClient) -> dict[str, str]:
    return register(client, f"weekly-{tag()}@example.com")


def targets(client: TestClient, user: dict[str, str], revision: int = 0, **extra: Any) -> Any:
    return client.put("/v1/jobs/weekly/targets", headers=auth(user), json={
        "base_revision": revision, "applications": 5, "practice": 2, "contacts": 2, **extra})


def test_targets_persist_are_private_and_reject_stale_writes(client: TestClient) -> None:
    user, stranger = person(client), person(client)
    first = client.get("/v1/jobs/weekly", headers=auth(user)).json()
    assert first["revision"] == 0 and first["targets"]["practice"] == 2
    saved = targets(client, user, contacts=0, applications=8)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1 and saved.json()["targets"]["contacts"] == 0
    assert targets(client, user).status_code == 409
    assert client.get("/v1/jobs/weekly", headers=auth(stranger)).json()["targets"]["applications"] == 5
    exported = client.get("/v1/auth/me/export", headers=auth(user))
    assert exported.status_code == 200, exported.text
    assert exported.json()["job_search"]["weekly_goals"]["applications"] == 8


@pytest.mark.parametrize("extra", [{"applications": -1}, {"practice": 31}, {"contacts": 51},
                                   {"applications": 1.5}, {"practice": True}, {"admin": True}])
def test_goal_bounds_and_mass_assignment(client: TestClient, extra: dict[str, Any]) -> None:
    assert targets(client, person(client), **extra).status_code == 422


def test_progress_has_exact_utc_week_boundary_and_counts_only_saved_sources(client: TestClient) -> None:
    from orbit_api.job_portal.weekly import snapshot

    user, stranger = person(client), person(client)
    now = datetime(2026, 10, 21, 12, tzinfo=UTC)
    monday = datetime(2026, 10, 19, tzinfo=UTC)
    async def seed(db: Any) -> Any:
        for i, (owner, at) in enumerate([(uid(user), monday), (uid(user), monday - timedelta(seconds=1)),
                (uid(user), now + timedelta(seconds=1)), (uid(stranger), monday)]):
            db.add(JobApplication(user_id=owner, listing_id=f"weekly-{tag()}", title=f"Job {i}", company="Test",
                source="manual", url="", apply_url="", status="rejected", applied_at=at))
        for session_type, status, at in [("mock", "ended", monday), ("mock", "live", monday),
                ("general", "ended", monday), ("mock", "ended", monday - timedelta(seconds=1))]:
            db.add(LiveSessionRow(user_id=uid(user), type=session_type, title="Practice", status=status, ended_at=at))
        db.add(JobContact(user_id=uid(user), name="Alex", last_contacted_at=monday))
        db.add(JobContact(user_id=uid(user), name="Future", last_contacted_at=now + timedelta(seconds=1)))
        await db.flush()
        return await snapshot(db, await db.get(User, uid(user)), now)
    result = db_call(client, seed)
    assert result["week_start"] == "2026-10-19" and result["week_end"] == "2026-10-26"
    assert [m["count"] for m in result["metrics"]] == [1, 1, 1]
    assert [d["count"] for d in result["days"]] == [3, 0, 0, 0, 0, 0, 0]


def test_concurrent_target_writers_have_one_winner(client: TestClient) -> None:
    user = person(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: targets(client, user).status_code, range(2)))
    assert sorted(results) == [200, 409]


def test_ai_coach_is_sourced_and_cannot_change_targets(client: TestClient) -> None:
    user = person(client)
    before = client.get("/v1/jobs/weekly", headers=auth(user)).json()
    result = client.post("/v1/jobs/weekly/coach", headers=auth(user), json={"version": before["version"]})
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "mock" and result.json()["tips"][0]["fact_id"] == "applications"
    assert client.get("/v1/jobs/weekly", headers=auth(user)).json()["revision"] == 0
    assert targets(client, user).status_code == 200
    stale = client.post("/v1/jobs/weekly/coach", headers=auth(user), json={"version": before["version"]})
    assert stale.status_code == 409


@pytest.mark.parametrize("bad", ["quote", "id"])
def test_coach_rejects_unsupported_model_evidence(client: TestClient,
        monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    user = person(client)
    source = client.get("/v1/jobs/weekly", headers=auth(user)).json()
    tip = {"fact_id": "applications", "source_quote": source["metrics"][0]["text"],
        "suggestion": "Try a manageable application goal.",
        "success_check": "Review your recorded applications next week."}
    if bad == "quote":
        tip["source_quote"] = "Invented qualifications"
    if bad == "id":
        tip["fact_id"] = "another-user"
    mock = MockLLMProvider(script=[json.dumps({"tips": [tip, tip] if bad == "duplicate" else [tip]})])
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    result = client.post("/v1/jobs/weekly/coach", headers=auth(user), json={"version": source["version"]})
    assert result.status_code == 502


def test_goal_row_cascades_with_account_deletion_and_reads_require_auth(client: TestClient) -> None:
    user = person(client)
    assert targets(client, user).status_code == 200
    async def erase(db: Any) -> None:
        await db.execute(delete(User).where(User.id == uid(user)))
        assert await db.get(CareerWeeklyGoal, uid(user)) is None
    db_call(client, erase)
    client.cookies.clear()
    assert client.get("/v1/jobs/weekly").status_code == 401


def test_coaching_rejects_goals_changed_while_provider_was_running(client: TestClient,
        monkeypatch: pytest.MonkeyPatch) -> None:
    user = person(client)
    assert targets(client, user).status_code == 200
    before = client.get("/v1/jobs/weekly", headers=auth(user)).json()
    class Changing(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            from orbit_api.db import sessionmaker
            async with sessionmaker()() as db:
                row = await db.get(CareerWeeklyGoal, uid(user))
                assert row
                row.applications, row.revision = 7, row.revision + 1
                await db.commit()
            return await super().generate(request)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Changing)
    response = client.post("/v1/jobs/weekly/coach", headers=auth(user), json={"version": before["version"]})
    assert response.status_code == 409
