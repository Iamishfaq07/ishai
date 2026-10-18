// The auto-apply contract with Orbit's API, as the extension sees it. Mirrors the server's schema (apps/api, the
// `apply` routes): keep the two in step. Every route is called with the extension's scoped bearer token.
//   GET  /v1/apply/next          -> 204 (nothing due) or an ApplicationPacket, leased to this browser for 15 minutes
//   POST /v1/apply/{id}/result   <- ApplyResult
//   GET  /v1/apply/status        -> ApplyStatus

export type Ats = "greenhouse" | "lever" | "ashby";

export interface PacketJob {
  url: string;
  apply_url: string;
  ats: Ats;
  company: string;
  title: string;
}

export interface PacketResume {
  filename: string;
  /** Fetched by the extension (with its bearer token when it's on Orbit's API). */
  download_url: string;
}

/** The candidate's standard details. Known keys first; the server may send more (e.g. country, current_company). */
export interface PacketFields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  github: string;
  [key: string]: string | undefined;
}

/** A pre-approved answer from the candidate's answer bank. Matched to a form question by question_id, else by label
 * (exact or normalized); never guessed. Consent and attestation checkboxes are only ticked from one of these. */
export interface PacketAnswer {
  question_id?: string | null;
  label: string;
  /** What kind of question it answers, e.g. "text", "textarea", "select", "multi_select", "radio", "checkbox",
   * "boolean", "consent". Informational: the form decides how it's entered. */
  kind: string;
  /** Text, the option to pick, several options (multi-select / checkbox group) or yes/no. */
  value: string | string[] | boolean;
  /** Where the answer came from (e.g. "bank", "profile", "candidate"). */
  source: string;
}

export interface ApplicationPacket {
  id: string;
  job: PacketJob;
  resume: PacketResume;
  cover_letter: string | null;
  fields: PacketFields;
  answers: PacketAnswer[];
  /** Voluntary EEO / diversity questions: "decline" picks the decline-to-self-identify option where there is one. */
  eeo: "decline";
  /** ISO times. Don't start before not_before; the lease ends at expires_at. */
  not_before: string;
  expires_at: string;
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

export interface UnknownQuestion {
  label: string;
  kind: string;
  options?: string[];
}

export interface SubmittedPayload {
  /** The standard fields as entered, by key (first_name, email…). */
  fields: Record<string, string>;
  /** Each question answered, with the form's own label and what was entered. */
  answers: { question_id: string | null; label: string; value: string | string[] | boolean }[];
}

export interface ApplyResult {
  status: ApplyStatusValue;
  reason: ApplyReason | null;
  unknown_questions: UnknownQuestion[];
  confirmation_text: string | null;
  final_url: string | null;
  /** PNG of the confirmation page, base64 without the data: prefix. At most 1.5 MB, else null. */
  screenshot_png_b64: string | null;
  submitted: SubmittedPayload;
}

export interface ApplyStatus {
  today: number;
  limit: number;
  paused: boolean;
  /** ISO time of the next application due, or null. */
  next_due: string | null;
}

export const MAX_SCREENSHOT_B64 = 1_500_000;
