"""Job-posting import from a link: SSRF guards, redirects, extraction, and the endpoint."""

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from orbit_api.prep import job_link
from orbit_api.prep.job_link import JobLinkError, extract_posting, fetch_job_posting
from tests.test_api import _register

DESCRIPTION = (
    "<p>We're hiring a <b>Senior Security Engineer</b> to lead threat modelling across our payments platform.</p>"
    "<ul><li>Run the vulnerability management programme end to end</li>"
    "<li>Partner with platform teams on secure defaults and paved roads</li>"
    "<li>Mentor two engineers and raise the security bar in code review</li></ul>"
    "<p>You have 5+ years in application security and have shipped detection tooling.</p>"
)
LD_PAGE = f"""<html><head><title>Careers | Acme</title>
<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@graph": [
    {"@type": "Organization", "name": "Acme"},
    {"@type": "JobPosting", "title": "Senior Security Engineer", "description": DESCRIPTION,
     "hiringOrganization": {"@type": "Organization", "name": "Acme Payments"}}]})}</script>
</head><body><nav>Jobs Home About</nav><p>Apply now</p></body></html>"""


def public(ip: str = "93.184.216.34") -> job_link.Resolver:
    async def resolve(host: str, port: int) -> list[str]:
        return [ip]
    return resolve


def transport(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def html(body: str, status: int = 200, **headers: str) -> httpx.Response:
    return httpx.Response(status, text=body, headers={"content-type": "text/html; charset=utf-8", **headers})


async def test_json_ld_job_posting_is_preferred_and_the_request_is_pinned() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return html(LD_PAGE)

    posting = await fetch_job_posting("https://jobs.acme.example/roles/42?src=x", resolve=public(),
                                      transport=transport(handler))
    assert posting.title == "Senior Security Engineer" and posting.company == "Acme Payments"
    assert "Run the vulnerability management programme" in posting.text and "<b>" not in posting.text
    assert "Apply now" not in posting.text  # page chrome isn't the posting
    assert posting.url == "https://jobs.acme.example/roles/42?src=x"
    # connected to the checked address, with the name in Host and TLS SNI (DNS can't be asked twice)
    req = seen[0]
    assert req.url.host == "93.184.216.34" and req.url.path == "/roles/42" and req.url.query == b"src=x"
    assert req.headers["host"] == "jobs.acme.example" and req.extensions["sni_hostname"] == "jobs.acme.example"


async def test_main_content_fallback_without_structured_data() -> None:
    page = ("<html><head><meta property='og:title' content='Staff Engineer — Globex'></head><body>"
            "<header>Globex careers</header><main><h1>Staff Engineer</h1>" + DESCRIPTION + "</main>"
            "<footer>© Globex</footer></body></html>")
    posting = await fetch_job_posting("http://globex.example/job", resolve=public(),
                                      transport=transport(lambda r: html(page)))
    assert posting.title == "Staff Engineer — Globex"
    assert posting.text.startswith("Staff Engineer") and "© Globex" not in posting.text


@pytest.mark.parametrize("addr", ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.16.5.4", "169.254.169.254",
                                  "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
async def test_private_addresses_are_refused(addr: str) -> None:
    called = False

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return html(LD_PAGE)

    with pytest.raises(JobLinkError, match="private address"):
        await fetch_job_posting("https://intranet.example/", resolve=public(addr), transport=transport(handler))
    assert not called  # refused before any connection


async def test_a_host_with_any_private_answer_is_refused() -> None:
    async def mixed(host: str, port: int) -> list[str]:
        return ["93.184.216.34", "10.0.0.1"]

    with pytest.raises(JobLinkError, match="private address"):
        await fetch_job_posting("https://mixed.example/", resolve=mixed, transport=transport(lambda r: html(LD_PAGE)))


@pytest.mark.parametrize("url", ["http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://127.1/",
                                 "http://0x7f.0.0.1/", "http://2130706433/"])
async def test_literal_private_ips_are_refused(url: str) -> None:
    # The real resolver: shorthand/hex/decimal forms of 127.0.0.1 are resolved (offline) and refused like any other.
    with pytest.raises(JobLinkError, match="private address"):
        await fetch_job_posting(url, transport=transport(lambda r: html(LD_PAGE)))


@pytest.mark.parametrize("url,message", [
    ("ftp://jobs.example/x", "web link"),
    ("javascript:alert(1)", "web link"),
    ("https://user:pw@jobs.example/", "username"),
    ("https://jobs.example:8443/", "standard web links"),
    ("http://jobs.example:22/", "standard web links"),
])
async def test_unsupported_links(url: str, message: str) -> None:
    with pytest.raises(JobLinkError, match=message):
        await fetch_job_posting(url, resolve=public(), transport=transport(lambda r: html(LD_PAGE)))


async def test_redirects_are_rechecked_every_hop() -> None:
    async def resolve(host: str, port: int) -> list[str]:
        return ["10.0.0.7"] if host == "internal.example" else ["93.184.216.34"]

    def to_internal(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://internal.example/admin"})

    with pytest.raises(JobLinkError, match="private address"):
        await fetch_job_posting("https://short.example/j", resolve=resolve, transport=transport(to_internal))

    hops = iter([httpx.Response(301, headers={"location": "/careers/42"}), html(LD_PAGE)])
    posting = await fetch_job_posting("https://jobs.example/j", resolve=public(),
                                      transport=transport(lambda r: next(hops)))
    assert posting.url == "https://jobs.example/careers/42"

    with pytest.raises(JobLinkError, match="too many"):
        await fetch_job_posting("https://loop.example/", resolve=public(),
                                transport=transport(lambda r: httpx.Response(302, headers={"location": "/again"})))


async def test_unreadable_pages_say_to_paste_instead() -> None:
    for resp, message in (
        (html("nope", 403), "sign-in"),
        (html("gone", 404), "error 404"),
        (httpx.Response(200, content=b"%PDF-1.7", headers={"content-type": "application/pdf"}), "isn't a web page"),
        (html("<html><body><div id='app'></div><script>boot()</script></body></html>"), "paste it instead"),
    ):
        with pytest.raises(JobLinkError, match=message):
            await fetch_job_posting("https://jobs.example/x", resolve=public(), transport=transport(lambda r: resp))


def test_extract_handles_a_top_level_list_and_type_arrays() -> None:
    blob = json.dumps([{"@type": ["JobPosting"], "title": "SRE", "description": DESCRIPTION}])
    page = f'<script type="application/ld+json">{blob}</script>'
    posting = extract_posting(page)
    assert posting.title == "SRE" and "threat modelling" in posting.text


def test_import_link_endpoint(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.post("/v1/prep/import-link", json={"url": "https://jobs.example/1"}).status_code == 401
    h = _register(client)

    async def fake(url: str) -> job_link.JobPosting:
        if "bad" in url:
            raise JobLinkError("Couldn't find a job description on that page.")
        return job_link.JobPosting(url=url, title="SRE", company="Acme", text="x" * 300)

    monkeypatch.setattr(job_link, "fetch_job_posting", fake)
    r = client.post("/v1/prep/import-link", headers=h, json={"url": "https://jobs.example/1"})
    assert r.status_code == 200, r.text
    assert r.json() == {"url": "https://jobs.example/1", "title": "SRE", "company": "Acme", "text": "x" * 300}
    bad = client.post("/v1/prep/import-link", headers=h, json={"url": "https://jobs.example/bad"})
    assert bad.status_code == 422 and "job description" in bad.json()["detail"]
