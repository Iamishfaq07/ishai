// Jobs's plain logic (no React): labels, "posted 3h ago", the match colours, the tracker's columns, the small
// list edits the profile page makes, and which message Outreach starts on. Kept here so it's unit-tested (model.test.ts).
import { INDIA, countryInSentence, isIndia, regionWords } from "@orbit/ui";
import type {
  JobEmploymentType,
  JobLevel,
  JobListing,
  JobMatch,
  JobPostedWithin,
  JobPrefs,
  JobProfile,
  JobStatus,
  JobTrackerEntry,
  JobWorkplace,
  OutreachKind,
} from "@orbit/types";

export const STATUSES: JobStatus[] = ["saved", "applied", "interviewing", "offer", "hired", "rejected", "withdrawn"];

export const STATUS_LABEL: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  withdrawn: "Withdrawn",
  rejected: "Not this time",
};

/**
 * Each stage's colour, as a solid mark: the dot in its pill, a tracker card's edge, its share of the Home pipeline bar.
 * Fixed stage colours (base.css `--stage-*`), never on text, and always next to the stage's name.
 */
export const STATUS_MARK: Record<JobStatus, string> = {
  saved: "bg-stage-saved",
  applied: "bg-stage-applied",
  interviewing: "bg-stage-interviewing",
  offer: "bg-stage-offer",
  hired: "bg-stage-offer",
  withdrawn: "bg-stage-saved",
  rejected: "bg-stage-rejected",
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

/** The levels as named where the user applies ("Fresher" in India, "Entry level" elsewhere); the ids stay the server's. */
export function levelsFor(country: string = INDIA): typeof LEVELS {
  if (isIndia(country)) return LEVELS;
  return LEVELS.map((l) => (l.id === "fresher" ? { ...l, label: regionWords(country).entryLevel } : l));
}

export function levelLabel(level: JobLevel | null | undefined, country: string = INDIA): string | undefined {
  return levelsFor(country).find((l) => l.id === level)?.label;
}

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

/**
 * The match badge's colour: strong, good, partial, weak. The -800 shades (zinc-700) keep its small "match" label at
 * AA contrast on the tinted badge in light mode (axe found the old -700s under `opacity-80` at 3.5–4.3:1).
 */
export function matchTone(score: number): string {
  return score >= 80
    ? "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300"
    : score >= 65
      ? "bg-sky-500/10 text-sky-800 ring-sky-500/25 dark:text-sky-300"
      : score >= 45
        ? "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-300"
        : "bg-zinc-500/10 text-zinc-700 ring-zinc-500/20 dark:text-zinc-300";
}

export const VERDICT_TONE: Record<"Strong" | "Good" | "Stretch", string> = {
  Strong: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300",
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
  country: string = INDIA,
): Array<[string, string]> {
  const facts: Array<[string, string | null | undefined]> = [
    ["Company", job.company],
    ["Location", job.place],
    ["Work mode", WORKPLACES.find((w) => w.id === job.workplace)?.label],
    ["Job type", employmentLabel(job.employment_type)],
    ["Level", levelLabel(job.level, country)],
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

/** The profile's "anywhere in the country" (job_portal/profile.py): India's profiles say "India", others "Anywhere". */
export const ANYWHERE_TOKENS: readonly string[] = ["India", "Anywhere"];

/** "Anywhere in India", "Anywhere in Germany": how the anywhere choice reads for the country the user applies in. */
export function anywhereLabel(country: string = INDIA): string {
  return isIndia(country) ? "Anywhere in India" : `Anywhere in ${countryInSentence(country)}`;
}

/** What the profile looks for, in a sentence ("Backend Engineer, Platform Engineer · Bengaluru or remote · 3 years"). */
export function profileSummary(prefs: JobPrefs, country: string = INDIA): string {
  const titles = prefs.titles.slice(0, 2).join(", ") + (prefs.titles.length > 2 ? ` +${prefs.titles.length - 2}` : "");
  const cities = prefs.locations.filter((c) => !ANYWHERE_TOKENS.includes(c));
  const remoteToo = prefs.workplace.includes("remote");
  const onlyRemote = prefs.workplace.length === 1 && remoteToo;
  const where = onlyRemote
    ? "Remote"
    : cities.length
      ? `${cities.slice(0, 2).join(", ")}${remoteToo ? " or remote" : ""}`
      : `${anywhereLabel(country)}${remoteToo ? " or remote" : ""}`;
  const years = prefs.years !== null ? `${Math.round(prefs.years * 10) / 10} years` : (levelLabel(prefs.level, country) ?? null);
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
  const coming = entries.filter((e) => e.next_at && !["rejected", "hired", "withdrawn"].includes(e.status) && new Date(e.next_at).getTime() >= today.getTime());
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

/**
 * The message Outreach opens on for a job, from how far along it is: a referral before applying, a follow-up once
 * applied, a thank-you once interviewing. Null when that doesn't say (an offer, "not this time", not on the tracker).
 */
export function outreachKindFor(status: JobStatus | null | undefined): OutreachKind | null {
  return status === "saved" ? "referral" : status === "applied" ? "follow_up" : status === "interviewing" ? "thank_you" : null;
}

/** A job's skills for Outreach to show, from its match: the ones the resume shows first, each once. */
export function jobAsks(match: Pick<JobMatch, "matched" | "missing"> | null, most = 8): string[] {
  const seen = new Set<string>();
  return [...(match?.matched ?? []), ...(match?.missing ?? [])].filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase())).slice(0, most);
}

// ---- an honest match ----------------------------------------------------------------------------------------------

/**
 * What a match % can be worked out from: a resume with something in it (its titles and skills fill the profile), or
 * skills typed into the profile. With neither, every job scores about the same middling number from its place and
 * how recent it is (the old "42% match" on everything), so no number is shown at all.
 */
export function matchBasis(profile: Pick<JobProfile, "resume" | "prefs">): "resume" | "skills" | null {
  const { skills, titles } = profile.prefs;
  if (profile.resume && (skills.length > 0 || titles.length > 0)) return "resume";
  if (skills.length > 0) return "skills";
  return null;
}

// ---- trust and freshness: only what Orbit can back -------------------------------------------------------------------

const HOUR_MS = 3600_000;
/** "Early applicant": posted in the last two days. */
export const EARLY_HOURS = 48;
/** Company boards are read every 6 hours: a check older than a day means that board's fetch is failing. */
export const STILL_OPEN_HOURS = 24;

/**
 * When the post went up, as far as Orbit can trust it: the earlier of the date the post gives and when Orbit first
 * saw it (a post without a date is dated when it's fetched, so on its own it would look new for ever).
 */
export function postedTime(job: Pick<JobListing, "posted_at" | "first_seen_at">): string {
  const seen = job.first_seen_at;
  return seen && Date.parse(seen) < Date.parse(job.posted_at) ? seen : job.posted_at;
}

/** Posted in the last EARLY_HOURS: applying now is applying early. */
export function isEarly(job: Pick<JobListing, "posted_at" | "first_seen_at">, now: number = Date.now()): boolean {
  return now - Date.parse(postedTime(job)) < EARLY_HOURS * HOUR_MS;
}

/** When Orbit last found the post on the company's own careers page, if that's recent enough to say "still open". */
export function stillOpenAt(item: { still_listed_at?: string | null }, now: number = Date.now()): string | null {
  const at = item.still_listed_at;
  return at && now - Date.parse(at) <= STILL_OPEN_HOURS * HOUR_MS ? at : null;
}

export interface TrustBadge {
  id: "early" | "direct" | "open";
  label: string;
  /** The longer version, for the badge's title and screen readers. */
  detail: string;
}

/**
 * The badges a job has earned, each backed by data: "Early applicant" (posted under two days ago, by the earlier of
 * its date and Orbit's first sighting), "Direct from careers page" (the company's own job board, where Apply goes to
 * the employer) and "Still open" (found on that board at the last check, within a day). Feeds and searches never get
 * the last two: Orbit can't check those with the employer.
 */
export function trustBadges(
  job: Pick<JobListing, "posted_at" | "first_seen_at" | "direct" | "company" | "still_listed_at">,
  now: number = Date.now(),
): TrustBadge[] {
  const out: TrustBadge[] = [];
  if (isEarly(job, now)) {
    out.push({ id: "early", label: "Early applicant", detail: `Posted ${postedAgo(postedTime(job), now).toLowerCase()}: you'd be applying in its first two days` });
  }
  if (job.direct) {
    out.push({ id: "direct", label: "Direct from careers page", detail: `From ${job.company}'s own careers page: Apply goes straight to the employer` });
  }
  const open = job.direct ? stillOpenAt(job, now) : null;
  if (open) {
    const ago = postedAgo(open, now).toLowerCase();
    out.push({ id: "open", label: `Still open · checked ${ago}`, detail: `Orbit found it on ${job.company}'s careers page ${ago}` });
  }
  return out;
}

// ---- jobs found elsewhere -----------------------------------------------------------------------------------------

/** A job added by hand (a Naukri or LinkedIn link, or typed in): it has no page in Orbit. */
export function isManual(entry: Pick<JobTrackerEntry, "listing_id">): boolean {
  return entry.listing_id.startsWith("ext:");
}

/** A job applied to through Orbit for Business (D82): the company moves it, so its status follows theirs. */
export function isOrbitDirect(entry: Pick<JobTrackerEntry, "listing_id" | "source">): boolean {
  return entry.source === "orbit_direct" || entry.listing_id.startsWith("biz:");
}

/** The address of an Orbit Direct job's page on this site ("/company/acme/jobs/dev"), from its absolute URL. */
export function orbitDirectPath(url: string): string | null {
  const m = /^(?:https?:\/\/[^/]+)?(\/company\/[a-z0-9-]+\/jobs\/[a-z0-9-]+)\/?$/.exec(url.trim());
  return m ? m[1]! : null;
}

/** "naukri.com", from a saved link (null when there's none). */
export function linkHost(url: string): string | null {
  const safe = safeUrl(url);
  return safe ? new URL(safe).hostname.replace(/^www\./, "") : null;
}

// ---- follow-ups ---------------------------------------------------------------------------------------------------

/** Applied this many days ago with no reply (nothing moved, no date set): time to follow up. */
export const FOLLOW_UP_AFTER_DAYS = 7;
/** Past this, an application has gone cold: no more nudges. */
const FOLLOW_UP_UNTIL_DAYS = 45;
/** An interview or follow-up date this many days ahead shows as coming up. */
export const SOON_DAYS = 7;
/** A date further back than this is stale, not "overdue". */
const OVERDUE_FOR_DAYS = 14;

export type FollowUpKind = "overdue" | "today" | "tomorrow" | "follow_up" | "soon";

export interface FollowUp {
  entry: JobTrackerEntry;
  kind: FollowUpKind;
  /** Days past the date (overdue), until it (soon), or since applying (follow_up). */
  days: number;
  /** "Interview with Bosch tomorrow", "Follow up with Razorpay: applied 7 days ago". */
  text: string;
  /** About an interview: practising for it is the next step. */
  interview: boolean;
}

function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar days from `a` to `b` in local time (negative when `b` is earlier). */
export function daysBetween(a: number, b: number): number {
  return Math.round((dayStart(b) - dayStart(a)) / 86_400_000);
}

const FOLLOW_UP_ORDER: Record<FollowUpKind, number> = { overdue: 0, today: 1, tomorrow: 2, follow_up: 3, soon: 4 };

/**
 * What's due on the tracker, most urgent first: interviews and follow-up dates that are overdue, today or tomorrow
 * (from `next_at`), applications with no reply after FOLLOW_UP_AFTER_DAYS (applied, nothing moved, no date set), then
 * interviews later this week. Offers and "not this time" are done.
 */
export function followUps(entries: JobTrackerEntry[], now: number = Date.now()): FollowUp[] {
  const out: FollowUp[] = [];
  for (const entry of entries) {
    if (["offer", "hired", "rejected", "withdrawn"].includes(entry.status)) continue;
    const interview = entry.status === "interviewing";
    if (entry.next_at) {
      const d = daysBetween(now, Date.parse(entry.next_at));
      const what = interview ? `Interview with ${entry.company}` : `Follow up with ${entry.company}`;
      if (d < 0 && d >= -OVERDUE_FOR_DAYS) out.push({ entry, kind: "overdue", days: -d, text: `${what}: was due ${shortDate(entry.next_at)}`, interview });
      else if (d === 0) out.push({ entry, kind: "today", days: 0, text: `${what} today`, interview });
      else if (d === 1) out.push({ entry, kind: "tomorrow", days: 1, text: `${what} tomorrow`, interview });
      // Coming up later this week: only interviews (a follow-up date further off isn't due yet).
      else if (d > 1 && d <= SOON_DAYS && interview) out.push({ entry, kind: "soon", days: d, text: `${what} on ${shortDate(entry.next_at)}`, interview });
      continue; // a date is set, so it says when: no "applied N days ago" nudge on top
    }
    if (entry.status !== "applied" || !entry.applied_at) continue;
    const since = daysBetween(Date.parse(entry.applied_at), now);
    const still = daysBetween(Date.parse(entry.status_at), now);
    if (since >= FOLLOW_UP_AFTER_DAYS && still >= FOLLOW_UP_AFTER_DAYS && since <= FOLLOW_UP_UNTIL_DAYS) {
      out.push({ entry, kind: "follow_up", days: since, text: `Follow up with ${entry.company}: applied ${since} days ago`, interview: false });
    }
  }
  // Within a kind: the most overdue and the longest-waiting first; coming up, the nearest first.
  return out.sort((a, b) => FOLLOW_UP_ORDER[a.kind] - FOLLOW_UP_ORDER[b.kind] || (a.kind === "soon" ? a.days - b.days : b.days - a.days));
}

/** "Remind me in a week": a week from today at local noon (as the tracker's own date fields are kept). */
export function inAWeek(now: number = Date.now()): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, 12, 0, 0).toISOString();
}

function mockFor(entry: { document_id?: string | null; title: string; company: string }): string {
  const q = new URLSearchParams();
  if (entry.document_id) q.set("jd", entry.document_id);
  q.set("preset", "tech15");
  if (entry.title.trim()) q.set("role", entry.title.trim());
  if (entry.company.trim()) q.set("company", entry.company.trim());
  return `/mock?${q}`;
}

/**
 * Where "Practise" goes for a tracked job: a mock on its saved job post when there is one, else the job's own page
 * (its Prepare saves the post), else a technical mock for its title.
 */
export function practiceLink(
  entry: Pick<JobTrackerEntry, "document_id" | "live" | "listing_id" | "title" | "company">,
  jobPage: (id: string) => string,
): string {
  if (entry.document_id) return mockFor(entry);
  if (entry.live && !isManual(entry)) return jobPage(entry.listing_id);
  return mockFor(entry);
}

// ---- the search box's quick chips ---------------------------------------------------------------------------------

/** Whether the search has this word ("fresher", "internship"), as a whole word. */
export function hasQueryWord(query: string, word: string): boolean {
  return query.toLowerCase().split(/\s+/).includes(word.toLowerCase());
}

/** The search with `word` added (at the end) or taken out: the quick chips are words the search box understands. */
export function toggleQueryWord(query: string, word: string): string {
  const words = query.split(/\s+/).filter(Boolean);
  const on = words.some((w) => w.toLowerCase() === word.toLowerCase());
  return (on ? words.filter((w) => w.toLowerCase() !== word.toLowerCase()) : [...words, word]).join(" ");
}

/** How many filters differ from the defaults (the phone's "Filters · 2"). `defaultSort`: newest without a resume. */
export function activeFilterCount(
  prefs: Pick<JobPrefs, "posted_within" | "workplace">,
  query: string,
  sort: string,
  defaultSort: string = "best",
): number {
  return (
    (prefs.posted_within !== 7 ? 1 : 0) +
    (prefs.workplace.length < 3 ? 1 : 0) +
    (sort !== defaultSort ? 1 : 0) +
    (hasQueryWord(query, "fresher") || hasQueryWord(query, "entry-level") ? 1 : 0) +
    (hasQueryWord(query, "internship") ? 1 : 0)
  );
}

// --- Taking the tracker elsewhere: a spreadsheet of every job, a calendar entry for one job's next date. ---

/** One CSV cell: quoted when it needs to be, and never read as a formula by Excel or Sheets. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Every tracked job as a CSV file (opens in Excel or Google Sheets): company, role, where, status, the dates, the
 * link and your notes. Starts with a byte-order mark so Excel reads it as UTF-8 (₹, names in Hindi or Tamil).
 */
export function trackerCsv(entries: JobTrackerEntry[]): string {
  const header = ["Company", "Role", "Location", "Status", "Applied", "Next", "Link", "Notes", "Added"];
  const rows = entries.map((e) => [
    e.company,
    e.title,
    e.location,
    STATUS_LABEL[e.status],
    dateInput(e.applied_at),
    dateInput(e.next_at),
    e.apply_url || e.url,
    e.notes,
    dateInput(e.created_at),
  ]);
  return "\uFEFF" + [header, ...rows].map((r) => r.map((c) => csvCell(c ?? "")).join(",")).join("\r\n") + "\r\n";
}

/** Text for an iCalendar property: backslash, semicolon, comma and line breaks escaped (RFC 5545). */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    // eslint-disable-next-line no-control-regex -- Calendar TEXT must not contain raw control bytes.
    .replace(/\r\n|\r|\n/g, "\\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** RFC 5545 lines are at most 75 octets: longer ones continue on the next line after a space. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = "", bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { out.push(current); current = " "; bytes = 1; }
    current += char; bytes += size;
  }
  out.push(current);
  return out.join("\r\n");
}

/** What the calendar entry is called: the interview while interviewing, otherwise the follow-up. */
export function nextDateTitle(e: Pick<JobTrackerEntry, "status" | "title" | "company">): string {
  const what = e.status === "interviewing" ? "Interview" : e.status === "offer" ? "Offer" : "Follow up";
  return `${what}: ${e.title}, ${e.company}`;
}

/**
 * A job's next date as an all-day calendar event (.ics): Google Calendar, Outlook and phones import it. Null when the
 * job has no next date. `now` stamps the file (DTSTAMP).
 */
export function nextDateIcs(e: JobTrackerEntry, now: Date = new Date()): string | null {
  const day = dateInput(e.next_at);
  if (!day) return null;
  const start = day.replace(/-/g, "");
  const [y, m, d] = day.split("-").map(Number);
  const after = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const end = after.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const link = e.apply_url || e.url;
  const description = [link, e.notes].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbit//Jobs//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.id}-next@orbit`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsText(nextDateTitle(e))}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    ...(link ? [`URL:${link}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** A file name from a job: "swiggy-sde-ii". */
export function fileSlug(...parts: string[]): string {
  return (
    parts
      .join(" ")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "job"
  );
}

/** A contact's follow-up date against today: overdue, today, later, or none. */
export function followUpState(iso: string | null, now = new Date()): "overdue" | "today" | "later" | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = day(d) - day(now);
  return diff < 0 ? "overdue" : diff === 0 ? "today" : "later";
}
