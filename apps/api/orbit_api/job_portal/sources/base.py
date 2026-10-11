"""The one interface every job source implements.

Three kinds:
- "board": a company's own job board, one fetch per company (`keys()` are the boards' tokens);
- "feed": a public feed of jobs, the same for everyone (`keys()` are its few variants, e.g. Jobicy's regions);
- "search": an API asked one query at a time (a job title and a place), so its results depend on who's searching.
  Queries are shared: everyone looking for "backend engineer" in Bengaluru shares one cached answer. A query is for
  one country (where the searcher applies; India's keys are written as they always were).

A source raises `SourceError` (or `RateLimited`) when a fetch fails; the refresh records it and backs off, and the
feed keeps serving what's cached. A source that can't be used (an optional API without its key) says so with
`configured()` and is simply left out.
"""

from abc import ABC
from dataclasses import dataclass
from datetime import timedelta
from typing import ClassVar, Literal

from orbit_api.job_portal.http import FeedClient
from orbit_api.job_portal.postings import Posting

Kind = Literal["board", "feed", "search"]


@dataclass(frozen=True)
class Attribution:
    """The credit a feed's terms ask for, shown on every card from it: its name, linked to it."""

    label: str
    url: str
    # Adzuna: the name must be shown at least 116 x 23 px.
    large: bool = False


@dataclass(frozen=True)
class Budget:
    """A paid or rate-capped API's quota; calls stop at `stop_at` of each limit."""

    per_minute: int | None = None
    per_day: int | None = None
    per_month: int | None = None
    stop_at: float = 0.9


@dataclass(frozen=True)
class SearchQuery:
    what: str  # a job title or keywords, lowercased
    where: str  # a city, or ANYWHERE ("India" in India) for the whole country
    days: int  # posted within this many days
    country: str = "IN"  # ISO 3166-1 alpha-2: the country the searcher applies in

    def anywhere(self) -> bool:
        return self.where.lower() in ("india", "anywhere", "")

    def key(self) -> str:
        tail = "" if self.country == "IN" else f"|{self.country}"
        return f"{self.what}|{self.where}|{self.days}"[:157] + tail

    @classmethod
    def from_key(cls, key: str) -> "SearchQuery":
        what, where, days, country = [*key.split("|"), "", "India", "7", "IN"][:4]
        country = country.upper() if len(country) == 2 and country.isalpha() else "IN"
        return cls(what, where or ("India" if country == "IN" else "Anywhere"), int(days) if days.isdigit() else 7,
                   country)


class Source(ABC):
    id: ClassVar[str]
    label: ClassVar[str]
    kind: ClassVar[Kind]
    hosts: ClassVar[frozenset[str]]
    ttl: ClassVar[timedelta]
    # The company's own post: the apply link goes straight to the employer (preferred when the same job is twice).
    direct: ClassVar[bool] = False
    attribution: ClassVar[Attribution | None] = None
    # Only a snippet of each post (the full text is on the original page).
    snippet_only: ClassVar[bool] = False

    def configured(self) -> bool:
        return True

    def quota(self) -> Budget | None:
        """The API's call limits, for sources that have them (shared by every user of this server)."""
        return None

    def keys(self) -> list[str]:
        """Boards or feed variants to fetch (not used by search sources)."""
        return ["all"]

    async def fetch(self, http: FeedClient, key: str, known: set[str]) -> list[Posting]:
        """Every current post of one board or feed variant. `known`: external ids whose full text is already
        cached (a source that needs a second call per post for its text can skip those)."""
        raise NotImplementedError

    async def search(self, http: FeedClient, query: SearchQuery) -> list[Posting]:
        raise NotImplementedError

    def calls_for(self, key: str) -> int:
        """How many API calls one fetch or search of `key` makes, for the quota (search sources)."""
        return 1
