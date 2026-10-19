import type { JobTrackerEntry } from "@orbit/types";
import { isManual } from "./model";

/**
 * Your search, in numbers (after career-ops' funnel stats and Huntr's metrics): from the tracker alone. Of the jobs
 * you applied to, how many answered (moved on, or said no), how many reached an interview or an offer, how long an
 * answer took, which channel works, and what has gone quiet. Nothing is inferred beyond what the tracker says.
 */

// The company's own applicant tracking system: applying here goes straight to the employer.
const DIRECT = new Set(["greenhouse", "lever", "ashby", "smartrecruiters"]);
const DAY = 86_400_000;
export const QUIET_DAYS = 14;

export type Channel = "Company careers pages" | "Job boards" | "Found elsewhere";

export interface ChannelStats {
  channel: Channel;
  applied: number;
  heardBack: number;
  interviews: number;
}

export interface SearchInsights {
  applied: number;
  heardBack: number;
  interviews: number;
  offers: number;
  /** Shares of `applied`; null with nothing applied to. */
  responseRate: number | null;
  interviewRate: number | null;
  /** Days from applying to the answer, the middle one; null until something answered. */
  medianDaysToHear: number | null;
  /** Applied over QUIET_DAYS ago, no answer, nothing booked: worth a follow-up. */
  quiet: number;
  channels: ChannelStats[];
  /** Applications per week, oldest first, the last eight weeks (weeks start on Monday). */
  weeks: Array<{ start: string; count: number }>;
}

export function channelOf(e: Pick<JobTrackerEntry, "listing_id" | "source">): Channel {
  if (isManual(e)) return "Found elsewhere";
  return DIRECT.has(e.source) ? "Company careers pages" : "Job boards";
}

function monday(t: number): number {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
}

/** Less than this between applying and the answer: both were entered together, not waited for. */
const MEASURED_MS = 60_000;

export function searchInsights(entries: JobTrackerEntry[], now: number = Date.now()): SearchInsights {
  const applied = entries.filter((e) => e.applied_at);
  const answered = (e: JobTrackerEntry) => ["interviewing", "offer", "hired", "rejected"].includes(e.status);
  const interviewed = (e: JobTrackerEntry) => ["interviewing", "offer", "hired"].includes(e.status);
  const heard = applied.filter(answered);
  // A wait is only measured when the answer came after the application. A job added straight in as interviewing
  // (or offer) gets both dates at once: that's no wait at all, and it made "Typical wait: 0 days" before any reply.
  const waits = heard
    .map((e) => Date.parse(e.status_at) - Date.parse(e.applied_at!))
    .filter((ms) => Number.isFinite(ms) && ms >= MEASURED_MS)
    .map((ms) => ms / DAY)
    .sort((a, b) => a - b);
  const median = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2]! : (waits[waits.length / 2 - 1]! + waits[waits.length / 2]!) / 2) : null;
  const channels = (["Company careers pages", "Job boards", "Found elsewhere"] as const)
    .map((channel) => {
      const mine = applied.filter((e) => channelOf(e) === channel);
      return { channel, applied: mine.length, heardBack: mine.filter(answered).length, interviews: mine.filter(interviewed).length };
    })
    .filter((c) => c.applied > 0);
  const thisWeek = monday(now);
  const weeks = Array.from({ length: 8 }, (_, i) => thisWeek - (7 - i) * 7 * DAY).map((start) => ({
    start: new Date(start).toISOString().slice(0, 10),
    count: applied.filter((e) => {
      const t = Date.parse(e.applied_at!);
      return t >= start && t < start + 7 * DAY;
    }).length,
  }));
  return {
    applied: applied.length,
    heardBack: heard.length,
    interviews: applied.filter(interviewed).length,
    offers: applied.filter((e) => ["offer", "hired"].includes(e.status)).length,
    responseRate: applied.length ? heard.length / applied.length : null,
    interviewRate: applied.length ? applied.filter(interviewed).length / applied.length : null,
    medianDaysToHear: median === null ? null : Math.round(median),
    quiet: applied.filter((e) => e.status === "applied" && !e.next_at && now - Date.parse(e.applied_at!) > QUIET_DAYS * DAY).length,
    channels,
    weeks,
  };
}
