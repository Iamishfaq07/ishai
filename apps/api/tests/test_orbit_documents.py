"""Documents Orbit saves itself (documents.origin "orbit", documents/routes.py): the job post a Prepare saves, the job
post and resume a full prep or a resume drill reads, a practice round's resume and job post, a video interview's job
post, an interview's job post and version sent. They don't count against the plan's documents, so practice keeps
working on the Free plan's three; they're capped at MAX_ORBIT_DOCUMENTS on their own, past which Orbit says what to
delete (nothing is deleted for it). The user's own uploads and pastes count exactly as before."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.documents.routes import MAX_ORBIT_DOCUMENTS
from orbit_api.job_portal import routes as job_routes
from tests.test_api import _register
from tests.test_interview_day import POST, _job, _sent
from tests.test_jobs import _listing, insert, make_resume

TEXT = "A practice round's job post: build payment services in Go, with Kafka and Redis. " * 3


@pytest.fixture(autouse=True)
def offline_post(monkeypatch: pytest.MonkeyPatch) -> None:
    async def read(db: Any, listing: Any) -> tuple[str, None]:
        return listing.description or listing.snippet, None
    monkeypatch.setattr(job_routes, "_full_text", read)
    monkeypatch.setattr("orbit_api.career.routes._full_text", read)


def _free(client: TestClient) -> dict[str, str]:
    _register(client)  # with no ORBIT_ADMIN_EMAIL the first account stands in as admin (no limits): not this one
    return _register(client)


def _upload(client: TestClient, h: dict[str, str], name: str) -> Any:
    note = f"My own notes for {name}, typed up for the round."
    return client.post("/v1/documents", headers=h, data={"kind": "notes"},
                       files={"file": (f"{name}.txt", note, "text/plain")})


def _orbit(client: TestClient, h: dict[str, str], title: str) -> Any:
    return client.post("/v1/documents/text", headers=h, json={"title": title, "kind": "job_description",
                                                             "text": f"{title}. {TEXT}", "origin": "orbit"})


def test_three_uploads_still_stop_at_three_and_practice_keeps_working(client: TestClient) -> None:
    h = _free(client)
    for name in ("a", "b"):
        assert _upload(client, h, name).status_code == 201
    pasted = client.post("/v1/documents/text", headers=h, json={"title": "Pasted", "kind": "notes", "text": TEXT})
    assert pasted.status_code == 201 and pasted.json()["origin"] == "user"
    # The user's own: a fourth upload or paste is refused, as before.
    assert _upload(client, h, "c").status_code == 402
    assert client.post("/v1/documents/text", headers=h, json={"title": "More", "kind": "notes",
                                                             "text": TEXT}).status_code == 402

    # Prepare on a job (its post saved for Practice).
    listing = _listing(company="Razorpay", title="Backend Engineer", description=POST, keywords=["Go", "Kafka"])
    insert(client, listing)
    r = client.post(f"/v1/jobs/listings/{listing.id}/prepare", headers=h)
    assert r.status_code == 200, r.text
    # Full prep on another job (the tailored copy's post and resume), and a resume drill ("Grill my resume").
    rid = make_resume(client, h)
    other = _listing(company="Initech", title="Platform Engineer", description=POST.replace("Razorpay", "Initech"))
    insert(client, other)
    r = client.post(f"/v1/jobs/listings/{other.id}/full-prep", headers=h, json={"resume_id": rid})
    assert r.status_code == 200, r.text
    r = client.post(f"/v1/resumes/{rid}/grill", headers=h, json={})
    assert r.status_code == 200 and r.json()["type"] == "mock", r.text
    # A practice round's resume and job post ("Practise N out loud"), and a video interview's job post.
    assert _orbit(client, h, "Job post for My CV").status_code == 201
    assert _orbit(client, h, "Job post: Backend Engineer at Acme").status_code == 201
    # An interview's job post and version sent.
    eid, _ = _job(client, h, company="Hooli")
    _sent(client, h, eid)
    ctx = client.post(f"/v1/jobs/tracker/{eid}/session-context", headers=h).json()
    assert ctx["resume_included"] and len(ctx["document_ids"]) == 2 and ctx["notes"] == []

    docs = client.get("/v1/documents", headers=h).json()
    mine = [d for d in docs if d["origin"] == "user"]
    assert len(mine) == 3 and len(docs) > 3
    assert client.get("/v1/entitlements", headers=h).json()["usage"]["documents"] == 3


def test_past_ten_orbit_says_what_to_delete_and_deletes_nothing(client: TestClient) -> None:
    h = _free(client)
    for i in range(MAX_ORBIT_DOCUMENTS):
        assert _orbit(client, h, f"Practice post {i}").status_code == 201
    r = _orbit(client, h, "One more")
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert f"saved {MAX_ORBIT_DOCUMENTS} documents" in detail and "Delete the ones you don't need" in detail
    docs = client.get("/v1/documents", headers=h).json()
    assert len(docs) == MAX_ORBIT_DOCUMENTS  # nothing was cleaned up to make room
    # Prepare says the same, and the user's own documents aren't affected by Orbit's cap.
    listing = _listing(company="Razorpay", title="Backend Engineer", description=POST)
    insert(client, listing)
    r = client.post(f"/v1/jobs/listings/{listing.id}/prepare", headers=h)
    assert r.status_code == 402 and "saved by Orbit" in r.json()["detail"]
    assert _upload(client, h, "mine").status_code == 201
    # Deleting one of Orbit's makes room again.
    gone = next(d for d in docs if d["origin"] == "orbit")
    assert client.delete(f"/v1/documents/{gone['id']}", headers=h).status_code == 204
    assert _orbit(client, h, "One more").status_code == 201
