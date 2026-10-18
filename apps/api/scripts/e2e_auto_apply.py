"""A local API for Orbit Apply's end-to-end run (tools/e2e/auto-apply.mjs): the real app on a disposable SQLite
database with the mock AI, the recorded public application forms (tests/fixtures/autoapply) served in place of
Greenhouse, Lever and Ashby, and fixture jobs in the Jobs AI cache. Nothing reaches the network.

    uv run python scripts/e2e_auto_apply.py --port 8039 --web http://127.0.0.1:5202

Never point it at a real database: it refuses anything but a file under the system's temp folder.
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

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "autoapply"
LEVER_ID = "7d9af9b5-c1c7-48ec-bbb5-9b25e49f6596"
ASHBY_ID = "c0406fe0-c8c0-44aa-aa3e-b879f2bf1049"


def transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        if host == "boards-api.greenhouse.io":
            return httpx.Response(200, json=json.loads((FIXTURES / "greenhouse_job_questions.json").read_text("utf8")))
        if host == "jobs.lever.co" and path.endswith("/apply"):
            return httpx.Response(200, text=(FIXTURES / "lever_apply_form.html").read_text("utf8"))
        if host == "jobs.ashbyhq.com":
            return httpx.Response(200, json=json.loads((FIXTURES / "ashby_job_posting_short.json").read_text("utf8")))
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def seed() -> None:
    from orbit_api.db import create_all, dispose, sessionmaker
    from orbit_api.job_portal.postings import dedupe_key, listing_id
    from orbit_api.models import JobListing

    await create_all()
    now = datetime.now(UTC)
    text = ("Build Python services on PostgreSQL and AWS, and design REST APIs used by partners. You'll own them in "
            "production with the team. ") * 6
    rows = [
        ("greenhouse", "acme", "111", "Acme", "https://job-boards.greenhouse.io/acme/jobs/111"),
        ("lever", "meesho", LEVER_ID, "Meesho", f"https://jobs.lever.co/meesho/{LEVER_ID}"),
        ("ashby", "sarvam", ASHBY_ID, "Sarvam AI", f"https://jobs.ashbyhq.com/sarvam/{ASHBY_ID}"),
        ("ashby", "orbitlabs", "9a3c1e0b-5d2f-4c8e-9b7a-1f2e3d4c5b6a", "Orbit Labs",
         "https://jobs.ashbyhq.com/orbitlabs/9a3c1e0b-5d2f-4c8e-9b7a-1f2e3d4c5b6a"),
        ("jsearch", "search", "li-1", "Initech", "https://www.linkedin.com/jobs/view/4012345678"),
    ]
    async with sessionmaker()() as db:
        for i, (source, board, ext, company, url) in enumerate(rows):
            lid = listing_id(source, ext)
            if await db.get(JobListing, lid):
                continue
            db.add(JobListing(
                id=lid, source=source, external_id=ext, board=board, company=company, title="Backend Engineer",
                locations=["Bengaluru, India"], cities=["Bengaluru"], country="IN", workplace="hybrid",
                employment_type="full_time", posted_at=now - timedelta(hours=2 + i), url=url, apply_url=url,
                snippet=text[:200], description=text, keywords=["Python", "PostgreSQL", "AWS", "REST"],
                text_hash="e2e", dedupe_key=dedupe_key(company, "Backend Engineer", ["Bengaluru"], "hybrid"),
                fetched_at=now, created_at=now))
        await db.commit()
    await dispose()  # the server's own loop opens its own connections


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8039)
    ap.add_argument("--web", default="http://127.0.0.1:5202")
    ap.add_argument("--db", default=str(Path(tempfile.gettempdir()) / "orbit-autoapply-e2e" / "e2e.db"))
    args = ap.parse_args()
    db = Path(args.db).resolve()
    if Path(tempfile.gettempdir()).resolve() not in db.parents:
        raise SystemExit("The e2e database must be under the temp folder.")
    db.parent.mkdir(parents=True, exist_ok=True)
    os.environ.update(
        ORBIT_ENV="test", ORBIT_LLM_PROVIDER="mock", ORBIT_STT_PROVIDER="mock",
        ORBIT_DATABASE_URL=f"sqlite+aiosqlite:///{db.as_posix()}", ORBIT_WEB_URL=args.web,
        ORBIT_CORS_ORIGINS=args.web, ORBIT_JWT_SECRET="e2e-autoapply-" + "x" * 32, ORBIT_SMTP_HOST="",
        ORBIT_DEV_OUTBOX=str(db.parent / "outbox.txt"), ORBIT_ADMIN_EMAIL="qa-admin@example.com",
        DEEPSEEK_API_KEY="", DEEPGRAM_API_KEY="", ORBIT_SPOOL_DIR=str(db.parent))
    import uvicorn

    from orbit_api.auto_apply import planner
    from orbit_api.main import create_app

    planner.FORM_TRANSPORT = transport()
    asyncio.run(seed())
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
