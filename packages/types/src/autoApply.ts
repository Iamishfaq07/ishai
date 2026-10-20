/**
 * Orbit Apply (docs/DECISIONS.md D84, docs/PROTOCOL.md "Orbit Apply"): the server plans each application and the
 * candidate's own device submits it.
 *
 * Two halves:
 * - the **executor contract** (`ApplyPacket`, `ApplyResult`, `ApplyStatus`), which the browser extension and the
 *   Windows app implement against `GET /v1/apply/next`, `POST /v1/apply/{id}/result` and `GET /v1/apply/status`. An
 *   extension-scoped token works for these three and nothing else;
 * - the **web app's** setup, answer bank and Applications view (`/v1/apply/setup`, `/bank`, `/packets`...).
 */

// ---- the executor contract -------------------------------------------------------------------------------------

/** The ATSs Orbit submits to from the candidate's device. Job boards are never automated. */
export type ApplyAts = "greenhouse" | "lever" | "ashby";
export type HostedApplyAts = ApplyAts | "workday" | "smartrecruiters" | "workable" | "recruitee";

/** Where an answer came from: the candidate's answer bank, their confirmed profile facts, or text Orbit wrote for
 *  this job from those facts (a "why this company" answer, the cover letter, how they found the post). */
export type ApplyAnswerSource = "bank" | "profile" | "generated";

export type ApplyQuestionKind =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "boolean"
  | "file"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "url"
  | "checkbox";

export interface ApplyAnswer {
  /** The ATS's own field name or id (Greenhouse `question_123`, Lever `cards[<id>][field0]`, Ashby the field path);
   *  null when the question has no id (a hand-off's ready-to-copy answers). */
  question_id: string | null;
  label: string;
  kind: ApplyQuestionKind | string;
  /** For a select, the option's exact label; for a multiselect, the labels; for a boolean or checkbox, "Yes"/"No". */
  value: string | string[];
  source: ApplyAnswerSource;
  required?: boolean;
  /** The form's options, as read, for select-type questions. */
  options?: string[] | null;
}

/** The standard fields every form asks for, from the candidate's confirmed facts. "" when they didn't give one. */
export interface ApplyFields {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  github: string;
  current_company: string;
  current_title: string;
  /** The country's name ("India"), where the candidate lives. */
  country: string;
  [key: string]: string;
}

/** `GET /v1/apply/next` (200): the next due application, leased to this device for 15 minutes. 204 when nothing is
 *  due; then `Retry-After` (seconds) says when to ask again, and `X-Orbit-Apply-Why` why (`ApplyWhyNot`). */
export interface ApplyPacket {
  id: string;
  job: { url: string; apply_url: string; ats: ApplyAts; company: string; title: string };
  /** The tailored resume as a PDF: `download_url` is signed and works for 15 minutes without a session. */
  resume: { filename: string; download_url: string };
  /** Short, true; ends with "Prepared with Orbit AI from my verified profile." unless the candidate turned it off. */
  cover_letter: string | null;
  fields: ApplyFields;
  /** Every question Orbit read on the form and answered. Questions left out are optional ones with no truthful
   *  answer: leave them blank. A required question that isn't here and isn't a standard field is an
   *  `unknown_question`: report it, never guess. */
  answers: ApplyAnswer[];
  /** Voluntary self-identification: "decline" (the default) or "as_answered" (the candidate chose answers, which
   *  are in `answers`). */
  eeo: "decline" | "as_answered";
  /** Don't submit before this. */
  not_before: string;
  /** The packet itself is dropped after this (the post may have changed). */
  expires_at: string;
  /** Report a result before this, or the lease ends and the packet goes back in the queue. */
  lease_expires_at: string;
}

export type ApplyResultStatus = "submitted" | "needs_you" | "failed" | "skipped";
export type ApplyResultReason =
  | "captcha"
  | "login"
  | "email_verification"
  | "unknown_question"
  | "form_changed"
  | "blocked"
  | "error";

/** `POST /v1/apply/{id}/result`. Captchas, logins and email checks are never solved: report `needs_you`. */
export interface ApplyResult {
  status: ApplyResultStatus;
  reason: ApplyResultReason | null;
  unknown_questions?: Array<{ label: string; kind?: ApplyQuestionKind; options?: string[] | null }>;
  confirmation_text?: string | null;
  final_url?: string | null;
  /** The confirmation page (or the page it stopped on), PNG, base64, 1.5 MB at most. */
  screenshot_png_b64?: string | null;
  /** What was actually put in the form. */
  submitted?: { fields: Record<string, unknown>; answers: Array<Record<string, unknown>> } | null;
}

export interface ApplyResultResponse {
  id: string;
  /** The packet's status now ("submitted", "needs_you", "failed", "skipped"). */
  status: string;
  /** Only a confirmed submission is charged. */
  charged: boolean;
  tracker_id: string | null;
}

/** Why `GET /v1/apply/next` has nothing right now. */
export type ApplyWhyNot =
  | "not_set_up"
  | "paused"
  | "quiet_hours"
  | "daily_limit"
  | "busy"
  | "pacing"
  | "no_quota"
  | "none";

/** `GET /v1/apply/status`, for the extension's popup. */
export interface ApplyStatus {
  configured: boolean;
  paused: boolean;
  /** Submitted today (the candidate's own day) plus one in hand. */
  today: number;
  limit: number;
  next_due_at: string | null;
  why_not: ApplyWhyNot | null;
  ready: number;
  needs_you: number;
  quota_left: number;
  sites_paused: string[];
  /** When an executor (the extension, with auto-apply switched on) last asked for work; null: never. */
  executor_seen_at: string | null;
}

// ---- the web app -------------------------------------------------------------------------------------------------

export type ApplyMode = "automatic" | "review";
export type ApplyLevel = "fresher" | "junior" | "mid" | "senior";
export type ApplyWorkplace = "remote" | "hybrid" | "onsite";

export interface ApplyWorkAuth {
  country: string;
  authorized: boolean | null;
  needs_sponsorship: boolean | null;
}

/** The facts the candidate confirms. Empty is never guessed: a form asking for it stops and asks them. */
export interface ApplyFacts {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  website: string;
  github: string;
  current_company: string;
  current_title: string;
  years_experience: number | null;
  highest_degree: string;
  work_auth: ApplyWorkAuth[];
  notice_period_days: number | null;
  earliest_start: string;
  willing_to_relocate: boolean | null;
  expected_salary: string;
  current_salary: string;
}

export interface ApplyFilters {
  titles: string[];
  keywords: string[];
  locations: string[];
  workplace: ApplyWorkplace[];
  countries: string[];
  seniority: ApplyLevel[];
  salary_floor: number | null;
  exclude_companies: string[];
  days: number;
}

export interface ApplyQuietHours {
  start: number;
  end: number;
}

export interface ApplyQuota {
  plan: string;
  included: number;
  used: number;
  credits: number;
  left: number;
  /** The Free plan's applications: once per account. */
  trial: boolean;
}

export interface ApplyCaps {
  max_daily_limit: number;
  default_daily_limit: number;
  per_company: number;
  per_company_days: number;
  max_fresh_days: number;
  min_threshold: number;
  free_trial: number;
}

export interface ApplyAgentState {
  enabled: boolean;
  used_today: number;
  daily_allowance: number;
  applications: Array<{
    id: string; title: string; company: string; status: ApplyPacketStatus;
    decisions: Array<{
      at: string;
      state: "observing" | "matched" | "needs_you" | "cancelled" | "allowance_used" | "unavailable";
      questions: string[];
      matches: Array<{ label: string; source: string }>;
      provider: string | null;
    }>;
  }>;
}

export interface ApplySetup {
  stop_when_hired?: boolean;
  execution?: "browser" | "hosted";
  hosted_enabled?: boolean;
  hosted_online?: boolean;
  hosted_seen_at?: string | null;
  hosted_consent_at?: string | null;
  hosted_consent_text?: string;
  hosted_sites?: HostedApplyAts[];
  configured: boolean;
  consent_at: string | null;
  consent_text: string;
  consent_version: string;
  ai_line_text: string;
  mode: ApplyMode;
  daily_limit: number;
  threshold: number;
  ai_line: boolean;
  paused: boolean;
  /** When the browser extension (auto-apply switched on there) last asked for work; null: never. Nothing is sent
   *  without it. */
  executor_seen_at: string | null;
  quiet_hours: ApplyQuietHours | null;
  tz_offset_min: number;
  resume: { id: string; title: string; approved: boolean; approved_at: string | null; changed_since: boolean } | null;
  resumes: Array<{ id: string; title: string }>;
  facts: ApplyFacts;
  facts_suggested: boolean;
  filters: ApplyFilters;
  profile_titles: string[];
  quota: ApplyQuota;
  caps: ApplyCaps;
}

export interface ApplySetupInput {
  stop_when_hired?: boolean;
  execution?: "browser" | "hosted";
  hosted_consent?: boolean;
  resume_id: string | null;
  approve_resume: boolean;
  facts: ApplyFacts;
  filters: ApplyFilters;
  mode: ApplyMode;
  daily_limit: number;
  threshold: number;
  ai_line: boolean;
  quiet_hours: ApplyQuietHours | null;
  tz_offset_min: number;
  consent: boolean;
}

export interface ApplyBankItem {
  norm: string;
  key: string;
  label: string;
  kind: string;
  value: string;
  /** What Orbit answers while `value` is empty ("" for nothing: a form asking stops and asks the candidate). */
  default: string;
  group: "legal" | "eeo" | "yours" | "custom";
  help: string;
}

export interface ApplyPlanReport {
  created: number;
  considered: number;
  blocked: string | null;
  skipped: Array<{ listing_id: string; title: string; company: string; reason: string }>;
}

export type ApplyGroup = "prepared" | "applied" | "needs_you" | "skipped";
export type ApplyPacketStatus =
  | "needs_answer"
  | "review"
  | "ready"
  | "leased"
  | "submitted"
  | "applied"
  | "needs_you"
  | "handoff"
  | "failed"
  | "skipped"
  | "cancelled"
  | "expired";

export interface ApplyPacketSummary {
  submission_uncertain?: boolean;
  id: string;
  listing_id: string;
  status: ApplyPacketStatus;
  group: ApplyGroup;
  ats: string;
  site: string | null;
  company: string;
  title: string;
  url: string;
  apply_url: string;
  match_score: number;
  match_reason: string;
  reason: string;
  missing: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  has_proof: boolean;
}

export interface ApplyMissingQuestion {
  question_id: string | null;
  label: string;
  kind: string;
  required: boolean;
  options: string[] | null;
  why: string;
  bank_key: string;
  legal: boolean;
}

export interface ApplyResumeChange {
  kind: "reorder" | "rephrase";
  section: string;
  label: string;
  before: string;
  after: string;
}

export interface ApplyPacketDetail extends ApplyPacketSummary {
  /** Exact cached description captured when these materials were prepared; null for legacy packets. */
  posting_text?: string | null;
  employer_status_path?: string | null;
  resume_title: string;
  resume_diff: ApplyResumeChange[];
  cover_letter: string | null;
  fields: Partial<ApplyFields>;
  answers: ApplyAnswer[];
  missing_questions: ApplyMissingQuestion[];
  unknown_questions: Array<{ label: string; kind?: string; options?: string[] | null }>;
  form_source: "fetched" | "standard";
  result_status: string | null;
  result_reason: string | null;
  confirmation_text: string | null;
  final_url: string | null;
  submitted: { fields: Record<string, unknown>; answers: Array<Record<string, unknown>> } | null;
  screenshot_url: string | null;
  resume_pdf_url: string;
  tracker_id: string | null;
}
