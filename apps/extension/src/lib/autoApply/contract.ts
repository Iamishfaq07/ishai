// The auto-apply contract with Orbit's API, as the extension sees it. Mirrors the server: packages/types/src/autoApply.ts
// and docs/PROTOCOL.md "Orbit Apply" (the source of truth is apps/api/orbit_api/auto_apply/routes.py and packets.py):
// keep the two in step. Every route is called with the extension's scoped bearer token.
//   GET  /v1/apply/next          -> 204 (nothing due; Retry-After, X-Orbit-Apply-Why) or an ApplicationPacket, leased to
//                                   this browser for 15 minutes. Asking again while the lease runs returns the same one.
//   POST /v1/apply/{id}/result   <- ApplyResult. 409: not leased (a late result is still taken within 2 hours), 404:
//                                   not ours, 413: screenshot or payload too big, 422: a bad screenshot or field.
//   GET  /v1/apply/status        -> ApplyStatus
//   POST /v1/apply/pause|resume  -> {paused}: the same switch as the web app's

export type Ats = "greenhouse" | "lever" | "ashby";

export interface PacketJob<A extends string = Ats> {
  url: string;
  apply_url: string;
  ats: A;
  company: string;
  title: string;
}

export interface PacketResume {
  /** "<Name> - Resume.pdf". */
  filename: string;
  /** A signed link (15 minutes, no session needed) to the tailored resume as a PDF (application/pdf). */
  download_url: string;
}

/** The candidate's standard details, "" when they gave none. The server may send more keys. */
export interface PacketFields {
  first_name: string;
  last_name: string;
  full_name?: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  github: string;
  current_company?: string;
  current_title?: string;
  /** The country's name ("India"). */
  country?: string;
  [key: string]: string | undefined;
}

/** The value of an answer: text, an option's exact label, several labels (multi-select / checkbox group), or "Yes"/"No"
 * for a yes/no question or a checkbox. */
export type AnswerValue = string | string[];

/** A pre-approved answer from the candidate's answer bank. Matched to a form question by question_id, else by label
 * (exact or normalized); never guessed. Consent and attestation checkboxes are only ticked from one of these. */
export interface PacketAnswer {
  /** The ATS's own field name: Greenhouse `question_123` (or `gender`, `veteran_status`…), Lever `cards[<id>][field0]`,
   * Ashby the field path. Null when the question has none. */
  question_id?: string | null;
  label: string;
  /** "text", "textarea", "select", "multiselect", "boolean", "checkbox", "number", "date", "email", "phone", "url",
   * "file". Informational: the form decides how it's entered. */
  kind: string;
  value: AnswerValue;
  /** "bank", "profile" or "generated". */
  source: string;
  /** The server read the question as required: one that can't be entered is an unknown_question, even if the page
   * doesn't mark it. */
  required?: boolean;
  /** The options the server read on the form (select-type questions); `value` is one of them, exactly. */
  options?: string[] | null;
}

export interface ApplicationPacket<A extends string = Ats> {
  id: string;
  job: PacketJob<A>;
  resume: PacketResume;
  cover_letter: string | null;
  fields: PacketFields;
  answers: PacketAnswer[];
  /** Voluntary EEO / diversity questions: "decline" picks the decline-to-self-identify option where there is one;
   * "as_answered" uses the candidate's own answers in `answers`, and still declines a question they didn't answer. */
  eeo: "decline" | "as_answered";
  /** ISO times. Don't start before not_before; the packet is dropped after expires_at; report before
   * lease_expires_at. */
  not_before: string;
  expires_at: string;
  lease_expires_at?: string;
}

export type ApplyStatusValue = "submitted" | "needs_you" | "failed" | "skipped";
export type ApplyReason =
  | "captcha"
  | "login"
  | "email_verification"
  | "unknown_question"
  | "form_changed"
  | "blocked"
  | "error";

/** The kinds the server takes for an unknown question (anything else is refused with 422). */
export type QuestionKind =
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

export interface UnknownQuestion {
  label: string;
  kind: QuestionKind;
  options?: string[];
}

export interface SubmittedPayload {
  /** The standard fields as entered, by key (first_name, email…). */
  fields: Record<string, string>;
  /** Each question answered, with the form's own label and what was entered. */
  answers: { question_id: string | null; label: string; value: AnswerValue }[];
}

export interface ApplyResult {
  status: ApplyStatusValue;
  reason: ApplyReason | null;
  unknown_questions: UnknownQuestion[];
  confirmation_text: string | null;
  final_url: string | null;
  /** PNG of the confirmation page, base64 without the data: prefix. At most 1.5 MB, else null. The extension usually
   * can't take one (no access to every page): the confirmation text and final URL are the proof. */
  screenshot_png_b64: string | null;
  submitted: SubmittedPayload | null;
}

/** Why /next has nothing (X-Orbit-Apply-Why) and status.why_not. */
export type ApplyWhyNot = "not_set_up" | "paused" | "quiet_hours" | "daily_limit" | "busy" | "pacing" | "no_quota" | "none";

export interface ApplyStatus {
  configured: boolean;
  paused: boolean;
  /** Submitted today (the candidate's own day) plus the one in hand. */
  today: number;
  limit: number;
  /** ISO time of the next application due, or null. */
  next_due_at: string | null;
  why_not: ApplyWhyNot | string | null;
  ready: number;
  needs_you: number;
  quota_left: number;
  sites_paused: string[];
}

export const MAX_SCREENSHOT_B64 = 1_500_000;
/** The server's cap on `submitted` (JSON characters). */
export const MAX_PAYLOAD_CHARS = 200_000;
/** How long after a lease ends the server still takes its result. */
export const RESULT_GRACE_MS = 2 * 3600_000;
