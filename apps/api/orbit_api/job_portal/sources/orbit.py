"""First-party jobs are written transactionally by Business; there is no remote feed to poll."""
from datetime import timedelta

from orbit_api.job_portal.http import FeedClient
from orbit_api.job_portal.postings import Posting
from orbit_api.job_portal.sources.base import Source


class Orbit(Source):
    id = "orbit"
    label = "Orbit for Business"
    kind = "board"
    hosts = frozenset[str]()
    ttl = timedelta(hours=1)
    direct = True

    def keys(self) -> list[str]:
        return []  # publish/edit/pause write the local projection; no outbound fetch jobs

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        return []
