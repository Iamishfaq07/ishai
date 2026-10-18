// When the runner next asks Orbit for an application. Pure, so it's tested on its own.
import type { ApplyStatus } from "./contract";

export const MIN = 60_000;
/** chrome.alarms won't fire sooner than 30 s. */
export const MIN_DELAY = 30_000;

const clamp = (ms: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, ms));

/** Delay until the next_due time, kept between lo and hi. */
function untilDue(status: ApplyStatus | null, now: number, lo: number, hi: number, fallback: number): number {
  const due = status?.next_due_at ? Date.parse(status.next_due_at) : NaN;
  return clamp(Number.isFinite(due) ? due - now : fallback, lo, hi);
}

export type Moment =
  /** Orbit says auto-apply is paused (or quiet hours). */
  | { kind: "paused"; status: ApplyStatus }
  /** Today's limit reached. */
  | { kind: "limit"; status: ApplyStatus; retryAfterMs?: number }
  /** Nothing due (204); the server's Retry-After when it gave one. */
  | { kind: "idle"; status: ApplyStatus | null; retryAfterMs?: number }
  /** A packet that can't start yet. */
  | { kind: "not_before"; at: number }
  /** An application just finished: a person's gap before the next one. */
  | { kind: "after_apply" }
  /** Orbit or the network failed; `failures` in a row. */
  | { kind: "error"; failures: number };

export function nextDelay(m: Moment, now: number, random = Math.random): number {
  switch (m.kind) {
    case "paused":
      return untilDue(m.status, now, 5 * MIN, 60 * MIN, 15 * MIN);
    case "limit":
      return m.retryAfterMs !== undefined ? clamp(m.retryAfterMs, 15 * MIN, 12 * 60 * MIN) : untilDue(m.status, now, 15 * MIN, 6 * 60 * MIN, 60 * MIN);
    case "idle":
      return m.retryAfterMs !== undefined ? clamp(m.retryAfterMs, MIN_DELAY, 30 * MIN) : untilDue(m.status, now, 2 * MIN, 30 * MIN, 10 * MIN);
    case "not_before":
      return clamp(m.at - now, MIN_DELAY, 6 * 60 * MIN);
    case "after_apply":
      // Minutes, not seconds, between applications.
      return (3 + random() * 4) * MIN;
    case "error":
      return clamp(MIN * 2 ** Math.max(0, m.failures - 1), MIN, 30 * MIN);
  }
}
