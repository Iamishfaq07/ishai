"""Controlled multi-worker interleavings prevent overlapping replacement runs and stale acknowledgements."""
import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from orbit_api import jobs
from orbit_api.db import sessionmaker
from orbit_api.models import Job


@pytest.fixture
def quiet_client(monkeypatch):
    async def idle(_poll):
        await asyncio.Event().wait()
    monkeypatch.setattr(jobs, "worker", idle)
    from orbit_api.main import create_app

    with TestClient(create_app()) as client:
        yield client


@pytest.mark.parametrize("fail_first", [False, True])
def test_superseded_payload_waits_for_its_predecessor(quiet_client, monkeypatch, fail_first):
    async def run():
        kind, key = f"lease-{uuid.uuid4().hex[:8]}", f"lease:{uuid.uuid4()}"
        entered, release = asyncio.Event(), asyncio.Event()
        seen = []

        async def handle(payload):
            seen.append(payload["revision"])
            if payload["revision"] == 1:
                entered.set()
                await release.wait()
                if fail_first:
                    raise RuntimeError("Original request failed; newer payload must still run")
        monkeypatch.setitem(jobs._handlers, kind, handle)
        await jobs.enqueue_now(kind, {"revision": 1}, key)
        first = asyncio.create_task(jobs.run_due_jobs())
        try:
            await asyncio.wait_for(entered.wait(), 3)
            await jobs.enqueue_now(kind, {"revision": 2}, key)
            await jobs.enqueue_now(kind, {"revision": 3}, key)
            assert await jobs.requeue_interrupted() == 0
            assert await jobs.run_due_jobs() == 0
            assert seen == [1]
        finally:
            release.set()
            await first
        assert await jobs.run_due_jobs() == 1
        assert seen == [1, 3]
        async with sessionmaker()() as db:
            row = await db.scalar(select(Job).where(Job.dedupe_key == key))
            assert row.status == "done" and row.attempts == 1
            assert row.lease_token is None and not row.rerun_requested
    quiet_client.portal.call(run)


def test_replaced_worker_cannot_complete_or_release_new_lease(quiet_client):
    async def run():
        key = f"fence:{uuid.uuid4()}"
        await jobs.enqueue_now("test-fence", {}, key)
        async with sessionmaker()() as db:
            row = await db.scalar(select(Job).where(Job.dedupe_key == key))
            identity = row.id
            old = await jobs._claim(db, identity)
        assert old
        async with sessionmaker()() as db:
            await db.execute(update(Job).where(Job.id == identity).values(
                lease_until=datetime.now(UTC) - timedelta(seconds=1)))
            await db.commit()
        assert await jobs.requeue_interrupted() == 1
        async with sessionmaker()() as db:
            new = await jobs._claim(db, identity)
        assert new and new != old
        assert not await jobs._finish(identity, old, 1, None)
        await jobs._requeue(identity, old)
        async with sessionmaker()() as db:
            row = await db.get(Job, identity)
            assert row.status == "running" and row.lease_token == new and row.attempts == 2
        assert await jobs._finish(identity, new, 2, None)
    quiet_client.portal.call(run)


def test_shutdown_preserves_new_payload_without_spending_an_attempt(quiet_client):
    async def run():
        key = f"shutdown:{uuid.uuid4()}"
        await jobs.enqueue_now("test-shutdown", {"revision": 1}, key)
        async with sessionmaker()() as db:
            row = await db.scalar(select(Job).where(Job.dedupe_key == key))
            identity = row.id
            token = await jobs._claim(db, identity)
        await jobs.enqueue_now("test-shutdown", {"revision": 2}, key)
        await jobs._requeue(identity, token)
        async with sessionmaker()() as db:
            row = await db.get(Job, identity)
            assert (row.status, row.attempts, row.payload) == ("queued", 0, {"revision": 2})
            assert row.lease_token is None and not row.rerun_requested
    quiet_client.portal.call(run)


def test_future_job_cannot_be_claimed_and_fresh_legacy_worker_is_left_alone(quiet_client):
    async def run():
        async with sessionmaker()() as db:
            future = Job(kind="future", payload={}, run_after=datetime.now(UTC) + timedelta(days=1))
            legacy = Job(kind="legacy", payload={}, status="running", updated_at=datetime.now(UTC))
            db.add_all([future, legacy])
            await db.commit()
            assert await jobs._claim(db, future.id) is None
        assert await jobs.requeue_interrupted() == 0
    quiet_client.portal.call(run)


def test_repeated_crashes_exhaust_budget_but_new_payload_gets_fresh_budget(quiet_client):
    async def run():
        now = datetime.now(UTC)
        async with sessionmaker()() as db:
            exhausted = Job(kind="report", payload={}, status="running", attempts=jobs.MAX_ATTEMPTS,
                            lease_token="crashed", lease_until=now - timedelta(seconds=1))
            newer = Job(kind="report", payload={"new": True}, status="running", attempts=jobs.MAX_ATTEMPTS,
                        rerun_requested=True, lease_token="crashed-old", lease_until=now - timedelta(seconds=1))
            db.add_all([exhausted, newer])
            await db.commit()
            exhausted_id, newer_id = exhausted.id, newer.id
        assert await jobs.requeue_interrupted() == 2
        async with sessionmaker()() as db:
            failed = await db.get(Job, exhausted_id)
            queued = await db.get(Job, newer_id)
            assert failed.status == "failed" and failed.last_error.startswith("WorkerLeaseExpired:")
            assert queued.status == "queued" and queued.attempts == 0 and not queued.rerun_requested
            assert failed.lease_token is None and queued.lease_token is None
    quiet_client.portal.call(run)
