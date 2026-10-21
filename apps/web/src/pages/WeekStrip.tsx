import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

interface Week { applied: number; sent_by_orbit: number; interviewing: number; offers: number; closed: number; hired: number; upcoming_interviews: number }

/**
 * This week at a glance on Today (GET /v1/jobs/week): the same counts as the weekly progress email, from what the
 * candidate and Orbit recorded. Hidden until there's something to count.
 */
export function WeekStrip() {
  const week = useAsync(() => api.call<Week>("/v1/jobs/week"), [], "career-week");
  const w = week.data;
  if (!w) return null;
  const tiles = [
    ["Applied this week", w.applied + w.sent_by_orbit, w.sent_by_orbit ? `${w.sent_by_orbit} sent by Orbit` : "recorded by you"],
    ["Moved to interviews", w.interviewing, "this week"],
    ["Interviews ahead", w.upcoming_interviews, "next 7 days"],
    ["Offers", w.offers + w.hired, w.hired ? `${w.hired} hired` : "this week"],
  ] as const;
  if (tiles.every(([, n]) => !n)) return null;
  return <dl aria-label="This week" className="grid grid-cols-2 gap-3 sm:grid-cols-4">{tiles.map(([label, n, note]) =>
    <div key={label} className="workspace-panel p-4"><dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{n}</dd>
      <dd className="text-xs text-zinc-500 dark:text-zinc-400">{note}</dd></div>)}</dl>;
}
