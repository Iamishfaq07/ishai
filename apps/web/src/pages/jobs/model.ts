// Jobs AI's plain logic (no React): labels, "posted 3h ago", the match colours, the tracker's columns, and the small
// list edits the profile page makes. Kept here so it's unit-tested (model.test.ts).
import type {
  JobEmploymentType,
  JobLevel,
  JobListing,
  JobPostedWithin,
  JobPrefs,
  JobProfile,
  JobStatus,
  JobTrackerEntry,
  JobWorkplace,
} from "@orbit/types";

export const STATUSES: JobStatus[] = ["saved", "applied", "interviewing", "offer", "rejected"];

export const STATUS_LABEL: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Not this time",
};

/** The tracker column's accent (status colours stay Tailwind's own, docs/DESIGN.md). */
export const STATUS_TONE: Record<JobStatus, string> = {
  saved: "bg-zinc-500/10 text-zinc-700 ring-zinc-500/20 dark:text-zinc-300",
  applied: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
  interviewing: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  offer: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  rejected: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
};

export const WORKPLACES: Array<{ id: JobWorkplace; label: string }> = [
  { id: "onsite", label: "In office" },
  { id: "hybrid", label: "Hybrid" },
  { id: "remote", label: "Remote" },
];

export const JOB_TYPES: Array<{ id: JobEmploymentType; label: string }> = [
  { id: "full_time", label: "Full-time" },
  { id: "part_time", label: "Part-time" },
  { id: "contract", label: "Contract" },
  { id: "internship", label: "Internship" },
];

export const LEVELS: Array<{ id: JobLevel; label: string; hint: string }> = [
  { id: "fresher", label: "Fresher", hint: "Student, or under a year" },
  { id: "junior", label: "Junior", hint: "1-3 years" },
  { id: "mid", label: "Mid-level", hint: "3-6 years" },
  { id: "senior", label: "Senior", hint: "6+ years" },
];

export const POSTED_WITHIN: Array<{ days: JobPostedWithin; label: string; short: string }> = [
  { days: 1, label: "Last 24 hours", short: "24h" },
  { days: 3, label: "Last 3 days", short: "3 days" },
  { days: 7, label: "Last 7 days", short: "7 days" },
  { days: 30, label: "Last 30 days", short: "30 days" },
];

export function employmentLabel(t: JobEmploymentType | null): string | null {
  return t ? (JOB_TYPES.find((x) => x.id === t)?.label ?? null) : null;
}

/** "Just now", "3h ago", "2 days ago", "3 weeks ago". */
export function postedAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 3600) return s < 600 ? "Just now" : `${Math.floor(s / 60)} min ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return d === 1 ? "Yesterday" : `${d} days ago`;
  return `${Math.floor(d / 7)} weeks ago`;
}

/** Posted in the last day: the card says "New". */
export function isNew(iso: string, now: number = Date.now()): boolean {
  return now - new Date(iso).getTime() < 24 * 3600 * 1000;
}

/** The match badge's colour: strong, good, partial, weak. */
export function matchTone(score: number): string {
  return score >= 80
    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
    : score >= 65
      ? "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300"
      : score >= 45
        ? "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300"
        : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300";
}

export const VERDICT_TONE: Record<"Strong" | "Good" | "Stretch", string> = {
  Strong: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  Good: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  Stretch: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300",
};

/** One short line of facts for the card: "Full-time · 3-5 years · ₹24L – ₹36L a year". */
export function factsLine(job: Pick<JobListing, "employment_type" | "experience" | "salary">): string {
  return [employmentLabel(job.employment_type), job.experience, job.salary].filter(Boolean).join(" · ");
}

/** A job's key facts for its own page, only those the post states: [label, value]. */
export function jobFacts(
  job: Pick<JobListing, "company" | "place" | "workplace" | "employment_type" | "level" | "experience" | "salary">,
): Array<[string, string]> {
  const facts: Array<[string, string | null | undefined]> = [
    ["Company", job.company],
    ["Location", job.place],
    ["Work mode", WORKPLACES.find((w) => w.id === job.workplace)?.label],
    ["Job type", employmentLabel(job.employment_type)],
    ["Level", LEVELS.find((l) => l.id === job.level)?.label],
    ["Experience", job.experience],
    ["Salary", job.salary],
  ];
  return facts.filter((f): f is [string, string] => Boolean(f[1]));
}

/** Where the job came from, in words: the company's own careers page, or the feed that must be credited. */
export function sourceLine(job: Pick<JobListing, "direct" | "source_label" | "company" | "attribution">): string {
  if (job.direct) return `From ${job.company}'s careers page`;
  return job.attribution ? `via ${job.attribution.label}` : `via ${job.source_label}`;
}

/** Add a typed item to a list (trimmed, no case-insensitive duplicates, at most `max`). */
export function addItem(list: string[], raw: string, max = 25): string[] {
  const items = raw
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out = [...list];
  for (const item of items) {
    if (out.length >= max) break;
    if (!out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item);
  }
  return out;
}

export function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/** Work modes: at least one stays on (none would show nothing). */
export function toggleWorkplace(list: JobWorkplace[], mode: JobWorkplace): JobWorkplace[] {
  const next = toggle(list, mode);
  return next.length ? next : list;
}

/** What the profile looks for, in a sentence ("Backend Engineer, Platform Engineer · Bengaluru or remote · 3 years"). */
export function profileSummary(prefs: JobPrefs): string {
  const titles = prefs.titles.slice(0, 2).join(", ") + (prefs.titles.length > 2 ? ` +${prefs.titles.length - 2}` : "");
  const cities = prefs.locations.filter((c) => c !== "India");
  const remoteToo = prefs.workplace.includes("remote");
  const onlyRemote = prefs.workplace.length === 1 && remoteToo;
  const where = onlyRemote
    ? "Remote"
    : cities.length
      ? `${cities.slice(0, 2).join(", ")}${remoteToo ? " or remote" : ""}`
      : `Anywhere in India${remoteToo ? " or remote" : ""}`;
  const years = prefs.years !== null ? `${Math.round(prefs.years * 10) / 10} years` : (LEVELS.find((l) => l.id === prefs.level)?.label ?? null);
  return [titles || "Any role", where, years].filter(Boolean).join(" · ");
}

/**
 * A short fingerprint of what the feed is matched to (the profile and its resume), for the feed's cache key: a page
 * opened after the profile changed asks for a fresh feed instead of showing the old one first.
 */
export function profileStamp(profile: Pick<JobProfile, "prefs" | "resume">): string {
  const text = JSON.stringify([profile.prefs, profile.resume?.id ?? null]);
  let h = 0x811c9dc5; // FNV-1a, 32-bit
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Each job's place on the tracker, newest knowledge first: what was just done on this page (`changed`, before the
 * server's answer lands), else the tracker (reloaded after every change), else what the feed said.
 */
export function withTracked(
  items: JobListing[],
  changed: Record<string, JobListing["tracked"]>,
  tracker: JobTrackerEntry[] | null,
): JobListing[] {
  const onTracker = tracker ? new Map(tracker.map((e) => [e.listing_id, { id: e.id, status: e.status }])) : null;
  return items.map((j) => {
    const t = j.id in changed ? (changed[j.id] ?? null) : onTracker ? (onTracker.get(j.id) ?? null) : j.tracked;
    return t?.id === j.tracked?.id && t?.status === j.tracked?.status ? j : { ...j, tracked: t };
  });
}

/** Whether two profiles want the same things (the profile page's "unsaved changes"). */
export function samePrefs(a: JobPrefs, b: JobPrefs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The tracker's entries by column, each column most recently moved first. */
export function byStatus(entries: JobTrackerEntry[]): Record<JobStatus, JobTrackerEntry[]> {
  const out = Object.fromEntries(STATUSES.map((s) => [s, [] as JobTrackerEntry[]])) as Record<JobStatus, JobTrackerEntry[]>;
  for (const e of entries) out[e.status].push(e);
  for (const s of STATUSES) out[s].sort((a, b) => b.status_at.localeCompare(a.status_at));
  return out;
}

/** The tracked job whose next interview or follow-up comes soonest, from today on (null: nothing coming up). */
export function nextUp(entries: JobTrackerEntry[], now: number = Date.now()): JobTrackerEntry | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const coming = entries.filter((e) => e.next_at && e.status !== "rejected" && new Date(e.next_at).getTime() >= today.getTime());
  coming.sort((a, b) => a.next_at!.localeCompare(b.next_at!));
  return coming[0] ?? null;
}

/** An ISO time as the value of an <input type="date"> in local time ("2026-10-09"), or "". */
export function dateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An <input type="date"> value back to an ISO time (local noon, so no time zone moves it to another day). */
export function fromDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/** "Thu, 9 Oct": a tracker date. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Only ever open http(s) links from the API (a feed could, in theory, send something else). */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
