"""Remote OK: its public feed of the latest remote jobs (`GET remoteok.com/api`, about 100), refreshed daily.

Terms: credit "Remote OK" by name with a followed link (no rel="nofollow") to the job's page on Remote OK, and don't
use its logo. Posts limited to somewhere other than India are left out. https://remoteok.com/api
"""

import asyncio
import re
from datetime import timedelta
from typing import Any

from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import Posting, parse_time, remote_region, salary_text, text_of
from orbit_api.job_portal.sources.base import Attribution, Source

_ANYWHERE = frozenset({"remote", "anywhere", "worldwide", "remoto", "global", "earth"})


def _https(url: str) -> str:
    return "https://remoteok.com" + url[len("https://remoteok.com"):] if url.lower().startswith(
        "https://remoteok.com") else url


def _unmangle(text: str) -> str:
    """Its feed sometimes double-encodes UTF-8 (an en dash arrives as "\u00e2\u0080\u0093")."""
    if "\u00e2\u0080" not in text and "\u00c3" not in text:
        return text
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


# Its anti-spam line ("Please mention the word **X** and tag RMjQ… when applying") isn't part of the job.
_TAG_LINE = re.compile(r"Please mention the word.*", re.S)


def parse_job(j: Any) -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("position") or not j.get("url"):
        return None
    where = str(j.get("location") or "").strip()
    # A place it names ("Boston", "Redwood City") is where the job is, unless it's India or open to anywhere.
    if where and where.lower() not in _ANYWHERE and remote_region(where) not in ("india", "open"):
        return None
    url = _https(str(j["url"]))
    tags = ", ".join(str(t) for t in (j.get("tags") or [])[:12])
    return Posting(
        source="remoteok", external_id=str(j["id"]), board="all", company=str(j.get("company") or ""),
        title=str(j["position"]), url=url, apply_url=url, posted_at=parse_time(j.get("epoch") or j.get("date")),
        locations=[f"Remote ({j['location']})" if j.get("location") else "Remote"],
        description=_TAG_LINE.sub("", text_of(_unmangle(str(j.get("description") or "")))).strip()
        + (f"\n\nTags: {tags}" if tags else ""), workplace="remote",
        salary=salary_text(j.get("salary_min"), j.get("salary_max"), "USD", "year"), remote_unstated_ok=True)


class RemoteOK(Source):
    id = "remoteok"
    label = "Remote OK"
    kind = "feed"
    hosts = frozenset({"remoteok.com"})
    ttl = timedelta(hours=24)
    attribution = Attribution("Remote OK", "https://remoteok.com")
    snippet_only = True  # the feed has the first few hundred characters of each post

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        data = await http.get_json("https://remoteok.com/api")
        if not isinstance(data, list):
            raise SourceError("Remote OK sent an unexpected shape")
        # The first item is the legal notice. Reading the posts' HTML is CPU work: off the event loop.
        return await asyncio.to_thread(lambda: [p for j in data[1:] if (p := parse_job(j)) is not None])
