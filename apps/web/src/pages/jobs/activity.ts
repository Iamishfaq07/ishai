import type { JobTrackerEntry } from "@orbit/types";

/**
 * The job search day by day (the contribution-graph view job trackers on GitHub show): one square per day for the
 * last 26 weeks, counting jobs saved, applications sent and moves forward (interview, offer, hired) from the tracker's
 * own dates. Days are the browser's local days.
 */

export const WEEKS = 26;
const DAY = 86_400_000;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface DayCount { saved: number; applied: number; moved: number }

export function activityByDay(entries: JobTrackerEntry[]): Map<string, DayCount> {
  const days = new Map<string, DayCount>();
  const add = (iso: string | null | undefined, k: keyof DayCount) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return;
    const key = dayKey(new Date(t));
    const c = days.get(key) ?? { saved: 0, applied: 0, moved: 0 };
    c[k] += 1; days.set(key, c);
  };
  for (const e of entries) {
    add(e.created_at, "saved");
    add(e.applied_at, "applied");
    if (e.status === "interviewing" || e.status === "offer" || e.status === "hired") add(e.status_at, "moved");
  }
  return days;
}

export const total = (c: DayCount | undefined) => (c ? c.saved + c.applied + c.moved : 0);

/** Columns of 7 days (Monday first), oldest week first, ending with the week containing `now`. */
export function grid(now = new Date()): Date[][] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
  const start = new Date(monday.getTime() - (WEEKS - 1) * 7 * DAY);
  return Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const x = new Date(start); x.setDate(start.getDate() + w * 7 + d); return x;
  }));
}

/** Days in a row with any activity, ending today (or yesterday, so a streak isn't lost before today's first step). */
export function streak(days: Map<string, DayCount>, now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!total(days.get(dayKey(d)))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (total(days.get(dayKey(d)))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/** Sequential bucket 0–4 for a day's count, against the busiest day shown. */
export function level(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!count || !max) return 0;
  const r = count / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}
