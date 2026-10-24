from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.job_portal.resume_lineage import packet_materials
from orbit_api.models import ResumeSnapshot
from tests.business_helpers import db_call
from tests.test_career_workflows import tracked
from tests.test_career_workspace import account


def test_captured_materials_are_owned_and_hash_checked(client: TestClient) -> None:
    h, other = account(client), account(client)
    entry = tracked(client, h)
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]

    async def insert(db: AsyncSession) -> str:
        saved = ResumeSnapshot(user_id=user_id, application_id=entry, title="Captured", data={}, design={},
            origin={"kind": "packet", "source_id": "packet", "content_digest": "resume-hash",
                    "recorded_at": "2026-10-24T00:00:00Z", "observation": "candidate_recorded",
                    "packet_materials": packet_materials([], {"city": "Delhi"}, "Letter")})
        db.add(saved)
        await db.flush()
        return saved.id
    sid = db_call(client, insert)
    path = f"/v1/career/submission-materials/{sid}"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=other).status_code == 404
    result = client.get(path, headers=h).json()
    assert result["integrity_matches"] is True
    assert result["content"]["cover_letter"] == "Letter"

    async def alter(db: AsyncSession) -> None:
        saved = await db.get(ResumeSnapshot, sid)
        assert saved is not None
        origin = dict(saved.origin or {})
        origin["packet_materials"] = {**origin["packet_materials"], "cover_letter": "Changed"}
        saved.origin = origin
    db_call(client, alter)
    assert client.get(path, headers=h).json()["integrity_matches"] is False
