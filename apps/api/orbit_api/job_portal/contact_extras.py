"""Extra signal for the job contact finder, beyond search results:

- Hunter.io (optional, `ORBIT_HUNTER_API_KEY`): people with work emails the service has seen published, their roles,
  and the company's email format. Each person comes back as its own source, so it passes the same checks as any lead.
- The email format a company uses, read from addresses its own public pages publish next to a person's name
  ("first.last"). Only the format is shown; no one's address is ever made up from it.
- Warm paths: the candidate's schools and past employers from their search resume, for LinkedIn searches that open in
  the candidate's own browser. They never go into Orbit's server-side search queries.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.job_portal.contact_sources import Source, employer_name
from orbit_api.models import JobApplication, JobSearchProfile, Resume

log = logging.getLogger(__name__)
HUNTER = "https://api.hunter.io/v2/domain-search"
FREE_MAIL = frozenset({"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me",
                       "protonmail.com", "rediffmail.com", "live.com", "aol.com"})
_EMAIL = re.compile(r"\b([a-z0-9][a-z0-9._%+-]{0,63})@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b", re.I)
_ROLE_BOX = re.compile(r"^(?:info|hr|jobs|careers|recruit\w*|talent|hello|contact|support|admin|team|people|"
                       r"press|media|sales|no-?reply|do-?not-?reply)$", re.I)


def hunter_enabled() -> bool:
    return get_settings().contact_hunter_key is not None


async def hunter_people(company: str) -> tuple[list[Source], dict[str, Any] | None]:
    """People Hunter has seen with a published work email at this company, as sources, plus its email format."""
    key = get_settings().contact_hunter_key
    if key is None:
        return [], None
    params: dict[str, str | int] = {"company": employer_name(company), "limit": 10, "type": "personal",
              "api_key": key.get_secret_value()}
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
            response = await client.get(HUNTER, params=params)
            response.raise_for_status()
            data = response.json().get("data") or {}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("hunter lookup failed: %s", type(exc).__name__)
        return [], None
    domain = str(data.get("domain") or "")
    sources: list[Source] = []
    for row in (data.get("emails") or [])[:10]:
        if not isinstance(row, dict):
            continue
        email = str(row.get("value") or "")
        first, last = str(row.get("first_name") or ""), str(row.get("last_name") or "")
        if not email or not first or _ROLE_BOX.match(email.split("@")[0]):
            continue
        name = f"{first} {last}".strip()
        position = str(row.get("position") or "")
        seen_at = next((str(s.get("uri")) for s in row.get("sources") or [] if isinstance(s, dict)
                        and str(s.get("uri", "")).startswith("https://")), None)
        text = f"{name} · {position} · {email} · {data.get('organization') or company}" if position \
            else f"{name} · {email} · {data.get('organization') or company}"
        sources.append(Source(id=f"hunter:{len(sources)}", kind="public_page", url=seen_at, text=text[:1000]))
    pattern = str(data.get("pattern") or "")
    fmt = {"pattern": pattern, "domain": domain, "seen": len(sources), "from": "directory"} \
        if pattern and domain else None
    return sources, fmt


def _pattern(local: str, first: str, last: str) -> str | None:
    f, la = first.lower(), last.lower()
    options = {f"{f}.{la}": "{first}.{last}", f"{f}{la}": "{first}{last}", f"{f[:1]}{la}": "{f}{last}",
               f"{f}_{la}": "{first}_{last}", f"{f}": "{first}", f"{f}.{la[:1]}": "{first}.{l}",
               f"{la}.{f}": "{last}.{first}", f"{f[:1]}.{la}": "{f}.{last}"}
    return options.get(local.lower())


def email_format(sources: list[Source], company: str) -> dict[str, Any] | None:
    """The format a company's addresses follow, from published addresses that sit next to the person's name."""
    votes: Counter[tuple[str, str]] = Counter()
    for source in sources:
        for match in _EMAIL.finditer(source.text):
            local, domain = match.group(1), match.group(2).lower()
            if domain in FREE_MAIL or _ROLE_BOX.match(local):
                continue
            before = source.text[max(0, match.start() - 80):match.start()]
            # The last two capitalised words before the address: "… Priya Sharma (priya.sharma@acme.com)".
            words = re.findall(r"[A-Z][a-z]+", before)[-2:]
            if len(words) < 2:
                continue
            first, last = words
            pattern = _pattern(local, first, last)
            if pattern:
                votes[(pattern, domain)] += 1
    if not votes:
        return None
    (pattern, domain), seen = votes.most_common(1)[0]
    return {"pattern": pattern, "domain": domain, "seen": seen, "from": "public pages"}


async def warm_paths(db: AsyncSession, user_id: str, job: JobApplication) -> dict[str, list[str]]:
    """Schools and past employers from the resume used for this job (else the search resume), for alumni and
    former-colleague searches the candidate opens themselves."""
    resume_id = job.resume_id
    if not resume_id:
        profile = await db.get(JobSearchProfile, user_id)
        resume_id = profile.resume_id if profile else None
    resume = await db.get(Resume, resume_id) if resume_id else None
    if resume is None or resume.user_id != user_id:
        return {"schools": [], "employers": []}
    data = resume.data or {}
    schools = [str(e.get("school", "")).strip() for e in data.get("education") or [] if isinstance(e, dict)]
    employers = [str(e.get("company", "")).strip() for e in data.get("experience") or [] if isinstance(e, dict)]
    target = employer_name(job.company).casefold()
    return {"schools": [s for s in dict.fromkeys(schools) if s][:3],
            "employers": [e for e in dict.fromkeys(employers) if e and employer_name(e).casefold() != target][:3]}
