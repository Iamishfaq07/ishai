"""The job cache: listings in the database, refreshed in the background, never on the request's clock.

- A feed request calls `ensure_fresh`: any source with a board (or a search) past its time-to-live gets one
  background refresh, unless one is already running for that source (single-flight, in-process: one API instance,
  docs/DECISIONS.md D12). The request serves what's cached meanwhile; the page polls while `refreshing`.
- `running_refresher` (in the app lifespan) re-checks every REFRESH_EVERY, but only while someone has used the feed
  lately, so an idle server doesn't keep calling the providers just because a cron keeps it awake.
- Each board is fetched at most once per its source's `ttl` (4-6 hours for company boards, daily for feeds). A
  failure backs off (BACKOFF, or the provider's Retry-After on a 429) and leaves the cached listings as they were.
- A successful board fetch replaces that board's listings: posts no longer on it are gone. Searches only add.
  Posts older than 30 days are dropped, and searches nobody asked for in a week are forgotten.
- Quota'd APIs (Adzuna, JSearch) take their calls from a shared count kept in the database, stopping at 90%.
"""

import asyncio
import contextlib
import logging
import time
import weakref
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.job_portal.http import FeedClient, RateLimited, SourceError
from orbit_api.job_portal.postings import MAX_AGE, Posting, listing_id, normalize
from orbit_api.job_portal.skills import listing_keywords
from orbit_api.job_portal.sources import Source, allowed_hosts, enabled_sources
from orbit_api.job_portal.sources.base import SearchQuery
from orbit_api.models import JobListing, JobSourceState

log = logging.getLogger(__name__)

POLITE_DELAY_S = 1.0  # between two boards of the same source
# Boards fetched and parsed at once, across all sources. The biggest are ~10 MB of JSON, and the free Render
# instance has 512 MB next to live sessions, so a first refresh of every source mustn't hold them all together.
BOARD_SLOTS = 2
BACKOFF = (timedelta(minutes=30), timedelta(hours=2), timedelta(hours=6))
REFRESH_EVERY_S = 15 * 60
ACTIVE_FOR = timedelta(hours=48)  # the loop refreshes only while the feed was used this recently
SEARCHES_PER_RUN = 6  # per source per run: a few titles per profile, shared between users
SEARCH_KEEP = timedelta(days=7)
QUOTA_KEY = "*"

_tasks: dict[str, asyncio.Task[None]] = {}
_pending: dict[str, dict[str, SearchQuery]] = defaultdict(dict)
_minute_calls: dict[str, deque[float]] = defaultdict(deque)
_last_feed_at: float | None = None
_slots_by_loop: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = weakref.WeakKeyDictionary()
# Bumped whenever listings change, so ranked feeds cached in memory (ranking.py) know to recompute.
_version = 0
# Tests swap in an httpx.MockTransport: no refresh ever reaches the network in the suite.
transport: httpx.AsyncBaseTransport | None = None


def version() -> int:
    return _version


def _board_slots() -> asyncio.Semaphore:
    """BOARD_SLOTS for the running loop (tests run several loops; a semaphore belongs to the first that waits on it)."""
    loop = asyncio.get_running_loop()
    slots = _slots_by_loop.get(loop)
    if slots is None:
        slots = _slots_by_loop[loop] = asyncio.Semaphore(BOARD_SLOTS)
    return slots


def _now() -> datetime:
    return datetime.now(UTC)


def aware(when: datetime | None) -> datetime | None:
    """SQLite hands datetimes back without their zone; they were stored as UTC."""
    return when.replace(tzinfo=UTC) if when is not None and when.tzinfo is None else when


def due(state: JobSourceState | None, ttl: timedelta, now: datetime) -> bool:
    if state is None:
        return True
    retry = aware(state.retry_after)
    if retry is not None and retry > now:
        return False
    last = aware(state.last_success_at)
    return last is None or now - last >= ttl


async def _state(db: AsyncSession, source_id: str, key: str) -> JobSourceState:
    row = await db.scalar(select(JobSourceState).where(JobSourceState.source == source_id,
                                                       JobSourceState.key == key))
    if row is None:
        row = JobSourceState(source=source_id, key=key[:160])
        db.add(row)
        await db.flush()
    return row


async def _record(source_id: str, key: str, *, ok: bool, error: str | None = None, listings: int = 0,
                  retry_after_s: float | None = None, now: datetime | None = None) -> None:
    now = now or _now()
    async with sessionmaker()() as db:
        state = await _state(db, source_id, key)
        state.last_attempt_at = now
        if ok:
            state.last_success_at, state.last_error, state.failures = now, None, 0
            state.retry_after, state.listings = None, listings
        else:
            state.failures = (state.failures or 0) + 1
            state.last_error = (error or "failed")[:300]
            wait = timedelta(seconds=retry_after_s) if retry_after_s else BACKOFF[min(state.failures, len(BACKOFF)) - 1]
            state.retry_after = now + wait
        await db.commit()


# ---- writing listings --------------------------------------------------------------------------------------------

def _prepare(postings: list[Posting], hashes: dict[str, str | None], now: datetime) -> list[dict[str, Any]]:
    """Normalized rows, with the post's skills read from its text when the text is new or changed (CPU work: this
    runs in a thread). `keywords` None means "unchanged, keep what's stored"."""
    rows = []
    seen: set[str] = set()
    for p in postings:
        row = normalize(p, now)
        if row is None or row["id"] in seen:
            continue
        seen.add(row["id"])
        row["partial"] = p.partial
        unchanged = hashes.get(row["id"]) == row["text_hash"]
        row["keywords"] = None if unchanged or p.partial else listing_keywords(row["title"], row["description"],
                                                                               row["company"])
        rows.append(row)
    return rows


async def _store(source_id: str, board: str | None, rows: list[dict[str, Any]], now: datetime) -> int:
    """Insert or update the rows; with `board`, also delete that board's listings that weren't in this fetch."""
    global _version
    async with sessionmaker()() as db:
        ids = [r["id"] for r in rows]
        existing: dict[str, JobListing] = {}
        for i in range(0, len(ids), 500):
            for found in (await db.scalars(select(JobListing).where(JobListing.id.in_(ids[i:i + 500])))).all():
                existing[found.id] = found
        for r in rows:
            partial = r.pop("partial")
            keywords = r.pop("keywords")
            row = existing.get(r["id"])
            if row is None:
                db.add(JobListing(**r, keywords=keywords if keywords is not None else [], fetched_at=now))
                continue
            keep = partial and bool(row.description)  # listed without its text: keep the text and links we have
            for name, value in r.items():
                if keep and name in ("url", "apply_url", "description", "snippet", "text_hash", "level", "exp_min",
                                     "exp_max", "visa", "relocation"):
                    continue
                setattr(row, name, value)
            if keywords is not None and not keep:
                row.keywords = keywords
            row.fetched_at = now
        if board is not None:
            stale = delete(JobListing).where(JobListing.source == source_id, JobListing.board == board)
            if ids:
                stale = stale.where(JobListing.id.not_in(ids))
            await db.execute(stale)
        await db.commit()
    _version += 1
    return len(rows)


async def _ingest(source_id: str, board: str | None, postings: list[Posting]) -> int:
    now = _now()
    ids = list({listing_id(p.source, p.external_id) for p in postings})
    hashes: dict[str, str | None] = {}
    async with sessionmaker()() as db:
        for i in range(0, len(ids), 500):
            hashes.update((await db.execute(select(JobListing.id, JobListing.text_hash)
                                            .where(JobListing.id.in_(ids[i:i + 500])))).tuples().all())
    rows = await asyncio.to_thread(_prepare, postings, hashes, now)
    return await _store(source_id, board, rows, now)


async def purge(now: datetime | None = None) -> None:
    """Drop posts older than 30 days, search results not seen for a week, and searches nobody asks for anymore."""
    global _version
    now = now or _now()
    searches = [s.id for s in enabled_sources() if s.kind == "search"]
    async with sessionmaker()() as db:
        await db.execute(delete(JobListing).where(JobListing.posted_at < now - MAX_AGE))
        if searches:
            await db.execute(delete(JobListing).where(JobListing.source.in_(searches),
                                                      JobListing.fetched_at < now - SEARCH_KEEP))
            await db.execute(delete(JobSourceState).where(JobSourceState.source.in_(searches),
                                                          JobSourceState.key != QUOTA_KEY,
                                                          JobSourceState.requested_at < now - SEARCH_KEEP))
        await db.commit()
    _version += 1


# ---- boards and feeds ----------------------------------------------------------------------------------------------

async def refresh_source(source: Source, *, keys: Iterable[str] | None = None, delay_s: float = POLITE_DELAY_S,
                         client_transport: httpx.AsyncBaseTransport | None = None) -> int:
    """Fetch a board or feed source's boards that are due (or exactly `keys`). Returns the listings written."""
    now = _now()
    async with sessionmaker()() as db:
        states = {s.key: s for s in (await db.scalars(select(JobSourceState)
                                                      .where(JobSourceState.source == source.id))).all()}
    todo = list(keys) if keys is not None else [k for k in source.keys() if due(states.get(k), source.ttl, now)]
    written = 0
    async with FeedClient(allowed_hosts(), client_transport or transport) as http:
        for i, key in enumerate(todo):
            if i and delay_s:
                await asyncio.sleep(delay_s)
            written += await _refresh_board(source, http, key)
    await purge()
    return written


async def _refresh_board(source: Source, http: FeedClient, key: str) -> int:
    async with sessionmaker()() as db:
        known = set((await db.scalars(select(JobListing.external_id).where(
            JobListing.source == source.id, JobListing.board == key, JobListing.description != ""))).all())
    try:
        async with _board_slots():
            postings = await source.fetch(http, key, known)
            n = await _ingest(source.id, key, postings)
            del postings  # let it go before the next board takes the slot
    except RateLimited as e:
        log.warning("jobs: %s/%s rate limited, waiting %.0fs", source.id, key, e.retry_after_s)
        await _record(source.id, key, ok=False, error=str(e), retry_after_s=e.retry_after_s)
        return 0
    except SourceError as e:
        log.warning("jobs: %s/%s failed: %s", source.id, key, e)
        await _record(source.id, key, ok=False, error=str(e))
        return 0
    except Exception as e:  # a parser bug must not stop the other boards
        log.exception("jobs: %s/%s broke", source.id, key)
        await _record(source.id, key, ok=False, error=type(e).__name__)
        return 0
    await _record(source.id, key, ok=True, listings=n)
    log.info("jobs: %s/%s refreshed, %d listings", source.id, key, n)
    return n


# ---- searches and quotas ---------------------------------------------------------------------------------------------

async def take_quota(db: AsyncSession, source: Source, calls: int, now: datetime | None = None) -> bool:
    """Count `calls` against the source's quota if they fit under 90% of every limit; False (nothing counted) if not."""
    quota = source.quota()
    if quota is None:
        return True
    now = now or _now()
    row = await _state(db, source.id, QUOTA_KEY)
    day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
    if row.day != day:
        row.day, row.day_calls = day, 0
    if row.month != month:
        row.month, row.month_calls = month, 0
    recent = _minute_calls[source.id]
    clock = time.monotonic()
    while recent and clock - recent[0] > 60:
        recent.popleft()
    for used, limit in ((row.day_calls, quota.per_day), (row.month_calls, quota.per_month), (len(recent),
                                                                                            quota.per_minute)):
        if limit is not None and used + calls > limit * quota.stop_at:
            await db.commit()
            return False
    row.day_calls += calls
    row.month_calls += calls
    recent.extend([clock] * calls)
    await db.commit()
    return True


async def refresh_searches(source: Source, queries: Iterable[SearchQuery], *,
                           client_transport: httpx.AsyncBaseTransport | None = None) -> int:
    """Run the due searches among `queries` (at most SEARCHES_PER_RUN), within the source's quota."""
    now = _now()
    written = 0
    picked = list({q.key(): q for q in queries}.values())[:SEARCHES_PER_RUN]
    async with FeedClient(allowed_hosts(), client_transport or transport) as http:
        for query in picked:
            key = query.key()
            async with sessionmaker()() as db:
                state = await _state(db, source.id, key)
                state.requested_at = now
                await db.commit()
                if not due(state, source.ttl, now):
                    continue
                if not await take_quota(db, source, source.calls_for(key), now):
                    log.info("jobs: %s quota reached; skipping searches until it resets", source.id)
                    break
            try:
                n = await _ingest(source.id, None, await source.search(http, query))
            except RateLimited as e:
                await _record(source.id, key, ok=False, error=str(e), retry_after_s=e.retry_after_s)
                break
            except SourceError as e:
                log.warning("jobs: %s search %r failed: %s", source.id, key, e)
                await _record(source.id, key, ok=False, error=str(e))
                continue
            except Exception as e:
                log.exception("jobs: %s search %r broke", source.id, key)
                await _record(source.id, key, ok=False, error=type(e).__name__)
                continue
            await _record(source.id, key, ok=True, listings=n)
            written += n
    return written


# ---- single-flight background refreshes ----------------------------------------------------------------------------

def refreshing(source_id: str) -> bool:
    task = _tasks.get(source_id)
    return task is not None and not task.done()


def _kick(source_id: str, work: Callable[[], Awaitable[Any]]) -> bool:
    """Start `work` in the background unless this source is already refreshing."""
    if refreshing(source_id):
        return False

    async def run() -> None:
        try:
            await work()
        except Exception:
            log.exception("jobs: background refresh of %s failed", source_id)

    _tasks[source_id] = asyncio.create_task(run(), name=f"jobs-refresh-{source_id}")
    return True


def _kick_searches(source: Source) -> None:
    async def drain() -> None:
        while _pending[source.id]:
            batch = list(_pending[source.id].values())
            _pending[source.id].clear()
            await refresh_searches(source, batch)

    _kick(source.id, drain)


async def ensure_fresh(db: AsyncSession, queries: list[SearchQuery]) -> None:
    """Called by every feed request: start a background refresh for each source with something due. Never waits."""
    global _last_feed_at
    _last_feed_at = time.monotonic()
    if not get_settings().jobs_refresh_on:
        return
    now = _now()
    states = {(s.source, s.key): s for s in (await db.scalars(select(JobSourceState))).all()}
    for source in enabled_sources():
        if source.kind == "search":
            for q in queries:
                state = states.get((source.id, q.key()))
                stale_ask = state is None or (aware(state.requested_at) or now - SEARCH_KEEP) < now - timedelta(hours=6)
                if due(state, source.ttl, now) or stale_ask:
                    _pending[source.id][q.key()] = q
            if _pending[source.id]:
                _kick_searches(source)
        elif any(due(states.get((source.id, k)), source.ttl, now) for k in source.keys()):
            _kick(source.id, lambda s=source: refresh_source(s))  # type: ignore[misc]


@dataclass
class SourceStatus:
    id: str
    label: str
    kind: str
    listings: int
    last_success_at: datetime | None
    refreshing: bool
    failing: bool


async def statuses(db: AsyncSession) -> list[SourceStatus]:
    counts = dict((await db.execute(select(JobListing.source, func.count())
                                    .group_by(JobListing.source))).tuples().all())
    states = (await db.scalars(select(JobSourceState).where(JobSourceState.key != QUOTA_KEY))).all()
    out = []
    for source in enabled_sources():
        mine = [s for s in states if s.source == source.id]
        last = max((t for s in mine if (t := aware(s.last_success_at)) is not None), default=None)
        failing = bool(mine) and all(s.failures for s in mine)
        out.append(SourceStatus(source.id, source.label, source.kind, int(counts.get(source.id, 0)), last,
                                refreshing(source.id), failing))
    return out


async def _loop(interval_s: float) -> None:
    while True:
        await asyncio.sleep(interval_s)
        if _last_feed_at is None or time.monotonic() - _last_feed_at > ACTIVE_FOR.total_seconds():
            continue
        try:
            async with sessionmaker()() as db:
                since = _now() - ACTIVE_FOR
                keys = (await db.scalars(select(JobSourceState.key).where(
                    JobSourceState.requested_at >= since, JobSourceState.key != QUOTA_KEY))).all()
                await ensure_fresh(db, [SearchQuery.from_key(k) for k in dict.fromkeys(keys)])
        except Exception:
            log.exception("jobs: the refresh loop failed; it tries again next round")


@contextlib.asynccontextmanager
async def running_refresher(interval_s: float = REFRESH_EVERY_S) -> AsyncIterator[None]:
    task = asyncio.create_task(_loop(interval_s)) if get_settings().jobs_refresh_on else None
    try:
        yield
    finally:
        for t in [task, *_tasks.values()]:
            if t is not None and not t.done():
                t.cancel()
        for t in [task, *_tasks.values()]:
            if t is not None:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await t
        _tasks.clear()

