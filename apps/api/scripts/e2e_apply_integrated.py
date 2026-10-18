"""The local API for the integrated Orbit Apply run (tools/e2e/apply-integrated.spec.ts): the real app on a disposable
SQLite database with the mock AI, fixture jobs on the same Greenhouse, Lever and Ashby postings the recorded pages
show (tools/e2e/ats-fixtures), and the server-side copies of those forms (tools/e2e/apply-integrated) served in place
of the ATS APIs. Nothing reaches the network. Discord's form is "unreadable" (404), so the packet falls back to the
standard fields and the extension finds the questions the planner couldn't see.

    uv run python scripts/e2e_apply_integrated.py --port 8147 --web http://127.0.0.1:5247 --db <temp>/apply.db

The spacing between applications is shortened for the run (5 s between any two, 5-8 s on one board, instead of 60 s
and 3-8 minutes): only the waits change, never what's enforced. It refuses any database outside the temp folder.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

FORMS = Path(__file__).resolve().parents[3] / "tools" / "e2e" / "apply-integrated"
# (source, board, external id, company, url): the postings the recorded pages are.
JOBS = [
    ("greenhouse", "gitlab", "8860302002", "GitLab", "https://job-boards.greenhouse.io/gitlab/jobs/8860302002"),
    ("greenhouse", "gitlab", "1000000001", "GitLab", "https://job-boards.greenhouse.io/gitlab/jobs/1000000001"),
    ("greenhouse", "discord", "8806482002", "Discord", "https://job-boards.greenhouse.io/discord/jobs/8806482002"),
    ("lever", "palantir", "6ed76ce8-4156-4b60-b120-403538bd66cd", "Palantir",
     "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd"),
    ("ashby", "notion", "1fc309c8-da20-4ff2-84c7-8b863ece2b0a", "Notion",
     "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a"),
    # A second Notion posting on the same page: the browser is stopped right after it presses submit.
    ("ashby", "notion", "2ac309c8-da20-4ff2-84c7-8b863ece2b0b", "Notion",
     "https://jobs.ashbyhq.com/notion/2ac309c8-da20-4ff2-84c7-8b863ece2b0b"),
]


def transport(calls: list[str]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        calls.append(f"{request.method} {host}{path}")
        if host == "boards-api.greenhouse.io" and "/boards/gitlab/" in path:
            return httpx.Response(200, json=json.loads((FORMS / "greenhouse-gitlab.json").read_text("utf8")))
        if host == "jobs.lever.co" and path.startswith("/palantir/") and path.endswith("/apply"):
            return httpx.Response(200, text=(FORMS / "lever-palantir.html").read_text("utf8"))
        if host == "jobs.ashbyhq.com":
            return httpx.Response(200, json=json.loads((FORMS / "ashby-notion.json").read_text("utf8")))
        return httpx.Response(404)  # Discord: the form can't be read

    return httpx.MockTransport(handler)


async def seed() -> None:
    from orbit_api.db import create_all, dispose, sessionmaker
    from orbit_api.job_portal.postings import dedupe_key, listing_id
    from orbit_api.models import JobListing

    await create_all()
    now = datetime.now(UTC)
    text = ("Build Python services on PostgreSQL and AWS, and design REST APIs used by partners. You'll own them in "
            "production with the team. ") * 6
    async with sessionmaker()() as db:
        for i, (source, board, ext, company, url) in enumerate(JOBS):
            lid = listing_id(source, ext)
            if await db.get(JobListing, lid):
                continue
            db.add(JobListing(
                id=lid, source=source, external_id=ext, board=board, company=company, title="Backend Engineer",
                locations=["Bengaluru, India"], cities=["Bengaluru"], country="IN", workplace="hybrid",
                employment_type="full_time", posted_at=now - timedelta(hours=2 + i), url=url, apply_url=url,
                snippet=text[:200], description=text, keywords=["Python", "PostgreSQL", "AWS", "REST"],
                text_hash=f"e2e-{i}", fetched_at=now, created_at=now,
                dedupe_key=dedupe_key(company, f"Backend Engineer {ext}", ["Bengaluru"], "hybrid")))
        await db.commit()
    await dispose()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8147)
    ap.add_argument("--web", default="http://127.0.0.1:5247")
    ap.add_argument("--db", default=str(Path(tempfile.gettempdir()) / "orbit-apply-integrated" / "apply.db"))
    args = ap.parse_args()
    db = Path(args.db).resolve()
    if Path(tempfile.gettempdir()).resolve() not in db.parents:
        raise SystemExit("The e2e database must be under the temp folder.")
    db.parent.mkdir(parents=True, exist_ok=True)
    os.environ.update(
        ORBIT_ENV="test", ORBIT_LLM_PROVIDER="mock", ORBIT_STT_PROVIDER="mock",
        ORBIT_DATABASE_URL=f"sqlite+aiosqlite:///{db.as_posix()}", ORBIT_WEB_URL=args.web,
        ORBIT_CORS_ORIGINS=args.web, ORBIT_JWT_SECRET="e2e-apply-integrated-" + "x" * 32, ORBIT_SMTP_HOST="",
        ORBIT_DEV_OUTBOX=str(db.parent / "outbox.txt"), ORBIT_ADMIN_EMAIL="qa-admin@example.com",
        DEEPSEEK_API_KEY="", DEEPGRAM_API_KEY="", ORBIT_SPOOL_DIR=str(db.parent))
    import uvicorn

    from orbit_api.auto_apply import planner, rules
    from orbit_api.main import create_app

    rules.MIN_GAP = timedelta(seconds=5)
    rules.TENANT_GAP_S = (5, 8)
    calls: list[str] = []
    planner.FORM_TRANSPORT = transport(calls)
    asyncio.run(seed())
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
