import type { JobStatus, JobTrackerEntry, OrbitSession } from "@orbit/types";

/**
 * Home's Mission Dashboard: figures counted from the account's own records, never estimated. No readiness score or
 * hiring probability: only what happened (applications by stage, interviews on the calendar, practice done).
 */

/** Home's hello for the hour where the user is: evening ends at midnight (at 2 a.m. it's not "Good evening"). */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18) return "Good evening";
  return "Hello";
}

export const PIPELINE_STAGES: JobStatus[] = ["saved", "applied", "interviewing", "offer"];

/** How many tracked jobs sit at each stage (rejections are counted apart: they aren't "in progress"). */
export function pipeline(entries: JobTrackerEntry[]): { stages: Record<JobStatus, number>; active: number; total: number } {
  const stages = { saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0 } as Record<JobStatus, number>;
  for (const e of entries) stages[e.status] += 1;
  return { stages, active: stages.applied + stages.interviewing + stages.offer, total: entries.length };
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Interviews and follow-ups from today on, soonest first (a rejected job's dates don't count). */
export function upcoming(entries: JobTrackerEntry[], now: number = Date.now(), limit = 4): JobTrackerEntry[] {
  const today = startOfDay(now);
  return entries
    .filter((e) => e.next_at && e.status !== "rejected" && new Date(e.next_at).getTime() >= today)
    .sort((a, b) => a.next_at!.localeCompare(b.next_at!))
    .slice(0, limit);
}

/** "Today", "Tomorrow", "In 5 days" for a date from today on. */
export function countdown(iso: string, now: number = Date.now()): string {
  const days = Math.round((startOfDay(new Date(iso).getTime()) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** Practice in the last 7 days: finished mock interviews, and finished live sessions. */
export function lastWeek(sessions: OrbitSession[], now: number = Date.now()): { mocks: number; lives: number } {
  const since = now - 7 * 86_400_000;
  let mocks = 0;
  let lives = 0;
  for (const s of sessions) {
    if (s.status !== "ended") continue;
    const at = new Date(s.started_at ?? s.created_at).getTime();
    if (at < since) continue;
    if (s.type === "mock") mocks += 1;
    else lives += 1;
  }
  return { mocks, lives };
}

/** The header's one line: where the search stands, in words, from the same counts. */
export function summaryLine(entries: JobTrackerEntry[], now: number = Date.now()): string {
  const { stages, active } = pipeline(entries);
  const next = upcoming(entries, now, 1)[0];
  const parts: string[] = [];
  if (active) parts.push(`${active} application${active === 1 ? "" : "s"} in progress`);
  else if (stages.saved) parts.push(`${stages.saved} saved job${stages.saved === 1 ? "" : "s"} to apply to`);
  if (stages.offer) parts.push(`${stages.offer} offer${stages.offer === 1 ? "" : "s"}`);
  if (next?.next_at) parts.push(`next date ${countdown(next.next_at, now).toLowerCase()} (${next.company})`);
  return parts.length ? parts.join(" · ") : "Nothing tracked yet. Save a job you like and it shows up here.";
}
