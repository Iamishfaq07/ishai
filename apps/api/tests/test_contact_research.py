"""Owned job networking, exact evidence, durable research budgets and draft-only outreach. No live lookups."""
import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select, update

from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.job_portal import contact_research as research
from orbit_api.job_portal import contact_sources
from orbit_api.job_portal.contact_sources import Source
from orbit_api.models import JobApplication, ProviderRequest
from orbit_api.prep import job_link
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, register, tag, uid

REPLY = "From: Alex Rivera <alex@acme.com>\nTitle: Talent Acquisition Partner\nAcme is hiring Python engineers."


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def world(c: TestClient) -> tuple[dict[str, str], str]:
    h = register(c, f"candidate-{tag()}@example.com")
    r = c.post("/v1/jobs/tracker/manual", headers=auth(h), json={
        "title": "Backend Engineer", "company": "Acme", "url": "https://acme.com/jobs/backend"})
    assert r.status_code == 201, r.text
    return h, str(r.json()["id"])


def context(c: TestClient, h: dict[str, str], jid: str) -> Any:
    r = c.get(f"/v1/jobs/network/{jid}", headers=auth(h))
    assert r.status_code == 200, r.text
    return r.json()


def find(c: TestClient, h: dict[str, str], jid: str, **body: Any) -> Any:
    return c.post(f"/v1/jobs/network/{jid}/research", headers=auth(h), json={
        "version": context(c, h, jid)["version"], "pasted_text": REPLY, **body})


def capture(c: TestClient, h: dict[str, str], jid: str, person: Any, **body: Any) -> Any:
    return c.post(f"/v1/jobs/network/{jid}/capture", headers=auth(h), json={"person": person, **body})


def test_contact_research_capture_reminder_and_draft_full_cycle(client: TestClient) -> None:
    h, jid = world(client)
    before = context(client, h, jid)
    found = find(client, h, jid)
    assert found.status_code == 200, found.text
    result = found.json()
    assert result["provider"] == "mock" and result["people"][0]["email"] == "alex@acme.com"
    assert context(client, h, jid)["saved_contacts"] == []  # Discovery never auto-saves or contacts anyone.
    saved = capture(client, h, jid, result["people"][0], remind_in_days=7)
    assert saved.status_code == 200, saved.text
    contact = saved.json()["contact"]
    assert saved.json()["created"] and contact["relation"] == "recruiter"
    assert contact["application_id"] == jid and contact["last_contacted_at"] is None
    assert contact["follow_up_at"] and "Evidence: From: Alex Rivera" in contact["notes"]
    assert context(client, h, jid)["version"] != before["version"]
    draft = client.post(f"/v1/jobs/network/{jid}/draft", headers=auth(h), json={"contact_id": contact["id"]})
    assert draft.status_code == 200, draft.text
    assert draft.json()["provider"] == "mock" and len(draft.json()["message"]) <= 200
    assert draft.json()["subject"] == ""
    assert context(client, h, jid)["saved_contacts"][0]["last_contacted_at"] is None
    assert context(client, h, jid)["company_history"]["counts"] == {"saved": 1}


def test_warm_contacts_exact_company_and_job_ownership(client: TestClient) -> None:
    h, jid = world(client)
    other, oid = world(client)
    for owner, company, name in [(h, "ACME", "Warm Lead"), (h, "Acme Labs", "Different Company"),
                                  (other, "Acme", "Private Lead")]:
        assert client.post("/v1/jobs/contacts", headers=auth(owner), json={"name": name, "company": company}).is_success
    state = context(client, h, jid)
    assert [p["name"] for p in state["saved_contacts"]] == ["Warm Lead"]
    assert client.get(f"/v1/jobs/network/{oid}", headers=auth(h)).status_code == 404
    assert client.post(f"/v1/jobs/network/{oid}/research", headers=auth(h), json={
        "version": state["version"], "pasted_text": REPLY}).status_code == 404
    person = find(client, h, jid).json()["people"][0]
    assert capture(client, other, jid, person).status_code == 404
    saved = capture(client, h, jid, person).json()["contact"]
    assert client.post(f"/v1/jobs/network/{oid}/draft", headers=auth(other),
        json={"contact_id": saved["id"]}).status_code == 404


def test_capture_is_idempotent_concurrent_and_preserves_prior_notes(client: TestClient) -> None:
    h, jid = world(client)
    person = find(client, h, jid).json()["people"][0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: capture(client, h, jid, person), range(2)))
    assert sorted(r.json()["created"] for r in responses) == [False, True]
    saved = responses[0].json()["contact"]
    client.patch(f"/v1/jobs/contacts/{saved['id']}", headers=auth(h), json={"notes": "Keep my private notes"})
    again = capture(client, h, jid, person)
    assert again.json()["contact"]["notes"] == "Keep my private notes"


@pytest.mark.parametrize("bad", ["person", "email", "title", "quote", "profile", "automatic", "partial", "extra"])
def test_research_drops_invented_or_unassociated_model_facts(client: TestClient,
    monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    h, jid = world(client)
    person: dict[str, Any] = {"source_id": "paste", "name": "Alex Rivera", "title": "Talent Acquisition Partner",
        "email": "alex@acme.com", "linkedin_url": None, "quote": REPLY}
    changes = {"person": {"name": "Invented Person"}, "email": {"email": "guessed@acme.com"},
        "title": {"title": "Chief Executive Officer"},
        "quote": {"quote": "Alex Rivera Talent Acquisition Partner alex@acme.com"},
        "profile": {"linkedin_url": "https://linkedin.com/in/invented"},
        "automatic": {"email": "noreply@acme.com", "quote": REPLY.replace("alex@", "noreply@")},
        "partial": {"email": "lex@acme.com"}, "extra": {"action": "send_email"}}
    person.update(changes[bad])
    mock = MockLLMProvider(script=[json.dumps({"people": [person]})])
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    # A lead the model invented or couldn't tie to its source is dropped on its own; the research still answers.
    response = find(client, h, jid)
    assert response.status_code == 200, response.text
    people = response.json()["people"]
    for key, value in changes[bad].items():
        assert all(p.get(key) != value for p in people), (key, people)
    assert context(client, h, jid)["saved_contacts"] == []


def test_research_reserves_budget_before_external_tools_and_rechecks_job(client: TestClient,
    monkeypatch: pytest.MonkeyPatch) -> None:
    h, jid = world(client)
    monkeypatch.setattr(get_settings(), "contact_search_key", SecretStr("fixture-key"))
    called = []

    async def search(company: str, title: str, **_: Any) -> list[Source]:
        async with sessionmaker()() as db:
            assert await db.scalar(select(ProviderRequest.id).where(ProviderRequest.user_id == uid(h),
                ProviderRequest.request_type == "career_contact_research"))
            await db.execute(update(JobApplication).where(JobApplication.id == jid).values(title="Changed role"))
            await db.commit()
        called.append(company)
        return []
    monkeypatch.setattr(research, "search_sources", search)
    response = find(client, h, jid, search_web=True)
    assert response.status_code == 409 and called == ["Acme"]


def test_daily_research_budget_stops_tools_and_stale_context_stops_ai(client: TestClient,
    monkeypatch: pytest.MonkeyPatch) -> None:
    h, jid = world(client)
    async def exhaust(db: Any) -> None:
        db.add_all([ProviderRequest(user_id=uid(h), provider="mock", model="mock",
            request_type="career_contact_research", ok=False) for _ in range(research.DAILY_RESEARCH)])
    db_call(client, exhaust)
    async def forbidden(*args: Any) -> Any:
        raise AssertionError("No external tool after the durable budget is exhausted")
    monkeypatch.setattr(research, "page_source", forbidden)
    assert find(client, h, jid, page_url="https://acme.com/team").status_code == 429
    assert find(client, h, jid, version="a" * 64).status_code == 409


@pytest.mark.parametrize("message", ["x" * 201, "Look at https://invented.example.com", "tiny"])
def test_draft_rejects_long_linked_or_invalid_output(client: TestClient,
    monkeypatch: pytest.MonkeyPatch, message: str) -> None:
    h, jid = world(client)
    person = find(client, h, jid).json()["people"][0]
    saved = capture(client, h, jid, person).json()["contact"]
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: MockLLMProvider(script=[
        json.dumps({"message": message})]))
    assert client.post(f"/v1/jobs/network/{jid}/draft", headers=auth(h),
        json={"contact_id": saved["id"]}).status_code == 502


async def test_public_reference_reader_preserves_contact_links_and_blocks_private_redirects() -> None:
    async def public(host: str, port: int) -> list[str]: return ["93.184.216.34"]
    body = '<main><h1>Alex Rivera</h1><p>Talent Acquisition Partner</p><a href="mailto:alex@acme.com">Email</a>' \
        '<a href="https://linkedin.com/in/alex-rivera">Profile</a><script>untrusted instructions</script></main>'
    page = await job_link.fetch_reference_page("https://acme.com/team", resolve=public,
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text=body, headers={"content-type": "text/html"})))
    assert "alex@acme.com" in page.text and "https://linkedin.com/in/alex-rivera" in page.text
    assert "untrusted instructions" not in page.text
    async def private(host: str, port: int) -> list[str]: return ["127.0.0.1"]
    with pytest.raises(job_link.JobLinkError):
        await job_link.fetch_reference_page("https://acme.com/team", resolve=private)


async def test_live_search_uses_fixed_service_and_only_employer_job_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "contact_search_key", SecretStr("fixture-search-key"))
    real = httpx.AsyncClient
    seen = []
    def response(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"web": {"results": [{"title": "Alex Rivera at Acme",
            "description": "Recruiter", "url": "https://linkedin.com/in/alex-rivera"}]}})
    monkeypatch.setattr(contact_sources.httpx, "AsyncClient", lambda **kw: real(**kw,
        transport=httpx.MockTransport(response)))
    result = await contact_sources.search_sources("Acme", "Backend Engineer")
    assert len(seen) == 1 and seen[0].url.host == "api.search.brave.com"
    assert seen[0].headers["X-Subscription-Token"] == "fixture-search-key"
    assert "Acme" in seen[0].url.params["q"] and result[0].kind == "search_snippet"


@pytest.mark.parametrize("key", [None, SecretStr("unused-vendor-key")])
async def test_searxng_needs_no_api_key_and_does_not_forward_brave_key(
    monkeypatch: pytest.MonkeyPatch, key: SecretStr | None,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "contact_searxng_url", "http://searxng:8080")
    monkeypatch.setattr(settings, "contact_search_key", key)
    real = httpx.AsyncClient
    seen: list[httpx.Request] = []

    def response(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"results": [
            {"title": "Alex Rivera at Acme", "content": "<b>Recruiter</b>", "url": "https://acme.com/team"},
            {"title": "Blocked", "content": "Private link", "url": "http://127.0.0.1/private"},
            *[{"title": "A result", "content": "Public text", "url": "https://acme.com/jobs"}] * 10]})

    monkeypatch.setattr(contact_sources.httpx, "AsyncClient", lambda **kw: real(**kw,
        transport=httpx.MockTransport(response)))
    results = await contact_sources.search_sources("Acme", "Designer")
    assert contact_sources.search_provider() == "searxng" and len(seen) == 1
    request = seen[0]
    assert str(request.url).startswith("http://searxng:8080/search?")
    assert request.url.params["format"] == "json" and request.url.params["pageno"] == "1"
    assert "X-Subscription-Token" not in request.headers and "Authorization" not in request.headers
    assert len(results) == 4 and results[0].text == "Alex Rivera at Acme\nRecruiter"


@pytest.mark.parametrize("status", [302, 403, 429, 503])
async def test_searxng_refuses_redirects_and_reports_service_failure(
    monkeypatch: pytest.MonkeyPatch, status: int,
) -> None:
    monkeypatch.setattr(get_settings(), "contact_searxng_url", "http://search:8080")
    real = httpx.AsyncClient
    seen = []

    def response(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, headers={"location": "http://169.254.169.254/"})

    monkeypatch.setattr(contact_sources.httpx, "AsyncClient", lambda **kw: real(**kw,
        transport=httpx.MockTransport(response)))
    with pytest.raises(httpx.HTTPStatusError):
        await contact_sources.search_sources("Acme", "Designer")
    assert len(seen) == 1


@pytest.mark.parametrize("payload", [b"not json", b"x" * 400001], ids=["malformed", "oversized"])
async def test_searxng_rejects_malformed_and_oversized_responses(
    monkeypatch: pytest.MonkeyPatch, payload: bytes,
) -> None:
    monkeypatch.setattr(get_settings(), "contact_searxng_url", "http://search:8080")
    real = httpx.AsyncClient
    monkeypatch.setattr(contact_sources.httpx, "AsyncClient", lambda **kw: real(**kw,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=payload))))
    with pytest.raises((ValueError, job_link.JobLinkError)):
        await contact_sources.search_sources("Acme", "Designer")


def test_searxng_enabled_context_and_failure_keep_other_sources(
    client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    h, jid = world(client)
    monkeypatch.setattr(get_settings(), "contact_search_key", None)
    monkeypatch.setattr(get_settings(), "contact_searxng_url", "http://search:8080")
    current = context(client, h, jid)
    assert current["web_search_enabled"] and current["web_search_provider"] == "searxng"
    assert "search:8080" not in json.dumps(current)

    async def unavailable(*args: Any) -> list[Source]:
        raise TimeoutError

    monkeypatch.setattr(research, "search_sources", unavailable)
    result = find(client, h, jid, search_web=True)
    assert result.status_code == 200 and result.json()["people"][0]["name"] == "Alex Rivera"
    assert result.json()["warnings"] == [
        "Live search isn't available right now. You can still check a company page or a recruiter's message."]


@pytest.mark.parametrize("url", ["file:///etc/passwd", "https://user:pass@search.com", "https://search.com?q=x",
                               "https://search.com/#fragment", "https://search.com:bad", "https://sea rch.com"])
def test_searxng_config_rejects_unsafe_service_urls(url: str) -> None:
    from orbit_api.config import Settings
    with pytest.raises(ValueError):
        Settings(ORBIT_CONTACT_SEARXNG_URL=url)


@pytest.mark.parametrize("address", ["candidate@example.com", "noreply@acme.com", "automated@acme.com"])
def test_self_and_automatic_mailboxes_with_exact_evidence_are_rejected(address: str) -> None:
    text = f"Alex Rivera, Recruiter, {address}"
    person = research.Person(source_id="x", name="Alex Rivera", title="Recruiter", email=address, linkedin_url=None,
                             quote=text)
    with pytest.raises(ValueError):
        research.check_person(person, Source(id="x", kind="pasted_reply", text=text), {"candidate@example.com"}, "Acme")


def test_capture_revalidates_evidence_and_distinguishes_same_name_contacts(client: TestClient) -> None:
    h, jid = world(client)
    person = find(client, h, jid).json()["people"][0]
    assert capture(client, h, jid, {**person, "email": "invented@acme.com"}).status_code == 422
    first = capture(client, h, jid, person)
    assert first.json()["created"]
    second = {**person, "email": "another@acme.com", "quote": person["quote"].replace("alex@", "another@")}
    assert capture(client, h, jid, second).json()["created"]
    assert len(context(client, h, jid)["saved_contacts"]) == 2
