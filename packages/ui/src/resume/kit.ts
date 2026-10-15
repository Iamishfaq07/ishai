import type { LinkedInProfile, NaukriProfile, OutreachInputs, OutreachKind, OutreachMessage } from "@orbit/types";
import { browserStore, read, write, type KeyValueStore } from "./storage";

/**
 * Pure helpers for Jobs AI's Outreach page (it was the resume maker's "Profiles & outreach" tab) and Resume AI's
 * "Shorten with AI": the sites' limits, the counters under each field, what a site shows before it cuts a field off,
 * and the profiles and messages this browser keeps per resume (and, for messages, per job).
 */

/** The limits the server keeps to (apps/api/orbit_api/resumes/kit.py). */
export const KIT_LIMITS = {
  naukriHeadline: 250,
  naukriSummary: 1000,
  naukriSkills: 15,
  linkedinHeadline: 220,
  linkedinAbout: 2600,
  linkedinSkills: 5,
  /** A free LinkedIn account's connection note (Premium allows 300). */
  connectionNote: 200,
  subject: 90,
} as const;

/** What shows before a site cuts the field off: a headline in search results, LinkedIn's About before "see more". */
export const KIT_SHOWN_FIRST = { headline: 60, about: 265 } as const;

/** Each message's word limit, greeting and sign-off included. */
export const MESSAGE_WORDS: Record<OutreachKind, number> = { referral: 150, cold_email: 150, follow_up: 100, thank_you: 120, screening: 250 };

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** The start of `text` a site shows before cutting it off, ending on a whole word ("" when it all fits). */
export function shownFirst(text: string, chars: number): string {
  const t = text.trim();
  if (t.length <= chars) return "";
  const cut = t.slice(0, chars + 1);
  const space = cut.lastIndexOf(" ");
  return (space > chars / 2 ? cut.slice(0, space) : t.slice(0, chars)).replace(/[\s,;:|·-]+$/, "");
}

/** "Python, SQL; Power BI\nExcel" -> ["Python", "SQL", "Power BI", "Excel"], without repeats. */
export function skillList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/**
 * How many printed lines the resume is over one page, from the most compact layout "Fit to one page" tried: the
 * content's height past the page's usable height, in lines of body text (`fontPt` at `lineHeight`). At least 1.
 */
export function linesOver(contentPx: number, usablePx: number, fontPt: number, lineHeight: number): number {
  const line = fontPt * (96 / 72) * lineHeight;
  return Math.min(200, Math.max(1, Math.ceil((contentPx - usablePx) / line)));
}

// ---- kept in this browser ----------------------------------------------------------------------------------------

/** The messages written, and what was typed for them: for no job in particular, or for one job. */
export interface MessageKit {
  messages?: Partial<Record<OutreachKind, OutreachMessage>>;
  inputs?: OutreachInputs;
}

/** Messages for one job in Jobs AI, and when they were last changed (the oldest are forgotten first). */
export interface JobMessageKit extends MessageKit {
  at: number;
}

/** Profiles and messages written from one resume, as last edited. */
export interface SavedKit extends MessageKit {
  naukri?: NaukriProfile;
  linkedin?: LinkedInProfile;
  /** By the job's listing id. */
  jobs?: Record<string, JobMessageKit>;
}

/** How many jobs' messages are kept per resume. */
export const MAX_JOB_KITS = 20;

const KINDS: OutreachKind[] = ["referral", "cold_email", "follow_up", "thank_you"];
const kitKey = (resumeId: string) => `orbit.resumeKit.${resumeId}`;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function loadMessages(raw: Record<string, unknown>): MessageKit {
  const out: MessageKit = {};
  const m = obj(raw.messages);
  if (m) {
    out.messages = {};
    for (const kind of KINDS) {
      const x = obj(m[kind]);
      if (x) out.messages[kind] = { kind, subject: str(x.subject), connection_note: str(x.connection_note), message: str(x.message) };
    }
  }
  const i = obj(raw.inputs);
  if (i) out.inputs = { recipient: str(i.recipient), company: str(i.company), role: str(i.role), details: str(i.details) };
  return out;
}

/** What's saved for this resume, with anything malformed (an older or edited copy) left out. */
export function loadKit(resumeId: string, store: KeyValueStore | null = browserStore()): SavedKit {
  const raw = obj(read(store, kitKey(resumeId)));
  if (!raw) return {};
  const out: SavedKit = loadMessages(raw);
  const n = obj(raw.naukri);
  if (n) out.naukri = { headline: str(n.headline), summary: str(n.summary), skills: strs(n.skills) };
  const l = obj(raw.linkedin);
  if (l) out.linkedin = { headline: str(l.headline), about: str(l.about), skills: strs(l.skills) };
  const jobs = obj(raw.jobs);
  if (jobs) {
    out.jobs = {};
    for (const [id, v] of Object.entries(jobs)) {
      const j = obj(v);
      if (id && j) out.jobs[id] = { ...loadMessages(j), at: typeof j.at === "number" ? j.at : 0 };
    }
  }
  return out;
}

/** Saved for this resume. Only the `MAX_JOB_KITS` jobs changed last keep their messages. */
export function saveKit(resumeId: string, kit: SavedKit, store: KeyValueStore | null = browserStore()): void {
  const jobs = Object.entries(kit.jobs ?? {});
  write(
    store,
    kitKey(resumeId),
    jobs.length > MAX_JOB_KITS ? { ...kit, jobs: Object.fromEntries(jobs.sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_JOB_KITS)) } : kit,
  );
}

/** The messages for one job (`jobId`), or for no job in particular (null). */
export function messageKit(kit: SavedKit, jobId: string | null): MessageKit {
  return jobId ? (kit.jobs?.[jobId] ?? {}) : { messages: kit.messages, inputs: kit.inputs };
}

/** `kit` with the messages for one job (or for none) changed, the job's marked as changed `now`. */
export function withMessageKit(kit: SavedKit, jobId: string | null, patch: MessageKit, now = Date.now()): SavedKit {
  if (!jobId) return { ...kit, ...patch };
  return { ...kit, jobs: { ...kit.jobs, [jobId]: { ...kit.jobs?.[jobId], ...patch, at: now } } };
}
