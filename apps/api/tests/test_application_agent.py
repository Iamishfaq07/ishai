"""Shortlists retain planner gates; the second reader is owned, grounded and advisory."""
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.db import sessionmaker
from orbit_api.models import ApplicationPacket, AutoApplySetup, JobListing
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.autoapply_helpers import account, ext_token, jobs, user_id
from tests.test_api import _register
from tests.test_auto_apply import app as app
from tests.test_auto_apply import packet_row, packets, plan
from tests.test_jobs import run


def saved(client: TestClient, h: dict[str, str], lid: str) -> None:
    response = client.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid})
    assert response.status_code == 201, response.text


def review_path(packet_id: str) -> str:
    return f"/v1/apply/packets/{packet_id}/review"


def prepared(client: TestClient) -> tuple[dict[str, str], str]:
    h, _ = account(client, mode="review")
    jobs(client)
    assert plan(client, h)["created"] == 3
    return h, packets(client, h)[0]["id"]


def test_shortlist_only_plans_selected_saved_jobs_without_delaying_sweep(app: TestClient) -> None:
    h, _ = account(app, mode="review")
    ids = jobs(app)
    saved(app, h, ids["greenhouse"])
    response = app.post("/v1/apply/plan-shortlist", headers=h, json={"listing_ids": [ids["greenhouse"]]})
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1
    assert [p["listing_id"] for p in packets(app, h)] == [ids["greenhouse"]]
    repeated = app.post("/v1/apply/plan-shortlist", headers=h, json={"listing_ids": [ids["greenhouse"]]})
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["created"] == 0 and repeated.json()["skipped"][0]["reason"] == "Already prepared or applied."
    uid = user_id(app, h)
    async def check() -> None:
        async with sessionmaker()() as db:
            setup = await db.get(AutoApplySetup, uid)
            assert setup and setup.last_planned_at is None
    run(app, check)
    assert plan(app, h)["created"] == 2


def test_shortlist_never_bypasses_ownership_or_saved_status(app: TestClient) -> None:
    h, _ = account(app)
    other = _register(app)
    lid = jobs(app)["greenhouse"]
    saved(app, h, lid)
    body = {"listing_ids": [lid]}
    assert app.post("/v1/apply/plan-shortlist", headers=other, json=body).status_code == 404
    entry = app.get("/v1/jobs/tracker", headers=h).json()[0]
    app.patch(f"/v1/jobs/tracker/{entry['id']}", headers=h, json={"status": "applied"})
    assert app.post("/v1/apply/plan-shortlist", headers=h, json=body).status_code == 404
    assert app.post("/v1/apply/plan-shortlist", headers=h, json={"listing_ids": []}).status_code == 422
    assert app.post("/v1/apply/plan-shortlist", headers=h, json={"listing_ids": [lid] * 21}).status_code == 422
    assert packets(app, h) == []


@pytest.mark.parametrize("setup", [{"paused": True},
    {"filters": {"titles": ["Backend Engineer"], "exclude_companies": ["Acme"]}}])
def test_shortlist_keeps_pause_threshold_and_exclusion_gates(app: TestClient, setup: dict[str, Any]) -> None:
    h, _ = account(app, **{k: v for k, v in setup.items() if k != "paused"})
    lid = jobs(app)["greenhouse"]
    saved(app, h, lid)
    if setup.get("paused"):
        assert app.post("/v1/apply/pause", headers=h).status_code == 200
    response = app.post("/v1/apply/plan-shortlist", headers=h, json={"listing_ids": [lid]})
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 0
    assert response.json()["blocked"] or response.json()["skipped"]


def test_selected_job_still_has_to_clear_the_match_threshold(app: TestClient,
        monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.job_portal import routes
    original = routes._matches
    async def low_matches(*args: Any, **kw: Any) -> Any:
        return [replace(m, score=49) for m in await original(*args, **kw)]
    h, _ = account(app, threshold=60)
    lid = jobs(app)["greenhouse"]
    saved(app, h, lid)
    monkeypatch.setattr(routes, "_matches", low_matches)
    response = app.post("/v1/apply/plan-shortlist", headers=h, json={"listing_ids": [lid]})
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 0 and response.json()["skipped"]
    assert packets(app, h) == []


def test_second_reader_is_owned_labelled_and_never_approves(app: TestClient) -> None:
    h, pid = prepared(app)
    path = review_path(pid)
    other = _register(app)
    assert app.get(path, headers=other).status_code == 404
    assert app.get(path, headers=ext_token(app, h)).status_code == 403
    snapshot = app.get(path, headers=h).json()
    before = packet_row(app, pid).status
    response = app.post(path, headers=h, json={"version": snapshot["version"]})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["source"] == "mock"
    sources = {f["id"]: f["text"] for f in data["facts"]}
    assert all(tip["source_quote"] in sources[tip["fact_id"]] for tip in data["tips"])
    assert packet_row(app, pid).status == before  # neither answers nor review approvals are granted
    assert app.post(path, headers=other, json={"version": snapshot["version"]}).status_code == 404


def test_second_reader_rejects_stale_sources_before_using_ai(app: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h, pid = prepared(app)
    path = review_path(pid)
    source = app.get(path, headers=h).json()
    async def change() -> None:
        async with sessionmaker()() as db:
            packet = await db.get(ApplicationPacket, pid)
            assert packet
            packet.cover_letter = "Updated draft for review"
            await db.commit()
    run(app, change)
    llm = MockLLMProvider()
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: llm)
    assert app.post(path, headers=h, json={"version": source["version"]}).status_code == 409
    assert not llm.requests


@pytest.mark.parametrize("bad", ["quote", "source", "duplicate", "malformed"])
def test_second_reader_rejects_ungrounded_or_malformed_ai(app: TestClient, monkeypatch: pytest.MonkeyPatch,
        bad: str) -> None:
    h, pid = prepared(app)
    path = review_path(pid)
    source = app.get(path, headers=h).json()
    fact = source["facts"][0]
    tip = {"fact_id": "stranger" if bad == "source" else fact["id"],
        "source_quote": "Fabricated skill" if bad == "quote" else fact["text"][:100],
        "suggestion": "Check the stated requirements against your experience.",
        "success_check": "Re-read the exact materials before changing them."}
    output = "invalid" if bad == "malformed" else json.dumps({"tips": [tip, tip] if bad == "duplicate" else [tip]})
    llm = MockLLMProvider(script=[output])
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: llm)
    assert app.post(path, headers=h, json={"version": source["version"]}).status_code == 502
    assert len(llm.requests) == 1


def test_second_reader_detects_concurrent_edits_and_has_durable_daily_budget(app: TestClient,
        monkeypatch: pytest.MonkeyPatch) -> None:
    h, pid = prepared(app)
    path = review_path(pid)
    source = app.get(path, headers=h).json()
    class Changing(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            async with sessionmaker()() as db:
                p = await db.get(ApplicationPacket, pid)
                assert p
                p.reason = "Changed while inference was running"
                await db.commit()
            return await super().generate(request)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Changing)
    assert app.post(path, headers=h, json={"version": source["version"]}).status_code == 409
    llm = MockLLMProvider(script=["invalid"] * 5)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: llm)
    source = app.get(path, headers=h).json()
    for _ in range(4):
        assert app.post(path, headers=h, json={"version": source["version"]}).status_code == 502
    assert app.post(path, headers=h, json={"version": source["version"]}).status_code == 429
    assert len(llm.requests) == 4


def test_review_snapshot_handles_missing_listing_and_resume(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    async def insert() -> str:
        async with sessionmaker()() as db:
            p = ApplicationPacket(user_id=uid, listing_id="removed", company="Acme", company_key="acme",
                title="Engineer", status="handoff", ats="board", url="https://example.com",
                apply_url="https://example.com", expires_at=datetime.now(UTC) + timedelta(days=3))
            db.add(p)
            await db.flush()
            pid = p.id
            await db.commit()
            return pid
    pid = run(app, insert)
    source = app.get(review_path(pid), headers=h)
    assert source.status_code == 200, source.text
    assert "Posting no longer available." in source.json()["facts"][0]["text"]


def test_posting_archive_survives_changes_and_cache_removal(app: TestClient) -> None:
    h, pid = prepared(app)
    packet = packet_row(app, pid)
    assert packet.posting_text and "Python" in packet.posting_text
    archived = packet.posting_text
    assert app.get(f"/v1/apply/packets/{pid}", headers=h).json()["posting_text"] == archived
    async def change(remove: bool = False) -> None:
        async with sessionmaker()() as db:
            row = await db.get(JobListing, packet.listing_id)
            assert row
            if remove:
                await db.delete(row)
            else:
                row.description = "Updated posting now requires another skill."
            await db.commit()
    run(app, change)
    facts = app.get(review_path(pid), headers=h).json()["facts"]
    assert archived in facts[0]["text"] and facts[0]["label"] == "Posting captured with application"
    assert any(f["id"] == "current_job" and f["text"].startswith("Updated posting") for f in facts)
    run(app, lambda: change(True))
    facts = app.get(review_path(pid), headers=h).json()["facts"]
    assert archived in facts[0]["text"] and not any(f["id"] == "current_job" for f in facts)
    exported = app.get("/v1/auth/me/export", headers=h)
    assert exported.status_code == 200, exported.text
    assert archived in exported.text


def test_planner_rejects_superseded_consent(app: TestClient) -> None:
    h, _ = account(app)
    uid = user_id(app, h)
    async def change() -> None:
        async with sessionmaker()() as db:
            setup = await db.get(AutoApplySetup, uid)
            assert setup
            setup.consent_version = "expired"
            await db.commit()
    run(app, change)
    assert "consent" in plan(app, h)["blocked"]
