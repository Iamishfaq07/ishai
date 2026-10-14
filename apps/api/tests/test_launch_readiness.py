import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from orbit_api import ratelimit
from orbit_api.config import Settings
from tests.test_api import _register
from tests.test_backend_hardening import _prod


def test_a_weak_proxy_secret_is_ignored_in_production_and_defaulted_elsewhere() -> None:
    # Production never trusts a missing, short, repetitive or development secret; it starts anyway (no proxy is
    # trusted, main.py warns), since refusing to start took production down twice.
    for secret in (None, "", "x" * 40, "orbit-local-proxy-secret-for-development-only"):
        assert Settings(_env_file=None, **_prod(ORBIT_PROXY_SECRET=secret)).proxy_secret is None
    assert Settings(_env_file=None, ORBIT_ENV="test", ORBIT_PROXY_SECRET="").proxy_secret is not None
    assert Settings(_env_file=None, ORBIT_ENV="development", ORBIT_PROXY_SECRET=None).proxy_secret is not None


def test_proxy_authentication_uses_constant_time_comparison(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[bytes, bytes]] = []
    original = ratelimit.hmac.compare_digest

    def compare(a: bytes, b: bytes) -> bool:
        calls.append((a, b))
        return original(a, b)

    monkeypatch.setattr(ratelimit.hmac, "compare_digest", compare)
    request = Request({"type": "http", "client": ("198.51.100.1", 42), "headers": [
        (b"x-orbit-proxy-secret", b"wrong"), (b"x-orbit-client-ip", b"203.0.113.10")]})
    assert ratelimit.client_ip(request) == "198.51.100.1"
    assert len(calls) == 1


def test_cancelled_save_cannot_overwrite_newer_client_revision(client: TestClient) -> None:
    h = _register(client)
    rid = client.post("/v1/resumes", headers=h, json={"title": "Initial"}).json()["id"]
    body = {"base_revision": 0, "client_id": "writer-one-abcdefghijkl"}
    path = f"/v1/resumes/{rid}"
    assert client.put(path, headers=h, json={**body, "title": "New", "client_revision": 2}).status_code == 200
    assert client.put(path, headers=h, json={**body, "title": "Old", "client_revision": 1}).status_code == 409
    # The browser lost the response to revision 2; its newer edit can follow its own commit without conflict.
    assert client.put(path, headers=h, json={**body, "title": "Newest", "client_revision": 3}).status_code == 200
    other = {**body, "client_id": "writer-two-abcdefghijkl", "client_revision": 4, "title": "Other tab"}
    assert client.put(path, headers=h, json=other).status_code == 409
    assert client.get(path, headers=h).json()["title"] == "Newest"


def test_session_preserves_all_prep_context(client: TestClient) -> None:
    h = _register(client)
    context = {"role": "Platform engineer", "company": "Acme", "interview_stage": "Technical panel",
               "tech_stack": ["Python", "Postgres"], "key_requirements": ["Scale the API"]}
    r = client.post("/v1/sessions", headers=h, json={"title": "Preparation", "type": "mock", **context})
    assert r.status_code == 201, r.text
    reread = client.get(f"/v1/sessions/{r.json()['id']}", headers=h).json()["session"]
    assert all(reread[k] == v for k, v in context.items())


def test_launch_access_is_durable_idempotent_and_does_not_grant_unapproved_credits(client: TestClient) -> None:
    h = _register(client)
    before = client.get("/v1/entitlements", headers=h)

    async def burst() -> list[httpx.Response]:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://testserver") as c:
            return await asyncio.gather(*[c.post("/v1/billing/launch-access", headers=h,
                                               json={"pack": "starter", "country": "US"}) for _ in range(4)])

    replies = client.portal.call(burst)  # type: ignore[union-attr]
    assert all(r.status_code == 200 for r in replies), [r.text for r in replies]
    assert len({r.json()["reference"] for r in replies}) == 1
    assert all(r.json()["status"] == "requested" for r in replies)
    assert client.get("/v1/entitlements", headers=h).json() == before.json()
    assert client.post("/v1/billing/launch-access", headers=h,
                       json={"pack": "starter", "country": "IN"}).status_code == 422
