import io
import uuid
import zipfile

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.gmail.job_posts import recipients
from orbit_api.models import GmailConnection, JobApplication
from orbit_api.runtime_config import encrypt_secret
from tests.business_helpers import auth, db_call, register
from tests.test_jobs import make_resume

TEXT = ("Backend Engineer role at Example. Build Python services and APIs. "
        "Send your application to hiring@example.com with your resume.")


def test_recipient_extraction_keeps_source_quotes_and_does_not_guess() -> None:
    result = recipients(TEXT + " Other contact: privacy@example.com. hiring@example.com")
    assert [r["email"] for r in result] == ["hiring@example.com", "privacy@example.com"]
    assert "Send your application" in result[0]["quote"]
    assert recipients("Contact the recruiter on LinkedIn") == []


def test_import_and_tailored_docx_are_owned_and_reviewable(client: TestClient,
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "test-client")
    monkeypatch.setattr(s, "google_client_secret", SecretStr("test-secret"))
    monkeypatch.setattr(s, "gmail_redirect_uri", "http://localhost/v1/gmail/callback")
    monkeypatch.setattr(s, "config_secret", SecretStr("test-encryption-secret"))
    h = auth(register(client, f"post-{uuid.uuid4().hex}@example.com"))
    other = auth(register(client, f"post-other-{uuid.uuid4().hex}@example.com"))
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]
    async def connect(db: AsyncSession) -> None:
        db.add(GmailConnection(user_id=user_id, data={"email": "candidate@example.com",
                                                   "refresh": encrypt_secret("refresh")}))
    db_call(client, connect)
    resume_id = make_resume(client, h)
    imported = {"text": TEXT, "company": "Example", "title": "Backend Engineer", "confirmed": True,
                "recipient": "invented@example.com"}
    assert client.post("/v1/gmail/jobs/import", headers=h, json=imported).status_code == 422
    imported["recipient"] = "hiring@example.com"
    created = client.post("/v1/gmail/jobs/import", headers=h, json=imported)
    assert created.status_code == 201, created.text
    entry = created.json()["entry_id"]
    path = f"/v1/gmail/jobs/{entry}/tailor"
    assert client.post(path, headers=other, json={"resume_id": resume_id}).status_code == 404
    prepared = client.post(path, headers=h, json={"resume_id": resume_id})
    assert prepared.status_code == 201, prepared.text
    result = prepared.json()
    assert result["status"] == "ready" and result["attachment"] == "tailored-resume.docx"
    assert result["recipient"] == "hiring@example.com"
    version = client.get(f"/v1/jobs/tracker/{entry}/message-update", headers=h).json()["version"]
    assert client.post(f"/v1/gmail/jobs/{entry}/source", headers=h, json={"text": TEXT,
        "recipient": "hiring@example.com", "confirmed": True, "version": version}).status_code == 409
    assert "Backend Engineer" in result["subject"] and "Example" in result["body"]
    assert result["tailoring"]["resume_id"] == resume_id
    attachment = f"/v1/gmail/attempts/{result['id']}/attachment"
    assert client.get(attachment, headers=other).status_code == 404
    response = client.get(attachment, headers=h)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "word/document.xml" in archive.namelist()
    assert client.get(f"/v1/gmail/attempts/{entry}", headers=h).json()[0]["status"] == "ready"
    import httpx

    from orbit_api.gmail import routes

    original_client = httpx.AsyncClient
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"access_token": "token"} if request.url.host == "oauth2.googleapis.com"
                              else {"id": "gmail-accepted"})
    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda: original_client(transport=httpx.MockTransport(handle)))
    sent = client.post(f"/v1/gmail/attempts/{result['id']}/send", headers=h, json={"confirmed": True})
    assert sent.status_code == 200, sent.text
    prep = client.get(f"/v1/jobs/tracker/{entry}/interview", headers=h)
    assert prep.status_code == 200, prep.text
    assert prep.json()["version"]["kind"] == "snapshot"
    exported = client.get("/v1/auth/me/export", headers=h).json()
    snapshots = exported["job_search"]["sent_resume_versions"]
    saved = next(s for s in snapshots if s["application_id"] == entry)
    assert saved["origin"]["kind"] == "gmail"
    assert saved["origin"]["gmail_message_id"] == "gmail-accepted"
    assert saved["data"] == result["tailoring"]["resume_data"]
    async def unlink_current(db: AsyncSession) -> None:
        job = await db.get(JobApplication, entry)
        assert job is not None
        job.resume_id = None
    db_call(client, unlink_current)
    performance = client.get("/v1/jobs/resume-performance", headers=h).json()
    assert performance["tailored"]["applied"] == 1
    assert performance["general"]["applied"] == 0


def test_email_job_discovery_preserves_saved_profile_eligibility(client: TestClient) -> None:
    from tests.test_jobs import _listing, insert

    h = auth(register(client, f"discover-{uuid.uuid4().hex}@example.com"))
    allowed = _listing(company="Allowed Email", description=TEXT)
    excluded = _listing(company="Excluded Email", title="Backend Engineer gambling", description=TEXT)
    abroad = _listing(company="Abroad Email", country="US", cities=["New York"], description=TEXT)
    insert(client, allowed, excluded, abroad)
    saved = client.put("/v1/jobs/profile", headers=h, json={"prefs": {
        "titles": ["Backend Engineer"], "skills": ["Go", "Python", "Kubernetes", "Kafka", "Java"],
        "locations": ["Bengaluru"], "workplace": ["onsite"], "exclude": ["gambling"]}})
    assert saved.status_code == 200, saved.text
    response = client.get("/v1/gmail/jobs/discover", headers=h)
    assert response.status_code == 200, response.text
    ids = {row["id"] for row in response.json()["jobs"]}
    assert allowed.id in ids and excluded.id not in ids and abroad.id not in ids


def test_existing_opportunity_accepts_reviewed_source_with_version_guard(client: TestClient) -> None:
    h = auth(register(client, f"attach-{uuid.uuid4().hex}@example.com"))
    other = auth(register(client, f"attach-other-{uuid.uuid4().hex}@example.com"))
    entry = client.post("/v1/jobs/tracker/manual", headers=h,
                        json={"title": "Engineer", "company": "Example"}).json()["id"]
    version = client.get(f"/v1/jobs/tracker/{entry}/message-update", headers=h).json()["version"]
    payload = {"text": TEXT, "recipient": "hiring@example.com", "confirmed": True, "version": version}
    path = f"/v1/gmail/jobs/{entry}/source"
    assert client.post(path, headers=other, json=payload).status_code == 404
    result = client.post(path, headers=h, json=payload)
    assert result.status_code == 200, result.text
    assert client.post(path, headers=h, json=payload).status_code == 409
    rows = client.get("/v1/jobs/tracker", headers=h).json()
    assert len(rows) == 1 and rows[0]["document_id"]
