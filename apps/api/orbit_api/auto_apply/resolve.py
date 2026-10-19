"""Where a listing can be applied to: its employer's own ATS form (Greenhouse, Lever, Ashby), an Orbit Direct job, or a
hand-off to the candidate.

Job boards are never automated (rules.py, rule 4): their terms ban it, and the ban falls on the candidate's own
account. A LinkedIn, Indeed or Naukri listing is first matched to the same job on the employer's own board (Jobs AI
often has it: same company, title and city), and applied to there. When there's no match, it becomes a hand-off
("Needs you: apply on LinkedIn") with the answers ready to copy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auto_apply import rules
from orbit_api.models import JobListing

# Boards whose terms ban automated applying, by host suffix: never automated, a hand-off only.
BOARDS: dict[str, str] = {
    "linkedin.com": "LinkedIn", "indeed.com": "Indeed", "indeed.co.in": "Indeed", "indeed.co.uk": "Indeed",
    "naukri.com": "Naukri", "glassdoor.com": "Glassdoor", "glassdoor.co.in": "Glassdoor", "foundit.in": "foundit",
    "monster.com": "Monster", "instahyre.com": "Instahyre", "hirist.tech": "Hirist", "hirist.com": "Hirist",
    "iimjobs.com": "iimjobs", "shine.com": "Shine", "timesjobs.com": "TimesJobs", "wellfound.com": "Wellfound",
    "angel.co": "Wellfound", "ziprecruiter.com": "ZipRecruiter", "dice.com": "Dice", "apna.co": "apna",
    "workindia.in": "WorkIndia", "cutshort.io": "Cutshort",
}
_GH = re.compile(r"^/([\w.-]+)/jobs/(\d+)")
_LEVER = re.compile(r"^/([\w.-]+)/([0-9a-f-]{36})")
_ASHBY = re.compile(r"^/([^/]+)/([0-9a-f-]{36})")


@dataclass(frozen=True)
class Target:
    ats: str  # greenhouse | lever | ashby | orbit | board | other
    tenant: str = ""
    job_ref: str = ""
    apply_url: str = ""
    site: str | None = None  # a hand-off's site, as the candidate knows it

    @property
    def automatic(self) -> bool:
        return self.ats in (*rules.ATS_SUPPORTED, "orbit")


def board_of(host: str) -> str | None:
    host = host.lower().removeprefix("www.")
    return next((name for suffix, name in BOARDS.items() if host == suffix or host.endswith("." + suffix)), None)


def from_url(url: str) -> Target | None:
    """An employer ATS form named by its address, or a board's hand-off. None: nothing Orbit recognises."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host:
        return None
    if parts.scheme != "https" or parts.username or parts.password or port not in (None, 443):
        return Target("other", apply_url=url, site=board_of(host) or host)
    if host in ("boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"):
        m = _GH.match(parts.path)
        if m:
            return Target("greenhouse", m.group(1), m.group(2), url)
        q = parse_qs(parts.query)
        if q.get("for") and q.get("token"):  # boards.greenhouse.io/embed/job_app?for=acme&token=123
            return Target("greenhouse", q["for"][0], q["token"][0], url)
    if host in ("jobs.lever.co", "jobs.eu.lever.co"):
        m = _LEVER.match(parts.path)
        if m:
            return Target("lever", m.group(1), m.group(2), f"https://{host}/{m.group(1)}/{m.group(2)}/apply")
    if host == "jobs.ashbyhq.com":
        m = _ASHBY.match(parts.path)
        if m:
            return Target("ashby", m.group(1), m.group(2), f"https://jobs.ashbyhq.com/{m.group(1)}/{m.group(2)}/"
                                                            "application")
    # Hosted-only adapters. Recognise actual employer URLs, never suffix lookalikes or arbitrary redirects.
    if parts.scheme == "https" and not parts.username and not parts.password and port in (None, 443):
        path = parts.path.rstrip("/")
        if re.fullmatch(r"[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com", host) and "/job/" in path:
            path = re.sub(r"/apply(?:/.*)?$", "", path)
            return Target("workday", host, path[-200:], f"https://{host}{path}/apply")
        if (re.fullmatch(r"[a-z0-9-]+\.wd\d+\.myworkdaysite\.com", host)
                and path.startswith("/recruiting/") and "/job/" in path):
            path = re.sub(r"/apply(?:/.*)?$", "", path)
            return Target("workday", host, path[-200:], f"https://{host}{path}/apply")
        if host == "jobs.smartrecruiters.com" and (m := re.fullmatch(r"/([\w.-]+)/(\d+)(?:-[^/]*)?", path)):
            return Target("smartrecruiters", m[1], m[2], f"https://{host}{path}?oga=true")
        if host == "apply.workable.com" and (m := re.fullmatch(r"/(?:([\w-]+)/)?j/([A-Za-z0-9]+)(?:/apply)?", path)):
            prefix = f"/{m[1]}" if m[1] else ""
            return Target("workable", m[1] or "workable", m[2], f"https://{host}{prefix}/j/{m[2]}/apply/")
        if re.fullmatch(r"[a-z0-9-]+\.recruitee\.com", host) and (m := re.fullmatch(r"/o/([\w-]+)(?:/c/new)?", path)):
            return Target("recruitee", host.split(".")[0], m[1], f"https://{host}/o/{m[1]}/c/new")
    site = board_of(host)
    if site:
        return Target("board", apply_url=url, site=site)
    return Target("other", apply_url=url, site=host.removeprefix("www."))


def from_listing(row: JobListing) -> Target:
    """The listing's own form when it came from an employer's board, else what its links say."""
    if row.source == "orbit":
        return Target("orbit", "orbit", row.external_id, row.apply_url)
    if row.source == "greenhouse":
        return Target("greenhouse", row.board, row.external_id, row.apply_url or row.url)
    if row.source in ("lever", "ashby"):
        hits = [h for h in (from_url(row.apply_url or ""), from_url(row.url or "")) if h and h.ats == row.source]
        return Target(row.source, row.board, row.external_id, hits[0].apply_url if hits else row.apply_url)
    for link in (row.apply_url, row.url):
        hit = from_url(link or "")
        if hit is not None and hit.automatic:
            return hit
    return from_url(row.apply_url or row.url) or Target("other", apply_url=row.apply_url or row.url, site=None)


async def resolve(db: AsyncSession, row: JobListing) -> tuple[Target, JobListing]:
    """Where to apply, and the listing that is (an employer board's copy of the same job, when a feed or board
    listed it too)."""
    target = from_listing(row)
    if target.automatic:
        return target, row
    same = (await db.scalars(select(JobListing).where(
        JobListing.dedupe_key == row.dedupe_key, JobListing.id != row.id,
        JobListing.source.in_(rules.ATS_SUPPORTED)).limit(3))).all()
    for other in same:
        t = from_listing(other)
        if t.automatic:
            return t, other
    return target, row
