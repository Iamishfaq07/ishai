"""Recorded job-source responses (trimmed from real ones, fetched 2026-10-07), dated relative to now so they stay
fresh, and an httpx MockTransport that serves them. Nothing here touches the network."""

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx


def ago(**kw: float) -> datetime:
    return datetime.now(UTC) - timedelta(**kw)


def iso(when: datetime) -> str:
    return when.isoformat().replace("+00:00", "Z")


def greenhouse() -> dict[str, Any]:
    body = ("&lt;div&gt;&lt;strong&gt;About Groww:&lt;/strong&gt;&lt;/div&gt;&lt;div&gt;We make financial services "
            "accessible to every Indian.&lt;/div&gt;&lt;h3&gt;What you&amp;#39;ll do&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;"
            "Design and build backend services in Go and Python on Kubernetes&lt;/li&gt;&lt;li&gt;Own APIs used by "
            "millions of investors, with PostgreSQL, Redis and Kafka&lt;/li&gt;&lt;/ul&gt;&lt;h3&gt;What we look "
            "for&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;3-5 years of backend experience&lt;/li&gt;&lt;li&gt;Experience with "
            "AWS, Docker and CI/CD&lt;/li&gt;&lt;li&gt;Bonus: gRPC and Terraform&lt;/li&gt;&lt;/ul&gt;")
    return {"jobs": [
        {"id": 4970739101, "title": "Backend Engineer - Payments", "absolute_url":
         "https://job-boards.eu.greenhouse.io/groww/jobs/4970739101", "location": {"name": "Bengaluru, India"},
         "offices": [{"name": "Bengaluru-VTP", "location": "Bengaluru-VTP, India"}],
         "first_published": (ago(hours=5)).isoformat(), "updated_at": (ago(hours=2)).isoformat(),
         "company_name": "Groww Invest Tech Pvt Ltd", "content": body, "metadata": []},
        {"id": 4970739102, "title": "Assistant Manager - Internal Audit", "absolute_url":
         "https://job-boards.eu.greenhouse.io/groww/jobs/4970739102", "location": {"name": "Mumbai, India"},
         "first_published": (ago(days=3)).isoformat(),
         "content": "&lt;p&gt;Lead internal audits of financial controls. 4+ years in audit, CA preferred. Excel, SAP "
                    "and risk management.&lt;/p&gt;", "metadata": [{"name": "Employment Type", "value": "Full-time"}]},
        {"id": 4970739103, "title": "Senior Backend Engineer", "absolute_url":
         "https://job-boards.eu.greenhouse.io/groww/jobs/4970739103", "location": {"name": "San Francisco, CA"},
         "first_published": (ago(days=1)).isoformat(), "content": "&lt;p&gt;Onsite in San Francisco.&lt;/p&gt;"},
        {"id": 4970739104, "title": "Data Engineer", "absolute_url":
         "https://job-boards.eu.greenhouse.io/groww/jobs/4970739104", "location": {"name": "Bengaluru, India"},
         "first_published": (ago(days=45)).isoformat(), "content": "&lt;p&gt;Spark and Airflow.&lt;/p&gt;"},
    ], "meta": {"total": 4}}


WORLD_BOARD = "anthropic"  # a built-in board hiring mostly outside India: served greenhouse_world()


def greenhouse_world() -> dict[str, Any]:
    """A board hiring in the US, the UK and Canada, with pay ranges (`pay_transparency=true`; fetched 2026-10-17)."""
    body = ("&lt;h2&gt;About the role&lt;/h2&gt;&lt;p&gt;Build the backend services behind our API in Python and Go, "
            "on Kubernetes in AWS, with PostgreSQL, Redis and Kafka.&lt;/p&gt;&lt;h2&gt;You may be a good fit if you"
            "&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Have 3+ years of backend experience&lt;/li&gt;&lt;li&gt;Know Docker, "
            "Terraform and gRPC&lt;/li&gt;&lt;/ul&gt;")

    def job(n: int, title: str, where: str, pay: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
        return {"id": 5_017_000 + n, "title": title, "location": {"name": where}, "content": body,
                "absolute_url": f"https://job-boards.greenhouse.io/anthropic/jobs/{5_017_000 + n}",
                "first_published": ago(days=n).isoformat(), "updated_at": ago(hours=n).isoformat(),
                "metadata": [], "pay_input_ranges": pay, **kw}

    def usd(lo: int, hi: int, title: str = "Annual Salary:") -> list[dict[str, Any]]:
        return [{"min_cents": lo * 100, "max_cents": hi * 100, "currency_type": "USD", "title": title,
                 "blurb": "<p>The annual compensation range for this role is listed below.</p>"}]

    return {"jobs": [
        job(1, "Software Engineer, Backend", "San Francisco, CA | New York City, NY", usd(222_800, 290_000)),
        job(2, "Backend Engineer, Platform", "Seattle, WA", usd(200_000, 260_000)),
        job(3, "Senior Backend Engineer", "Remote-Friendly, United States", usd(240_000, 310_000)),
        job(4, "Backend Engineer", "London, UK", [{"min_cents": 11_000_000, "max_cents": 15_000_000,
                                                   "currency_type": "GBP", "title": "Annual Salary:"}]),
        job(5, "Backend Engineer, Developer Platform", "Toronto, ON",
            [{"min_cents": 17_000_000, "max_cents": 21_000_000, "currency_type": "CAD", "title": "Toronto Pay Range"}]),
        job(6, "Software Engineering Intern", "New York, NY", usd(50, 60, "Hourly Pay")),
    ], "meta": {"total": 6}}


def lever() -> list[Any]:
    return [
        {"id": "aa98a938-af3a-45f5-851d-966b2b5bad33", "text": "SDE 2 - Platform",
         "categories": {"commitment": "Full Time", "location": "Bangalore", "team": "Engineering",
                        "allLocations": ["Bangalore"]},
         "country": "IN", "workplaceType": "hybrid", "createdAt": int(ago(hours=20).timestamp() * 1000),
         "descriptionPlain": "Build the platform that runs FamPay's payments.",
         "lists": [{"text": "What you'll do", "content": "<li>Run Kubernetes clusters on AWS</li><li>Write Go services"
                                                        " and gRPC APIs</li>"},
                   {"text": "You have", "content": "<li>2-4 years of experience with Docker and Terraform</li>"}],
         "additionalPlain": "", "hostedUrl": "https://jobs.lever.co/fampay/aa98a938-af3a-45f5-851d-966b2b5bad33",
         "applyUrl": "https://jobs.lever.co/fampay/aa98a938-af3a-45f5-851d-966b2b5bad33/apply",
         "salaryRange": {"currency": "INR", "interval": "per-year-salary", "min": 2_400_000, "max": 3_600_000}},
        {"id": "bb98a938-af3a-45f5-851d-966b2b5bad34", "text": "Accounts Payable Manager",
         "categories": {"commitment": "Full Time", "location": "hyderabad", "allLocations": ["hyderabad"]},
         "country": "IN", "workplaceType": "onsite", "createdAt": int(ago(days=2).timestamp() * 1000),
         "descriptionPlain": "Own vendor payments, GST filings and month-end close. 6+ years in accounting, Tally.",
         "lists": [], "hostedUrl": "https://jobs.lever.co/fampay/bb98a938-af3a-45f5-851d-966b2b5bad34",
         "applyUrl": "https://jobs.lever.co/fampay/bb98a938-af3a-45f5-851d-966b2b5bad34/apply"},
        {"id": "cc98a938", "text": "Account Executive", "categories": {"location": "London, UK"}, "country": "GB",
         "workplaceType": "onsite", "createdAt": int(ago(days=1).timestamp() * 1000), "descriptionPlain": "UK only.",
         "hostedUrl": "https://jobs.lever.co/fampay/cc98a938", "applyUrl": "https://jobs.lever.co/fampay/cc98a938/apply"},
    ]


def ashby() -> dict[str, Any]:
    return {"apiVersion": "1", "jobs": [
        {"id": "254c1250-953b-4323-8d18-9fe5e41d8d7d", "title": "Senior Security Engineer - Corporate Security",
         "employmentType": "FullTime", "location": "India", "secondaryLocations": [], "isListed": True,
         "isRemote": True, "workplaceType": "Remote", "publishedAt": iso(ago(days=2)),
         "address": {"postalAddress": {"addressCountry": "India"}},
         "jobUrl": "https://jobs.ashbyhq.com/atlan/254c1250-953b-4323-8d18-9fe5e41d8d7d",
         "applyUrl": "https://jobs.ashbyhq.com/atlan/254c1250-953b-4323-8d18-9fe5e41d8d7d/application",
         "descriptionPlain": "Secure our cloud. 6+ years in security engineering, AWS, Okta and SIEM.",
         "compensation": {"scrapeableCompensationSalarySummary": "₹40L – ₹60L"}},
        {"id": "unlisted-1", "title": "Hidden role", "isListed": False, "location": "Bengaluru",
         "jobUrl": "https://jobs.ashbyhq.com/atlan/unlisted-1", "publishedAt": iso(ago(days=1))},
        {"id": "intern-1", "title": "Software Engineering Intern", "employmentType": "Intern",
         "location": "Bengaluru, India", "workplaceType": "OnSite", "isListed": True, "publishedAt": iso(ago(days=1)),
         "jobUrl": "https://jobs.ashbyhq.com/atlan/intern-1", "applyUrl": "https://jobs.ashbyhq.com/atlan/intern-1/app",
         "descriptionPlain": "Six-month internship. Python, SQL and Git."},
    ]}


def smartrecruiters_list(country: str = "in") -> dict[str, Any]:
    """The posts in the `country` asked for: India's (Swiggy's), one in the US (ServiceNow's), none elsewhere."""
    if country == "us":
        return {"offset": 0, "limit": 100, "totalFound": 1, "content": [
            {"id": "744000160000001", "name": "Senior Backend Engineer", "releasedDate": iso(ago(hours=6)),
             "company": {"identifier": "ServiceNow", "name": "ServiceNow"},
             "location": {"city": "Santa Clara", "region": "CA", "country": "us", "remote": False, "hybrid": True,
                          "fullLocation": "Santa Clara, CA, United States"},
             "typeOfEmployment": {"label": "Full-time"}, "experienceLevel": {"id": "mid_senior_level"}}]}
    if country != "in":
        return {"offset": 0, "limit": 100, "totalFound": 0, "content": []}
    return {"offset": 0, "limit": 100, "totalFound": 2, "content": [
        {"id": "744000153719375", "name": "Backend Engineer II", "releasedDate": iso(ago(hours=10)),
         "company": {"identifier": "Swiggy", "name": "SWIGGY"},
         "location": {"city": "Bengaluru", "region": "KA", "country": "in", "remote": False, "hybrid": True},
         "typeOfEmployment": {"label": "Full-time"}, "experienceLevel": {"id": "mid_senior_level"}},
        {"id": "744000153719376", "name": "Executive - Social Media", "releasedDate": iso(ago(days=1)),
         "company": {"identifier": "Swiggy", "name": "SWIGGY"},
         "location": {"city": "Gurugram", "country": "in", "remote": False, "hybrid": False},
         "typeOfEmployment": {"label": "Full-time"}, "experienceLevel": {"id": "executive"}},
    ]}


def smartrecruiters_detail(posting_id: str) -> dict[str, Any]:
    company, about = (("ServiceNow", "ServiceNow makes the AI platform for business.")
                      if posting_id.startswith("7440001600") else ("Swiggy", "Swiggy is India's food app."))
    return {"id": posting_id, "postingUrl": f"https://jobs.smartrecruiters.com/{company}/{posting_id}-backend-engineer-ii",
            "applyUrl": f"https://jobs.smartrecruiters.com/{company}/{posting_id}-backend-engineer-ii?oga=true",
            "jobAd": {"sections": {
                "companyDescription": {"title": "Company Description", "text": f"<p>{about}</p>"},
                "jobDescription": {"title": "Job Description", "text": "<p>Build order services in Java and Go "
                                                                        "with Kafka and Redis.</p>"},
                "qualifications": {"title": "Qualifications", "text": "<p>3+ years of experience.</p>"}}}}


def himalayas() -> dict[str, Any]:
    return {"offset": 0, "limit": 20, "totalCount": 2, "jobs": [
        {"title": "Senior Software Engineer (Node.js/Python)", "companyName": "Opinov8", "companySlug": "opinov8",
         "employmentType": "Full Time", "minSalary": None, "maxSalary": None, "currency": "USD",
         "seniority": ["Senior"], "locationRestrictions": [], "pubDate": int(ago(hours=8).timestamp()),
         "description": "<p>Design APIs in Python and Node.js on AWS with Docker and Kubernetes.</p>",
         "applicationLink": "https://himalayas.app/companies/opinov8/jobs/senior-software-engineer",
         "guid": "https://himalayas.app/companies/opinov8/jobs/senior-software-engineer"},
        {"title": "Backend Engineer", "companyName": "Groww", "employmentType": "Full Time", "seniority": ["Mid-level"],
         "locationRestrictions": ["India"], "pubDate": int(ago(hours=30).timestamp()),
         "description": "<p>Backend in Go and Python, PostgreSQL, Redis and Kafka on Kubernetes.</p>",
         "applicationLink": "https://himalayas.app/companies/groww/jobs/backend-engineer",
         "guid": "https://himalayas.app/companies/groww/jobs/backend-engineer"},
    ]}


def remoteok() -> list[Any]:
    return [
        {"last_updated": 1791205202, "legal": "API Terms of Service: Please link back (with follow) to Remote OK."},
        {"id": "1137465", "epoch": int(ago(hours=6).timestamp()), "company": "RedMimicry",
         "position": "Platform Engineer", "tags": ["golang", "kubernetes"], "location": "",
         "description": "Build telemetry pipelines in Go â\u0080\u0093 on Kubernetes.<br/><br/>Please mention the "
                        "word **THRIFTY** and tag RMjQwMTo0OTAwOjg4NTI6NGVhNzo1NWEzOjc2MmQ6YzhkZTo0ODU5 when applying.",
         "url": "https://remoteOK.com/remote-jobs/remote-platform-engineer-redmimicry-1137465",
         "apply_url": "https://remoteOK.com/remote-jobs/remote-platform-engineer-redmimicry-1137465"},
        {"id": "1137466", "epoch": int(ago(hours=7).timestamp()), "company": "Acme US", "position": "Backend Engineer",
         "location": "Boston", "description": "Onsite-ish.", "url": "https://remoteOK.com/remote-jobs/1137466"},
    ]


def jobicy(region: str) -> dict[str, Any]:
    return {"jobCount": 2, "jobs": [
        {"id": 154682 if region == "apac" else 154690, "url": f"https://jobicy.com/jobs/1546-{region}-platform",
         "jobTitle": "Platform Engineer", "companyName": "Catawiki", "jobType": ["Full-Time"], "jobGeo": "Anywhere",
         "jobLevel": "Senior", "jobExcerpt": "Kubernetes and Terraform.", "jobDescription": "<p>Kubernetes, Terraform"
                                                                                          " and AWS.</p>",
         "pubDate": iso(ago(hours=12)), "salaryMin": 60000, "salaryMax": 80000, "salaryCurrency": "EUR",
         "salaryPeriod": "yearly"},
        {"id": 154683 if region == "apac" else 154691, "url": f"https://jobicy.com/jobs/1546-{region}-au",
         "jobTitle": "Site Reliability Engineer", "companyName": "AussieCo", "jobType": ["Full-Time"],
         "jobGeo": "Australia", "jobDescription": "<p>Australia only.</p>", "pubDate": iso(ago(hours=12))},
    ]}


def adzuna() -> dict[str, Any]:
    return {"count": 1, "results": [
        {"id": "5012345678", "title": "<strong>Backend</strong> Developer", "created": iso(ago(hours=4)),
         "description": "We are hiring a backend developer with Python and Django experience in Bengaluru...",
         "redirect_url": "https://www.adzuna.in/land/ad/5012345678?se=abc",
         "company": {"display_name": "Kirana Cloud"},
         "location": {"display_name": "Bengaluru, Karnataka", "area": ["India", "Karnataka", "Bengaluru"]},
         "salary_min": 1_200_000, "salary_max": 1_800_000, "contract_time": "full_time"}]}


def jsearch() -> dict[str, Any]:
    return {"status": "OK", "data": [
        {"job_id": "jsx-1", "employer_name": "Zerodha", "job_title": "Backend Developer (Go)",
         "job_apply_link": "https://www.linkedin.com/jobs/view/123", "apply_options": [
             {"publisher": "LinkedIn", "apply_link": "https://www.linkedin.com/jobs/view/123", "is_direct": False},
             {"publisher": "Zerodha Careers", "apply_link": "https://careers.zerodha.com/backend-go",
              "is_direct": True}],
         "job_description": "Write Go services for Kite. 2+ years.", "job_city": "Bengaluru", "job_state": "Karnataka",
         "job_country": "IN", "job_is_remote": False, "job_posted_at_datetime_utc": iso(ago(hours=3)),
         "job_employment_type": "FULLTIME", "job_publisher": "LinkedIn"}]}


Handler = Callable[[httpx.Request], httpx.Response]


def transport(seen: list[httpx.Request] | None = None, *, fail: dict[str, int] | None = None,
              override: dict[str, Any] | None = None) -> httpx.MockTransport:
    """Serves every source's recorded answer by host and path. `fail`: host -> status to answer with instead;
    `override`: host -> payload to answer with instead."""

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        host, path = request.url.host, request.url.path
        if fail and host in fail:
            return httpx.Response(fail[host], headers={"retry-after": "120"}, json={})
        if override and host in override:
            return httpx.Response(200, content=json.dumps(override[host]).encode())
        if host == "boards-api.greenhouse.io":
            payload: Any = greenhouse_world() if path.split("/")[3:4] == [WORLD_BOARD] else greenhouse()
        elif host == "api.lever.co":
            payload = lever()
        elif host == "api.ashbyhq.com":
            payload = ashby()
        elif host == "api.smartrecruiters.com":
            tail = path.rstrip("/").rsplit("/", 1)[-1]
            payload = (smartrecruiters_list(request.url.params.get("country", "in")) if tail == "postings"
                       else smartrecruiters_detail(tail))
        elif host == "himalayas.app":
            payload = himalayas() if request.url.params.get("page") == "1" else {"jobs": []}
        elif host == "remoteok.com":
            payload = remoteok()
        elif host == "jobicy.com":
            payload = jobicy(request.url.params.get("geo", "apac"))
        elif host == "api.adzuna.com":
            payload = adzuna()
        elif host == "jsearch.p.rapidapi.com":
            payload = jsearch()
        else:
            return httpx.Response(404)
        return httpx.Response(200, content=json.dumps(payload).encode(),
                              headers={"content-type": "application/json"})

    return httpx.MockTransport(handle)
