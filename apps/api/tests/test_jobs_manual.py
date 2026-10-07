"""Jobs found elsewhere (job_portal/manual.py and the `/v1/jobs/tracker/link` and `/tracker/manual` routes): reading a
job's link from its address alone (Naukri, LinkedIn, Internshala, the ATS boards), the hand-added tracker entry
(`ext:` id, `source = "manual"`), validation, duplicates, a link that's a post in the feed, ownership, the cap and the
rate limit; and the freshness the feed and the tracker can honestly claim (`first_seen_at`, `still_listed_at`).

Nothing here reaches the network: reading a link never fetches it.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api import ratelimit
from orbit_api.job_portal import manual
from orbit_api.job_portal import routes as job_routes
from orbit_api.prep import job_link
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs  # noqa: F401  (`jobs` is the empty-cache fixture)

NAUKRI = ("https://www.naukri.com/job-listings-software-developer-tata-consultancy-services-hyderabad-secunderabad-"
          "bengaluru-4-to-9-years-031025008519?src=jobsearchDesk&sid=17598&xp=1&px=1")
NAUKRI_CLEAN = NAUKRI.split("?", 1)[0]
LINKEDIN = "https://www.linkedin.com/jobs/view/software-engineer-at-razorpay-3812345678/?trackingId=abc%3D%3D&refId=x"


@pytest.fixture(autouse=True)
def _never_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reading a link is the address only: any fetch of the page fails the test."""
    async def boom(*_: Any, **__: Any) -> None:
        raise AssertionError("a job link was fetched")

    monkeypatch.setattr(job_link, "fetch_job_posting", boom)


def add(client: TestClient, h: dict[str, str], **body: Any) -> Any:
    return client.post("/v1/jobs/tracker/manual", headers=h, json=body)


# ---- reading a link --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("url", "site", "title", "company", "location"), [
    (NAUKRI, "Naukri", "Software Developer", "Tata Consultancy Services", "Hyderabad, Bengaluru"),
    ("naukri.com/job-listings-data-analyst-razorpay-bengaluru-0-to-2-years-071025500123", "Naukri", "Data Analyst",
     "Razorpay", "Bengaluru"),
    ("https://www.naukri.com/job-listings-fresher-graduate-hiring-bpo-voice-process-teleperformance-mumbai-all-areas-"
     "0-to-1-years-061025912345", "Naukri", "Fresher Graduate Hiring BPO Voice Process", "Teleperformance", "Mumbai"),
    (LINKEDIN, "LinkedIn", "Software Engineer", "Razorpay", ""),
    ("https://in.linkedin.com/jobs/view/3812345678", "LinkedIn", "", "", ""),
    ("https://internshala.com/internship/detail/web-development-internship-in-bangalore-at-acme-technologies1696512345",
     "Internshala", "Web Development Internship", "Acme Technologies", "Bengaluru"),
    ("https://internshala.com/internship/detail/work-from-home-python-development-internship-at-pixel-labs1696512399",
     "Internshala", "Python Development Internship", "Pixel Labs", "Remote"),
    ("https://www.foundit.in/job/software-engineer-razorpay-bengaluru-bangalore-12345678", "foundit",
     "Software Engineer", "Razorpay", "Bengaluru"),
    ("https://boards.greenhouse.io/groww/jobs/4567890", "Greenhouse", "", "Groww", ""),
    ("https://jobs.lever.co/fampay/1a2b3c4d-1111-2222-3333-444455556666", "Lever", "", "Fampay", ""),
    ("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Bengaluru-Karnataka-India/Software-Engineer_R12345",
     "Workday", "Software Engineer", "Acme", "Bengaluru"),
    ("https://in.indeed.com/viewjob?jk=abc123&from=serp", "Indeed", "", "", ""),
    ("https://careers.example.com/jobs/42?utm_source=wa#apply", "careers.example.com", "", "", ""),
])
def test_a_link_is_read_from_its_address(url: str, site: str, title: str, company: str, location: str) -> None:
    link = manual.read_link(url)
    assert (link.site, link.title, link.company, link.location) == (site, title, company, location)


def test_links_are_tidied_so_the_same_job_is_the_same_link() -> None:
    assert manual.read_link(NAUKRI).url == NAUKRI_CLEAN  # tracking parameters off
    assert manual.read_link(LINKEDIN).url == "https://www.linkedin.com/jobs/view/3812345678/"
    assert manual.read_link("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3812345678").url \
        == "https://www.linkedin.com/jobs/view/3812345678/"
    assert manual.read_link("https://in.indeed.com/viewjob?jk=abc123&from=serp").url == \
        "https://in.indeed.com/viewjob?jk=abc123"  # the job's own parameter stays
    assert manual.read_link("HTTPS://Careers.Example.COM:443/jobs/42#apply").url == "https://careers.example.com/jobs/42"
    assert manual.new_listing_id().startswith("ext:") and len(manual.new_listing_id()) == 36  # the column's size


@pytest.mark.parametrize("url", ["javascript:alert(1)", "mailto:hr@example.com", "data:text/html,hi",
                                 "ftp://example.com/job", "https://user:pw@example.com/job", "http://localhost:8000/x",
                                 "https://exa mple.com/job", "https://[::1]/job", "   ", "https://" + "a" * 2_100])
def test_bad_links_are_refused_in_plain_words(url: str) -> None:
    with pytest.raises(manual.LinkError):
        manual.read_link(url)


def test_the_link_route_reads_a_link_for_the_form_and_needs_a_session(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    r = jobs.post("/v1/jobs/tracker/link", headers=h, json={"url": NAUKRI})
    assert r.status_code == 200, r.text
    assert r.json() == {"url": NAUKRI_CLEAN, "site": "Naukri", "title": "Software Developer",
                        "company": "Tata Consultancy Services", "location": "Hyderabad, Bengaluru",
                        "listing_id": None, "tracked": None}
    bad = jobs.post("/v1/jobs/tracker/link", headers=h, json={"url": "javascript:alert(1)"})
    assert bad.status_code == 422 and "web link" in bad.json()["detail"]
    jobs.cookies.clear()
    assert jobs.post("/v1/jobs/tracker/link", json={"url": NAUKRI}).status_code == 401
    assert jobs.post("/v1/jobs/tracker/manual", json={"url": NAUKRI}).status_code == 401


# ---- adding a job by hand --------------------------------------------------------------------------------------------


def test_a_naukri_link_goes_on_the_tracker_as_a_job_found_elsewhere(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    r = add(jobs, h, url=NAUKRI, status="applied")
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["listing_id"].startswith("ext:") and len(e["listing_id"]) == 36 and e["source"] == "manual"
    assert (e["title"], e["company"], e["location"]) == ("Software Developer", "Tata Consultancy Services",
                                                         "Hyderabad, Bengaluru")
    assert e["url"] == e["apply_url"] == NAUKRI_CLEAN
    assert e["status"] == "applied" and e["applied_at"] and e["posted_at"] is None
    assert e["live"] is False and e["still_listed_at"] is None  # Orbit can't see Naukri: no "still open"
    assert [x["id"] for x in jobs.get("/v1/jobs/tracker", headers=h).json()] == [e["id"]]
    # Moved along like any other entry.
    when = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    moved = jobs.patch(f"/v1/jobs/tracker/{e['id']}", headers=h, json={"status": "interviewing", "next_at": when})
    assert moved.status_code == 200 and moved.json()["status"] == "interviewing" and moved.json()["live"] is False
    assert jobs.delete(f"/v1/jobs/tracker/{e['id']}", headers=h).status_code == 204
    assert jobs.get("/v1/jobs/tracker", headers=h).json() == []


def test_typed_details_win_over_the_link_and_a_job_can_be_typed_in_without_one(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    typed = add(jobs, h, url=LINKEDIN, company="  Razorpay\tSoftware  ", title="SDE 1 (Payments)",
                location="Bengaluru", notes="Referred by Priya\nCall on Monday", status="saved").json()
    assert (typed["company"], typed["title"], typed["location"]) == ("Razorpay Software", "SDE 1 (Payments)",
                                                                     "Bengaluru")
    assert typed["notes"] == "Referred by Priya\nCall on Monday" and typed["applied_at"] is None
    plain = add(jobs, h, company="Infosys", title="Systems Engineer", status="applied",
                applied_at="2026-10-01T12:00:00Z")
    assert plain.status_code == 201, plain.text
    assert plain.json()["url"] == "" and plain.json()["applied_at"].startswith("2026-10-01")
    # Nothing to go on: neither the link nor the form says what the job is.
    for body, says in (({}, "or paste the job's link"), ({"company": "Wipro"}, "or paste the job's link"),
                       ({"url": "https://in.indeed.com/viewjob?jk=abc123"}, "couldn't read them from the link"),
                       ({"url": "mailto:hr@example.com", "company": "X", "title": "Y"}, "web link")):
        r = add(jobs, h, **body)
        assert r.status_code == 422 and says in r.json()["detail"], r.text
    for body in ({"title": "x" * 301, "company": "X"}, {"status": "hired", "company": "X", "title": "Y"},
                 {"notes": "n" * 4_001, "company": "X", "title": "Y"}, {"url": "https://x.com/" + "a" * 2_100}):
        assert add(jobs, h, **body).status_code == 422


def test_the_same_job_twice_is_refused_with_the_entry_it_already_is(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    first = add(jobs, h, url=NAUKRI).json()
    again = add(jobs, h, url=NAUKRI_CLEAN + "?src=whatsapp&utm_source=share", status="applied")
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_tracked" and again.json()["detail"]["id"] == first["id"]
    preview = jobs.post("/v1/jobs/tracker/link", headers=h, json={"url": NAUKRI}).json()
    assert preview["tracked"] == {"id": first["id"], "status": "saved"}
    typed = add(jobs, h, company="Infosys", title="Systems Engineer").json()
    dup = add(jobs, h, company="INFOSYS", title="systems engineer")
    assert dup.status_code == 409 and dup.json()["detail"]["id"] == typed["id"]
    assert add(jobs, h, company="Infosys", title="Senior Systems Engineer").status_code == 201
    assert len(jobs.get("/v1/jobs/tracker", headers=h).json()) == 3
    # Someone else's copy of the same link is theirs alone.
    assert add(jobs, _register(jobs), url=NAUKRI).status_code == 201


def test_a_link_to_a_post_in_the_feed_is_tracked_as_that_post(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    seen = datetime.now(UTC) - timedelta(hours=2)
    lid = insert(jobs, _listing(company="Groww", title="Backend Engineer", url="https://boards.greenhouse.io/groww/jobs/77",
                                apply_url="https://boards.greenhouse.io/groww/jobs/77#app", fetched_at=seen))[0]
    preview = jobs.post("/v1/jobs/tracker/link", headers=h, json={"url": "https://boards.greenhouse.io/groww/jobs/77"})
    assert preview.json()["listing_id"] == lid and preview.json()["title"] == "Backend Engineer"
    r = add(jobs, h, url="https://boards.greenhouse.io/groww/jobs/77", status="applied", title="ignored")
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["listing_id"] == lid and e["source"] == "greenhouse" and e["title"] == "Backend Engineer"
    assert e["live"] is True and e["still_listed_at"] is not None and e["applied_at"]
    feed = jobs.get("/v1/jobs/feed", headers=h).json()
    assert feed["items"][0]["tracked"] == {"id": e["id"], "status": "applied"}
    assert add(jobs, h, url="https://boards.greenhouse.io/groww/jobs/77").status_code == 409
    assert jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid}).json()["id"] == e["id"]


def test_hand_added_jobs_are_private_and_a_job_post_document_must_be_yours(jobs: TestClient) -> None:  # noqa: F811
    h, other = _register(jobs), _register(jobs)
    mine = jobs.post("/v1/documents/text", headers=h, json={"title": "SDE — Acme", "kind": "job_description",
                                                           "text": "We are hiring a backend engineer. " * 20})
    theirs = jobs.post("/v1/documents/text", headers=other, json={"title": "Theirs", "kind": "job_description",
                                                                 "text": "Another job description here. " * 20})
    assert mine.status_code == 201 and theirs.status_code == 201
    stolen = add(jobs, h, company="Acme", title="SDE", document_id=theirs.json()["id"])
    assert stolen.status_code == 404
    missing = add(jobs, h, company="Acme", title="SDE", document_id=str(uuid.uuid4()))
    assert (missing.status_code, missing.json()) == (stolen.status_code, stolen.json())  # the same as a missing one
    e = add(jobs, h, company="Acme", title="SDE", document_id=mine.json()["id"]).json()
    assert e["document_id"] == mine.json()["id"]
    assert jobs.get("/v1/jobs/tracker", headers=other).json() == []
    for method, kw in (("PATCH", {"json": {"notes": "pwned"}}), ("DELETE", {})):
        assert jobs.request(method, f"/v1/jobs/tracker/{e['id']}", headers=other, **kw).status_code == 404
    assert jobs.get("/v1/jobs/tracker", headers=h).json()[0]["notes"] == ""


def test_hand_added_jobs_count_towards_the_trackers_cap(jobs: TestClient,  # noqa: F811
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    h = _register(jobs)
    monkeypatch.setattr(job_routes, "MAX_TRACKED", 2)
    assert add(jobs, h, company="A", title="Engineer").status_code == 201
    assert add(jobs, h, company="B", title="Engineer").status_code == 201
    full = add(jobs, h, company="C", title="Engineer")
    assert full.status_code == 409 and "holds up to 2" in full.json()["detail"]


def test_adding_by_hand_is_rate_limited_per_user(jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    h, fresh = _register(jobs), _register(jobs)  # signing up has its own limit: before the limits are on
    ratelimit.reset_all()
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    try:
        codes = [add(jobs, h, company=f"Company {i}", title="Engineer").status_code for i in range(23)]
        assert codes[:20] == [201] * 20 and codes[-1] == 429, codes  # a burst of 20, then 60 an hour
        assert add(jobs, fresh, company="Company 0", title="Engineer").status_code == 201  # per user, not global
        # Reading a link isn't a write: it has the tracker's own (generous) limit.
        assert jobs.post("/v1/jobs/tracker/link", headers=h, json={"url": NAUKRI}).status_code == 200
    finally:
        ratelimit.reset_all()


# ---- what the feed and the tracker may claim about freshness --------------------------------------------------------


def test_only_company_boards_say_still_listed_and_every_post_says_when_orbit_first_saw_it(
        jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    now = datetime.now(UTC)
    board, feed_post = insert(
        jobs,
        _listing(source="greenhouse", title="Backend Engineer", company="Groww", fetched_at=now - timedelta(hours=1)),
        _listing(source="remoteok", title="Backend Engineer", company="Remote Co", workplace="remote", cities=[],
                 locations=["Worldwide"], country=None, url="https://remoteok.com/remote-jobs/1",
                 fetched_at=now - timedelta(hours=1)))
    items = {j["id"]: j for j in jobs.get("/v1/jobs/feed", headers=h).json()["items"]}
    assert items[board]["direct"] is True and items[board]["still_listed_at"] is not None
    assert items[feed_post]["still_listed_at"] is None  # a feed's post: Orbit can't re-check it with the employer
    assert all(j["first_seen_at"] for j in items.values())
    detail = jobs.get(f"/v1/jobs/listings/{board}", headers=h).json()
    assert detail["job"]["still_listed_at"] == items[board]["still_listed_at"]
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": board})
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": feed_post})
    tracked = {e["listing_id"]: e for e in jobs.get("/v1/jobs/tracker", headers=h).json()}
    assert tracked[board]["live"] is True and tracked[board]["still_listed_at"] is not None
    assert tracked[feed_post]["live"] is True and tracked[feed_post]["still_listed_at"] is None
