"""The browser extension's API (extension/routes.py): a token scoped to the extension, made from a full sign-in, that
can clip a job, check a page's keyword coverage and read the autofill basics, and nothing else; signed out from
Devices like any other sign-in."""

import uuid
from typing import Any

from fastapi.testclient import TestClient

PW = "correct horse battery"
JOB = ("Backend Engineer at Acme. We need Python, PostgreSQL, Kubernetes and Kafka experience. You will design REST "
       "APIs, run services on AWS, and mentor juniors. Nice to have: Terraform and GraphQL.")


def _account(client: TestClient) -> dict[str, str]:
    r = client.post("/v1/auth/register", json={"email": f"x-{uuid.uuid4().hex[:8]}@example.com", "password": PW,
                                               "name": "Asha Rao"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _connect(client: TestClient, h: dict[str, str]) -> dict[str, str]:
    r = client.post("/v1/extension/connect", headers=h)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _resume(client: TestClient, h: dict[str, str]) -> None:
    data: dict[str, Any] = {
        "basics": {"name": "Asha Rao", "email": "asha@example.com", "phone": "+91 98765 43210",
                   "location": "Bengaluru", "headline": "Backend engineer",
                   "links": [{"label": "LinkedIn", "url": "https://linkedin.com/in/asha"},
                             {"label": "GitHub", "url": "https://github.com/asha"},
                             {"label": "Site", "url": "https://asha.dev"}]},
        "experience": [{"title": "Engineer", "company": "Foo",
                        "bullets": ["Built Python services on PostgreSQL and AWS"]}],
        "skills": [{"name": "Skills", "items": ["Python", "PostgreSQL", "AWS", "REST APIs"]}],
    }
    r = client.post("/v1/resumes", headers=h, json={"title": "Main resume", "data": data})
    assert r.status_code in (200, 201), r.text


def test_the_extension_token_does_only_its_job(client: TestClient) -> None:
    h = _account(client)
    ext = _connect(client, h)
    assert client.get("/v1/extension/me", headers=ext).json()["name"] == "Asha Rao"
    # Clip a job: the one write it has.
    clip = client.post("/v1/jobs/tracker/manual", headers=ext, json={
        "company": "Acme", "title": "Backend Engineer", "url": "https://boards.greenhouse.io/acme/jobs/123"})
    assert clip.status_code == 201, clip.text
    assert any(e["title"] == "Backend Engineer" for e in client.get("/v1/jobs/tracker", headers=h).json())
    # Everything else in the account is out of reach.
    for method, path in (("GET", "/v1/auth/me"), ("GET", "/v1/jobs/tracker"), ("GET", "/v1/resumes"),
                         ("GET", "/v1/sessions"), ("GET", "/v1/auth/me/export"), ("GET", "/v1/auth/sessions"),
                         ("POST", "/v1/extension/connect"), ("DELETE", "/v1/auth/me")):
        r = client.request(method, path, headers=ext, json={"password": PW} if method == "DELETE" else None)
        assert r.status_code == 403, (method, path, r.status_code)


def test_it_is_a_device_that_can_be_signed_out(client: TestClient) -> None:
    h = _account(client)
    ext = _connect(client, h)
    devices = client.get("/v1/auth/sessions", headers=h).json()
    mine = [d for d in devices if d["kind"] == "extension"]
    assert len(mine) == 1 and mine[0]["label"] == "Browser extension"
    assert client.delete(f"/v1/auth/sessions/{mine[0]['id']}", headers=h).status_code == 204
    assert client.get("/v1/extension/me", headers=ext).status_code == 401


def test_autofill_basics_and_keyword_fit(client: TestClient) -> None:
    h = _account(client)
    ext = _connect(client, h)
    assert client.post("/v1/extension/fit", headers=ext, json={"job_text": JOB}).status_code == 422  # no resume yet
    _resume(client, h)
    p = client.get("/v1/extension/profile", headers=ext).json()
    assert (p["first_name"], p["last_name"], p["email"]) == ("Asha", "Rao", "asha@example.com")
    assert p["linkedin"] == "https://linkedin.com/in/asha" and p["github"] == "https://github.com/asha"
    assert p["website"] == "https://asha.dev" and p["phone"] == "+91 98765 43210"
    f = client.post("/v1/extension/fit", headers=ext, json={"job_text": JOB}).json()
    assert "Python" in f["matched"] and any(k.lower() == "kubernetes" for k in f["missing"])
    assert 0 < f["coverage_pct"] < 100
    assert client.post("/v1/extension/fit", headers=ext, json={"job_text": "short"}).status_code == 422


def test_signed_out_gets_nothing(client: TestClient) -> None:
    client.cookies.clear()
    for path in ("/v1/extension/me", "/v1/extension/profile"):
        assert client.get(path).status_code == 401
    assert client.post("/v1/extension/connect").status_code in (401, 403)
