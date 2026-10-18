// Orbit for Business (D82): the company app's pure logic (no React), tested on its own (model.test.ts).
import type {
  BizApplicationListItem,
  BizEmploymentType,
  BizExperience,
  BizJobInput,
  BizKnockout,
  BizQuestion,
  BizQuestionKind,
  BizRole,
  BizSalaryPeriod,
  BizStage,
  BizStageKind,
  BizWorkplace,
} from "@orbit/types";

export const BUSINESS_HOME = "/business";
export const APP_HOME = "/business/app";
export const companyPath = (cid: string, rest = "") => `${APP_HOME}/${encodeURIComponent(cid)}${rest ? `/${rest}` : ""}`;
export const jobPath = (cid: string, jid: string, rest = "") => companyPath(cid, `jobs/${encodeURIComponent(jid)}${rest ? `/${rest}` : ""}`);
export const applicationPath = (cid: string, aid: string) => companyPath(cid, `applications/${encodeURIComponent(aid)}`);
export const careersPath = (slug: string) => `/company/${encodeURIComponent(slug)}`;
export const publicJobPath = (slug: string, jobSlug: string) => `${careersPath(slug)}/jobs/${encodeURIComponent(jobSlug)}`;

export const ROLE_LABEL: Record<BizRole, string> = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  interviewer: "Interviewer",
};
export const ROLE_HINT: Record<BizRole, string> = {
  owner: "Everything, including the plan and handing over ownership.",
  admin: "Everything except the plan and ownership.",
  recruiter: "All jobs and applicants, emails and templates.",
  hiring_manager: "Only the jobs whose hiring team they're on.",
  interviewer: "Notes and scorecards on the applicants assigned to them.",
};
/** The roles an invite may give (one owner, made by transfer only). */
export const INVITABLE_ROLES: BizRole[] = ["admin", "recruiter", "hiring_manager", "interviewer"];

export const WORKPLACE_LABEL: Record<BizWorkplace, string> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" };
export const EMPLOYMENT_LABEL: Record<BizEmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  temporary: "Temporary",
  internship: "Internship",
};
export const EXPERIENCE_LABEL: Record<BizExperience, string> = {
  entry: "Entry level (0-1 years)",
  junior: "Junior (1-3 years)",
  mid: "Mid level (3-6 years)",
  senior: "Senior (6-10 years)",
  lead: "Lead / principal (10+ years)",
};
export const PERIOD_LABEL: Record<BizSalaryPeriod, string> = { year: "per year", month: "per month", hour: "per hour" };
export const QUESTION_KIND_LABEL: Record<BizQuestionKind, string> = {
  yes_no: "Yes / no",
  choice: "Multiple choice",
  short_text: "Short answer",
  number: "Number",
};
export const STAGE_KIND_LABEL: Record<BizStageKind, string> = {
  applied: "Applied",
  screen: "Screen",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

export const DEFAULT_STAGES: BizStage[] = [
  { id: "applied", name: "Applied", kind: "applied" },
  { id: "screen", name: "Screen", kind: "screen" },
  { id: "interview", name: "Interview", kind: "interview" },
  { id: "offer", name: "Offer", kind: "offer" },
  { id: "hired", name: "Hired", kind: "hired" },
  { id: "rejected", name: "Rejected", kind: "rejected" },
];

export function newId(prefix = "q"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${r}`;
}

export function emptyJob(): BizJobInput {
  return {
    title: "",
    description_html: "",
    department: "",
    locations: [],
    workplace: "onsite",
    allowed_countries: [],
    employment_type: "full_time",
    experience: "mid",
    salary_min: null,
    salary_max: null,
    salary_currency: "INR",
    salary_period: "year",
    show_salary: true,
    must_haves: [],
    nice_to_haves: [],
    questions: [],
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
    hiring_team: [],
    valid_through: null,
  };
}

/** Lines of a textarea → a clean list (trimmed, blanks and repeats out). */
export function lines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const v = raw.replace(/^\s*[-*•]\s*/, "").trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** Comma-separated input → list ("IN, US" → ["IN", "US"]). */
export function commaList(text: string, upper = false): string[] {
  const out = text.split(",").map((s) => (upper ? s.trim().toUpperCase() : s.trim())).filter(Boolean);
  return [...new Set(out)];
}

// ---- screening questions and knock-outs --------------------------------------------------------------------------

/** The editor's form of a knock-out rule, before it's saved. */
export interface KnockoutForm {
  on: boolean;
  equals: "yes" | "no";
  anyOf: string[];
  min: string;
  max: string;
}

export function knockoutForm(q: Pick<BizQuestion, "kind" | "knockout">): KnockoutForm {
  const k = q.knockout ?? null;
  return {
    on: Boolean(k),
    equals: k?.equals ?? "yes",
    anyOf: k?.any_of ?? [],
    min: k?.min !== undefined && k?.min !== null ? String(k.min) : "",
    max: k?.max !== undefined && k?.max !== null ? String(k.max) : "",
  };
}

/** The saved rule for a question kind, or null (off, or nothing that could fail). Text answers have no rule. */
export function knockoutRule(kind: BizQuestionKind, form: KnockoutForm, choices: string[] = []): BizKnockout | null {
  if (!form.on) return null;
  if (kind === "yes_no") return { equals: form.equals };
  if (kind === "choice") {
    const pass = form.anyOf.filter((c) => choices.includes(c));
    return pass.length ? { any_of: pass } : null;
  }
  if (kind === "number") {
    const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));
    const min = num(form.min);
    const max = num(form.max);
    if (min === undefined && max === undefined) return null;
    return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  return null;
}

/** "Must answer yes", "Must be one of: A, B", "At least 2", "Between 1 and 5". */
export function describeKnockout(kind: BizQuestionKind, k: BizKnockout | null | undefined): string | null {
  if (!k) return null;
  if (kind === "yes_no" && k.equals) return `Must answer ${k.equals}`;
  if (kind === "choice" && k.any_of?.length) return `Must be one of: ${k.any_of.join(", ")}`;
  if (kind === "number") {
    if (k.min !== undefined && k.max !== undefined) return `Between ${k.min} and ${k.max}`;
    if (k.min !== undefined) return `At least ${k.min}`;
    if (k.max !== undefined) return `At most ${k.max}`;
  }
  return null;
}

/** Whether an answer passes a rule (the applicant form's own check; the API decides, and only flags). */
export function passesKnockout(kind: BizQuestionKind, k: BizKnockout | null | undefined, answer: string): boolean {
  if (!k) return true;
  const a = answer.trim();
  if (kind === "yes_no") return !k.equals || a.toLowerCase() === k.equals;
  if (kind === "choice") return !k.any_of?.length || k.any_of.includes(a);
  if (kind === "number") {
    const n = Number(a);
    if (a === "" || !Number.isFinite(n)) return false;
    return (k.min === undefined || n >= k.min) && (k.max === undefined || n <= k.max);
  }
  return true;
}

export function newQuestion(kind: BizQuestionKind = "yes_no"): BizQuestion {
  return { id: newId("q"), text: "", kind, required: true, ...(kind === "choice" ? { choices: ["", ""] } : {}), knockout: null };
}

/** Problems that stop a save, in words ("Question 2 has no text"). */
export function questionProblems(questions: BizQuestion[]): string[] {
  const out: string[] = [];
  questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.text.trim()) out.push(`Question ${n} has no text.`);
    if (q.kind === "choice" && (q.choices ?? []).filter((c) => c.trim()).length < 2) out.push(`Question ${n} needs at least two choices.`);
  });
  return out;
}

// ---- stages ------------------------------------------------------------------------------------------------------

/** Stage list problems: one "applied" first and a "rejected" stage are required; names must be there and different. */
export function stageProblems(stages: BizStage[]): string[] {
  const out: string[] = [];
  if (!stages.some((s) => s.kind === "applied")) out.push("Keep an Applied stage.");
  if (!stages.some((s) => s.kind === "rejected")) out.push("Keep a Rejected stage.");
  const names = stages.map((s) => s.name.trim().toLowerCase());
  if (names.some((n) => !n)) out.push("Every stage needs a name.");
  if (new Set(names).size !== names.length) out.push("Two stages have the same name.");
  return out;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

// ---- the pipeline ------------------------------------------------------------------------------------------------

export type SortKey = "score" | "applied" | "name";

/** Knock-out failures last (flagged, never rejected), then by the chosen key. */
export function sortApplications(items: BizApplicationListItem[], key: SortKey): BizApplicationListItem[] {
  const by = (a: BizApplicationListItem, b: BizApplicationListItem): number => {
    if (key === "name") return a.name.localeCompare(b.name);
    if (key === "applied") return b.applied_at.localeCompare(a.applied_at);
    return (b.score ?? -1) - (a.score ?? -1) || b.applied_at.localeCompare(a.applied_at);
  };
  return [...items].sort((a, b) => Number(a.knockout_failed) - Number(b.knockout_failed) || by(a, b));
}

/** The kanban's columns: each stage with its applicants, in the job's stage order. */
export function groupByStage(stages: BizStage[], items: BizApplicationListItem[], key: SortKey = "score"): Array<{ stage: BizStage; items: BizApplicationListItem[] }> {
  const sorted = sortApplications(items, key);
  return stages.map((stage) => ({ stage, items: sorted.filter((a) => a.stage_id === stage.id) }));
}

/** The stage next to this one (keyboard moves: ← and →), or null at either end. The rejected stage is never a
 *  neighbour: rejecting is its own action (a person clicks Reject, with or without an email). */
export function neighbourStage(stages: BizStage[], stageId: string, dir: -1 | 1): BizStage | null {
  const usable = stages.filter((s) => s.kind !== "rejected");
  const i = usable.findIndex((s) => s.id === stageId);
  if (i < 0) return null;
  return usable[i + dir] ?? null;
}

/** An optimistic move: the moved applicants in their new stage, the rest unchanged. */
export function applyMove(items: BizApplicationListItem[], ids: string[], stageId: string, at = new Date().toISOString()): BizApplicationListItem[] {
  const set = new Set(ids);
  return items.map((a) => (set.has(a.id) && a.stage_id !== stageId ? { ...a, stage_id: stageId, stage_changed_at: at } : a));
}

export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** "Matches 6/8 must-haves", from the list item (the API's label when it sends one). */
export function matchLabel(a: Pick<BizApplicationListItem, "match_label" | "must_haves_met" | "must_haves_total">): string | null {
  if (a.match_label) return a.match_label;
  if (a.must_haves_met === null || a.must_haves_total === null || a.must_haves_total === 0) return null;
  return `Matches ${a.must_haves_met}/${a.must_haves_total} must-haves`;
}

export function scoreTone(score: number | null): "success" | "info" | "warning" | "neutral" {
  if (score === null) return "neutral";
  return score >= 75 ? "success" : score >= 50 ? "info" : "warning";
}

// ---- notes, templates, scheduling --------------------------------------------------------------------------------

/** The @mentions in a note: "@asha" or "@asha@acme.com", matched to members by email, email's name or first name. */
export function mentionedMembers(text: string, members: Array<{ user_id: string; name: string | null; email: string }>): string[] {
  const words = [...text.matchAll(/(^|\s)@([\w.+-]+(?:@[\w-]+(?:\.[\w-]+)+)?)/g)].map((m) => m[2]!.toLowerCase());
  const out = new Set<string>();
  for (const w of words) {
    for (const m of members) {
      const first = (m.name ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
      const local = m.email.split("@")[0]!.toLowerCase();
      if (w === m.email.toLowerCase() || w === local || (first && w === first)) out.add(m.user_id);
    }
  }
  return [...out];
}

export const TEMPLATE_VARIABLES = ["candidate_name", "job_title", "company_name", "stage", "status_link", "recruiter_name"] as const;

/** A template filled in with sample values, for the preview. Unknown variables stay as written. */
export function fillTemplate(text: string, values: Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, name: string) => (name in values ? (values as Record<string, string>)[name]! : m));
}

/** Interview slots to propose: 3-5, in the future, different, as ISO strings. Returns the slots or a problem. */
export function checkSlots(locals: string[], now = Date.now()): { slots: string[] } | { error: string } {
  const filled = locals.map((s) => s.trim()).filter(Boolean);
  if (filled.length < 3 || filled.length > 5) return { error: "Offer between 3 and 5 times." };
  const times = filled.map((s) => new Date(s));
  if (times.some((t) => Number.isNaN(t.getTime()))) return { error: "One of the times isn't a date and time." };
  if (times.some((t) => t.getTime() <= now)) return { error: "Every time must be in the future." };
  const iso = times.map((t) => t.toISOString());
  if (new Set(iso).size !== iso.length) return { error: "Two of the times are the same." };
  return { slots: iso.sort() };
}

// ---- careers page bits -------------------------------------------------------------------------------------------

export function salaryLine(s: { min: number | null; max: number | null; currency: string; period: BizSalaryPeriod } | null): string | null {
  if (!s || (s.min === null && s.max === null)) return null;
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(s.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: s.currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${s.currency} ${n.toLocaleString()}`;
    }
  };
  const range = s.min !== null && s.max !== null ? `${fmt(s.min)} – ${fmt(s.max)}` : s.min !== null ? `From ${fmt(s.min)}` : `Up to ${fmt(s.max!)}`;
  return `${range} ${PERIOD_LABEL[s.period]}`;
}

/** The snippet a company pastes into its own site to list its open jobs (the Worker serves both parts). */
export function embedSnippet(origin: string, slug: string): string {
  const o = origin.replace(/\/+$/, "");
  return `<div data-orbit-jobs="${slug}"></div>\n<script async src="${o}/embed.js"></script>`;
}

export function iframeSnippet(origin: string, slug: string): string {
  const o = origin.replace(/\/+$/, "");
  return `<iframe src="${o}/embed/company/${encodeURIComponent(slug)}" title="Open jobs" style="width:100%;min-height:420px;border:0" loading="lazy"></iframe>`;
}

/** Whether the file can be sent as a resume: PDF or Word (DOCX), up to 5 MB. Null when fine, else why not. */
export function resumeFileProblem(file: Pick<File, "name" | "size">): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return "Upload a PDF or Word (.docx) file.";
  if (file.size > 5 * 1024 * 1024) return "That file is over 5 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A website as typed ("acme.com", "https://www.acme.com/about") → its domain, or null. */
export function domainOf(website: string): string | null {
  const w = website.trim();
  if (!w) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`).hostname.toLowerCase();
    if (!host.includes(".")) return null;
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function relTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dayTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
