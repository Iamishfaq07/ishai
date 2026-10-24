"""Posting observations and the semantic experiment preserve source and eligibility boundaries."""
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.job_portal import semantic_preview
from orbit_api.job_portal.refresh import _store_chunk
from orbit_api.models import JobListing, JobPostingVersion
from tests.business_helpers import db_call
from tests.test_career_workspace import account
from tests.test_jobs import _listing, insert


def test_observed_post_changes_are_bounded_private_and_survive_eviction(client: TestClient) -> None:
    h, other = account(client), account(client)
    listing = _listing()
    insert(client, listing)
    entry = client.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing.id}).json()["id"]
    now = datetime.now(UTC)

    async def refresh(db: AsyncSession) -> None:
        for i in range(23):
            await _store_chunk([{"id": listing.id, "salary": f"{i} salary", "partial": False, "keywords": None}],
                               now + timedelta(minutes=i))
        versions = list(await db.scalars(select(JobPostingVersion).where(JobPostingVersion.listing_id == listing.id)))
        assert len(versions) == 20
        await db.execute(delete(JobListing).where(JobListing.id == listing.id))
    db_call(client, refresh)
    path = f"/v1/jobs/tracker/{entry}/posting-history"
    response = client.get(path, headers=h)
    assert response.status_code == 200, response.text
    versions = response.json()["versions"]
    assert len(versions) == 20
    assert versions[0]["changes"] == [{"field": "salary", "before": "21 salary", "after": "22 salary"}]
    assert versions[-1]["baseline"] is True
    assert client.get(path, headers=other).status_code == 404


class FakeNeural:
    ready = True
    model_id = "test-neural"
    dim = 2
    relevance_floor = 0.4

    def embed_query(self, text: str) -> list[float]:
        return [1.0, 0.0]

    def embed(self, text: str) -> list[float]:
        return [1.0, 0.0] if "reliability" in text else [0.0, 1.0]


def test_semantic_experiment_keeps_country_and_exclusions(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = account(client)
    available = _listing(company="Allowed", description="Backend reliability and Go services")
    excluded = _listing(company="Excluded", title="Backend Engineer gambling")
    abroad = _listing(company="Abroad", country="US", cities=["New York"], locations=["New York, US"])
    insert(client, available, excluded, abroad)
    profile = client.put("/v1/jobs/profile", headers=h, json={"prefs": {
        "titles": ["Backend Engineer"], "skills": ["Go", "Python", "Kubernetes", "Kafka", "Java"],
        "locations": ["Bengaluru"], "workplace": ["onsite"], "exclude": ["gambling"]}})
    assert profile.status_code == 200, profile.text
    assert client.get("/v1/jobs/semantic-preview", headers=h).json()["available"] is False
    unavailable = client.post("/v1/jobs/semantic-preview", headers=h,
                              json={"goal": "Improve backend reliability"})
    assert unavailable.status_code == 503
    monkeypatch.setattr(semantic_preview, "get_embedder", lambda: FakeNeural())
    result = client.post("/v1/jobs/semantic-preview", headers=h, json={"goal": "Improve backend reliability"})
    assert result.status_code == 200, result.text
    ids = {r["id"] for r in result.json()["results"]}
    assert available.id in ids
    assert excluded.id not in ids and abroad.id not in ids
    assert result.json()["model"] == "test-neural"
