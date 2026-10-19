"""Every job source, in the order the feed prefers them when the same job appears twice (company boards first)."""

from orbit_api.config import get_settings
from orbit_api.job_portal.sources.adzuna import Adzuna
from orbit_api.job_portal.sources.ashby import Ashby
from orbit_api.job_portal.sources.base import Attribution, Budget, SearchQuery, Source
from orbit_api.job_portal.sources.greenhouse import Greenhouse
from orbit_api.job_portal.sources.himalayas import Himalayas
from orbit_api.job_portal.sources.jobicy import Jobicy
from orbit_api.job_portal.sources.jsearch import JSearch
from orbit_api.job_portal.sources.lever import Lever
from orbit_api.job_portal.sources.orbit import Orbit
from orbit_api.job_portal.sources.remoteok import RemoteOK
from orbit_api.job_portal.sources.smartrecruiters import SmartRecruiters

__all__ = ["Attribution", "Budget", "SearchQuery", "Source", "all_sources", "allowed_hosts", "enabled_sources",
           "source_named"]

_ALL: tuple[Source, ...] = (Orbit(), Greenhouse(), Lever(), Ashby(), SmartRecruiters(), JSearch(), Adzuna(),
                            Himalayas(), RemoteOK(), Jobicy())
PRIORITY = {s.id: i for i, s in enumerate(_ALL)}


def all_sources() -> tuple[Source, ...]:
    return _ALL


def enabled_sources() -> list[Source]:
    """The sources this server uses: configured (the optional APIs have their keys) and not switched off."""
    off = {x.strip().lower() for x in get_settings().jobs_sources_off.split(",") if x.strip()}
    return [s for s in _ALL if s.id not in off and s.configured()]


def source_named(source_id: str) -> Source | None:
    return next((s for s in _ALL if s.id == source_id), None)


def allowed_hosts() -> frozenset[str]:
    """The only hosts the job feed ever calls."""
    return frozenset(h for s in _ALL for h in s.hosts)
