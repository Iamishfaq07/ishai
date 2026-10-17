"""Keeping the job refresh a small background load, wherever the API runs.

The refresh's CPU work (reading posts' HTML and their skills, writing them to the database) runs next to requests.
Unpaced on a small server (a tenth of one CPU, the worst case it's measured against) it starved them: a health check
that waits seconds gets the server restarted, and every restart starts the refresh again. Where CPU is billed by use,
unpaced work is also cost. So the work is paced to `jobs_cpu_share` of one CPU:

- in a worker thread, `Pace.tick()` after each item sleeps whenever the thread's own CPU time runs ahead of that
  share of the wall clock (its own CPU time, so it adapts to the machine: a fast one sleeps more often);
- on the event loop, `breathe()` after each chunk of work sleeps long enough to keep that chunk to the same share.

Unpaced (share 0) in tests, so the suite doesn't wait.
"""

import asyncio
import time
from collections.abc import Callable, Iterable

from orbit_api.config import get_settings

MAX_SLEEP_S = 2.0  # one pause at most; the next tick pauses again if the work is still ahead


class Pace:
    """CPU pacing for the thread that creates it."""

    def __init__(self, share: float | None = None) -> None:
        self.share = get_settings().jobs_pace if share is None else share
        self._cpu0 = time.thread_time()
        self._wall0 = time.monotonic()

    def ahead_s(self) -> float:
        """How far this thread's CPU time is ahead of its share of the wall clock, in seconds of wall clock."""
        if not self.share:
            return 0.0
        return (time.thread_time() - self._cpu0) / self.share - (time.monotonic() - self._wall0)

    def tick(self) -> None:
        ahead = self.ahead_s()
        if ahead > 0.01:
            time.sleep(min(ahead, MAX_SLEEP_S))


def paced_map[T, R](fn: Callable[[T], R | None], items: Iterable[T]) -> list[R]:
    """`fn` over `items` in a worker thread, paced, keeping the results that aren't None."""
    pace = Pace()
    out: list[R] = []
    for item in items:
        result = fn(item)
        if result is not None:
            out.append(result)
        pace.tick()
    return out


async def breathe(cpu_before: float, share: float | None = None) -> None:
    """After a chunk of event-loop work that started when this thread's CPU time was `cpu_before`: sleep so the chunk
    took no more than the share. Always yields, so requests waiting for the loop go first."""
    share = get_settings().jobs_pace if share is None else share
    used = time.thread_time() - cpu_before
    await asyncio.sleep(min(used / share - used, MAX_SLEEP_S) if share and used > 0 else 0)
