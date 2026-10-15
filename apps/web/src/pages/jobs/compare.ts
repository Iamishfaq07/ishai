import type { JobDetail, JobTrackerEntry } from "@orbit/types";
import { LEVELS, STATUS_LABEL, WORKPLACES, employmentLabel, postedAgo, shortDate, sourceLine } from "./model";

/** The most jobs side by side: more than three columns don't fit a phone, or a decision. */
export const MAX_COMPARE = 3;

/** One job to compare: the tracker entry, and its listing's detail when Orbit still has the post (null if not). */
export type CompareJob = { entry: JobTrackerEntry; detail: JobDetail | null };

/** One row: a value per job (null where the post doesn't say), and which jobs are best on it (none when it's a
 *  tie, or there's nothing to rank). */
export type CompareRow = { label: string; values: Array<string | null>; best: number[] };

const VERDICT_RANK = { Strong: 3, Good: 2, Stretch: 1 } as const;

/** Indexes of the highest score, only when the scores differ (a tie, or one job alone, picks nothing). */
function highest(scores: Array<number | null>): number[] {
  const known = scores.filter((s): s is number => s !== null);
  if (known.length < 2) return [];
  const top = Math.max(...known);
  if (known.every((s) => s === top)) return [];
  return scores.flatMap((s, i) => (s === top ? [i] : []));
}

function requirementsMet(d: JobDetail | null): { text: string; ratio: number } | null {
  const reqs = d?.fit?.requirements ?? [];
  if (!reqs.length) return null;
  const met = reqs.filter((r) => r.status === "met").length;
  const partly = reqs.filter((r) => r.status === "partial").length;
  return { text: `${met} of ${reqs.length} met${partly ? `, ${partly} partly` : ""}`, ratio: (met + partly / 2) / reqs.length };
}

/** The comparison, row by row, from what each post states and what Orbit worked out (match, fit check). */
export function compareRows(jobs: CompareJob[], now: number = Date.now()): CompareRow[] {
  const job = (j: CompareJob) => j.detail?.job ?? null;
  const row = (label: string, values: Array<string | null>, scores?: Array<number | null>): CompareRow => ({
    label,
    values,
    best: scores ? highest(scores) : [],
  });
  const matches = jobs.map((j) => job(j)?.match ?? null);
  const fits = jobs.map((j) => j.detail?.fit ?? null);
  const reqs = jobs.map((j) => requirementsMet(j.detail));
  const rows: CompareRow[] = [
    row("Location", jobs.map((j) => job(j)?.place || j.entry.location || null)),
    row("Work mode", jobs.map((j) => WORKPLACES.find((w) => w.id === job(j)?.workplace)?.label ?? null)),
    row("Job type", jobs.map((j) => employmentLabel(job(j)?.employment_type ?? null))),
    row("Level", jobs.map((j) => {
      const level = LEVELS.find((l) => l.id === job(j)?.level)?.label;
      return [level, job(j)?.experience].filter(Boolean).join(" · ") || null;
    })),
    row("Salary", jobs.map((j) => job(j)?.salary ?? null)),
    row("Skills match", matches.map((m) => (m ? `${m.score} / 100` : null)), matches.map((m) => m?.score ?? null)),
    row("Skills you're missing", matches.map((m) => (m ? (m.missing.length ? m.missing.slice(0, 4).join(", ") : "None") : null)),
      matches.map((m) => (m ? -m.missing.length : null))),
    row("Fit check", fits.map((f) => (f ? f.verdict : null)), fits.map((f) => (f ? VERDICT_RANK[f.verdict] : null))),
    row("Requirements", reqs.map((r) => r?.text ?? null), reqs.map((r) => r?.ratio ?? null)),
    row("Your stage", jobs.map((j) => STATUS_LABEL[j.entry.status] + (j.entry.next_at ? ` · next ${shortDate(j.entry.next_at)}` : ""))),
    row("Posted", jobs.map((j) => {
      const at = job(j)?.posted_at ?? j.entry.posted_at;
      return at ? postedAgo(at, now) : null;
    })),
    row("Source", jobs.map((j) => (job(j) ? sourceLine(job(j)!) : j.entry.live ? null : "No longer in the feed"))),
  ];
  // A row nobody's post fills says nothing: leave it out.
  return rows.filter((r) => r.values.some((v) => v !== null));
}
