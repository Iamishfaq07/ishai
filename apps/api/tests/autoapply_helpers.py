"""Shared by the Orbit Apply tests: recorded public application forms (fetched once from real boards on 2026-10-19:
Anthropic's Greenhouse board, Meesho's Lever apply page, Notion's and Sarvam's Ashby postings; trimmed), an httpx
MockTransport that serves them, and an account with a resume, a setup and fixture jobs. Nothing touches the network.
"""

import base64
import json
import struct
import uuid
import zlib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.db import sessionmaker
from orbit_api.models import User
from orbit_api.resumes.schema import Basics, Education, Experience, ResumeData, SkillGroup
from tests.test_api import _register
from tests.test_jobs import _listing, insert, run

FIXTURES = Path(__file__).parent / "fixtures" / "autoapply"
LEVER_ID = "7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596"
ASHBY_ID = "c0406fe0-c8c0-44aa-aa3e-b879f2bf1049"
ASHBY_LONG_ID = "1fc309c8-da20-4ff2-84c7-8b863ece2b0a"


def fixture_json(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf8"))


def lever_page() -> str:
    return (FIXTURES / "lever_apply_form.html").read_text(encoding="utf8")


def form_transport(calls: list[str] | None = None) -> httpx.MockTransport:
    """Greenhouse jobs 111/222 on any board, Lever's apply page, and Ashby's short and long postings."""

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        host, path = request.url.host, request.url.path
        if host == "boards-api.greenhouse.io" and path.rsplit("/", 1)[-1] in ("111", "222", "333"):
            return httpx.Response(200, json=fixture_json("greenhouse_job_questions.json"))
        if host == "jobs.lever.co" and path.endswith("/apply"):
            return httpx.Response(200, text=lever_page(), headers={"content-type": "text/html"})
        if host == "jobs.ashbyhq.com":
            body = json.loads(request.content or b"{}")
            job = body.get("variables", {}).get("jobPostingId")
            name = "ashby_job_posting.json" if job == ASHBY_LONG_ID else "ashby_job_posting_short.json"
            return httpx.Response(200, json=fixture_json(name))
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def resume() -> ResumeData:
    start = datetime.now(UTC).year - 5
    return ResumeData(
        basics=Basics(name="Asha Rao", headline="Backend Engineer", email="asha@example.com",
                      phone="+91 98765 43210", location="Bengaluru, Karnataka",
                      summary="Backend engineer building Python services and APIs on AWS."),
        experience=[Experience(title="Backend Engineer", company="PayNest", location="Bengaluru",
                               start=f"Jan {start}", current=True, bullets=[
                                   "Mentored two junior engineers through their first year",
                                   "Built Python services on PostgreSQL handling 2M payments a day",
                                   "Designed REST APIs used by 40 partner banks"])],
        education=[Education(school="RV College of Engineering", degree="B.E.", field="Computer Science")],
        skills=[SkillGroup(name="Skills", items=["Communication", "Python", "PostgreSQL", "AWS", "REST APIs",
                                                 "Docker"])])


def make_resume(client: TestClient, h: dict[str, str], data: ResumeData | None = None) -> str:
    r = client.post("/v1/resumes", headers=h, json={"title": "Master CV",
                                                    "data": (data or resume()).model_dump(mode="json")})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


FACTS: dict[str, Any] = {
    "first_name": "Asha", "last_name": "Rao", "email": "asha@example.com", "phone": "+91 98765 43210",
    "city": "Bengaluru", "country": "IN", "linkedin": "https://linkedin.com/in/asha", "github": "",
    "website": "", "current_company": "PayNest", "current_title": "Backend Engineer", "years_experience": 5,
    "highest_degree": "B.E.", "work_auth": [{"country": "IN", "authorized": True, "needs_sponsorship": False},
                                            {"country": "US", "authorized": False, "needs_sponsorship": True}],
    "notice_period_days": 30, "earliest_start": "", "willing_to_relocate": True, "expected_salary": "",
    "current_salary": ""}


def setup_body(resume_id: str, **kw: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"resume_id": resume_id, "approve_resume": True, "facts": dict(FACTS),
                            "filters": {"titles": ["Backend Engineer"], "days": 30}, "mode": "automatic",
                            "daily_limit": 10, "threshold": 50, "ai_line": True, "consent": True}
    body.update(kw)
    return body


def account(client: TestClient, **setup: Any) -> tuple[dict[str, str], str]:
    """A signed-in candidate with a master resume, a Jobs AI profile and a consented setup."""
    h = _register(client)
    rid = make_resume(client, h)
    r = client.put("/v1/jobs/profile", headers=h, json={"prefs": {
        "titles": ["Backend Engineer"], "skills": ["Python", "PostgreSQL", "AWS"], "locations": ["Bengaluru"],
        "workplace": ["remote", "hybrid", "onsite"], "posted_within": 30}, "resume_id": rid})
    assert r.status_code == 200, r.text
    r = client.put("/v1/apply/setup", headers=h, json=setup_body(rid, **setup))
    assert r.status_code == 200, r.text
    return h, rid


def user_id(client: TestClient, h: dict[str, str]) -> str:
    return str(client.get("/v1/auth/me", headers=h).json()["id"])


def verify_email(client: TestClient, uid: str) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.id == uid).values(email_verified=True))
            await db.commit()

    run(client, go)


def jobs(client: TestClient, **extra: Any) -> dict[str, str]:
    """Fixture jobs in Bengaluru for a backend engineer: one per ATS. Returns name -> listing id."""
    kw = dict(keywords=["Python", "PostgreSQL", "AWS", "REST"], description="Build Python services on PostgreSQL "
              "and AWS, and design REST APIs for partners. " * 4, salary=None)
    rows = {
        "greenhouse": _listing(source="greenhouse", board="acme", external_id="111", company="Acme",
                               title="Backend Engineer", url="https://job-boards.greenhouse.io/acme/jobs/111",
                               apply_url="https://job-boards.greenhouse.io/acme/jobs/111", **kw),
        "lever": _listing(source="lever", board="meesho", external_id=LEVER_ID, company="Meesho",
                          title="Backend Engineer", url=f"https://jobs.lever.co/meesho/{LEVER_ID}",
                          apply_url=f"https://jobs.lever.co/meesho/{LEVER_ID}/apply", **kw),
        "ashby": _listing(source="ashby", board="sarvam", external_id=ASHBY_ID, company="Sarvam AI",
                          title="Backend Engineer", url=f"https://jobs.ashbyhq.com/sarvam/{ASHBY_ID}",
                          apply_url=f"https://jobs.ashbyhq.com/sarvam/{ASHBY_ID}/application", **kw),
    }
    rows.update(extra)
    insert(client, *rows.values())
    return {k: v.id for k, v in rows.items()}


def png(size: int = 64) -> str:
    """A real (tiny) PNG, base64."""
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * size for _ in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    body = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return base64.b64encode(body).decode()


def ext_token(client: TestClient, h: dict[str, str]) -> dict[str, str]:
    r = client.post("/v1/extension/connect", headers=h)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def at(**kw: float) -> datetime:
    return datetime.now(UTC) + timedelta(**kw)


def new_id() -> str:
    return str(uuid.uuid4())


Patch = Callable[[Any, str, Any], None]
