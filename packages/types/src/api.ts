/** REST DTOs for /v1. Mirrors the FastAPI response models in apps/api. */

import type {
  AnswerLength,
  AnswerSource,
  AnswerStyle,
  LiveAnswer,
  QuestionType,
  Speaker,
} from "./events";

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  /** Signed up while sign-up approval was on and not given access yet: the app shows a "waiting" banner. */
  approval_pending?: boolean;
  /** Privacy controls (spec §65), account-wide. */
  store_transcripts: boolean;
  /** Always false: screenshots are analyzed and discarded, never stored. */
  store_screenshots: boolean;
  /** Auth responses only: browser clients echo it as X-CSRF-Token on state-changing requests. */
  csrf_token?: string | null;
}

/** GET /v1/auth/config (public): what sign-in / sign-up screens need before anyone is signed in. */
export interface AuthConfig {
  captcha: { provider: "turnstile"; site_key: string } | null;
  email_verification: "required" | "off";
}

/** PATCH /v1/auth/me/privacy → User */
export interface PrivacyUpdate {
  store_transcripts?: boolean;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
  /** The CAPTCHA widget's response token, when GET /v1/auth/config asks for one. */
  captcha_token?: string;
}

/**
 * POST /v1/auth/register when the server needs the inbox proven first (production): the same answer whether or not
 * the email already has an account, and nobody is signed in. The emailed link verifies; then the person signs in.
 */
export interface RegisterPending {
  status: "verify_email";
  email: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Web clients rely on the httpOnly cookie (the API leaves `access_token` out for the web app's own origin);
 * desktop stores access_token in the OS keychain.
 */
export interface AuthResponse {
  user: User;
  access_token?: string | null;
}

// ─── Documents ───────────────────────────────────────────────────────────────

export type DocumentKind = "resume" | "job_description" | "notes" | "other";
export type DocumentStatus = "processing" | "ready" | "failed";

export interface OrbitDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  filename: string | null;
  size_bytes: number;
  status: DocumentStatus;
  chunk_count: number;
  created_at: string;
}

export interface CreateTextDocumentRequest {
  title: string;
  kind: DocumentKind;
  text: string;
}

export interface DocumentText {
  id: string;
  title: string;
  kind: DocumentKind;
  editable: boolean;
  text: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  kind?: DocumentKind;
  text?: string;
}

export const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md";

// ─── Sessions ────────────────────────────────────────────────────────────────

export type SessionType = "interview" | "meeting" | "coding" | "assessment" | "phone" | "mock";
export type SessionStatus = "created" | "live" | "ended";

export type MockDifficulty = "easy" | "medium" | "hard";
export type MockInterviewType = "behavioral" | "technical" | "system_design" | "coding" | "mixed" | "negotiation";

/** Salary-negotiation practice (interview_type "negotiation"): the offer the AI recruiter presents. */
export interface NegotiationSetup {
  offer: string;
  company?: string;
  /** The candidate's goal: only the review sees it, never the recruiter. */
  target?: string;
}

export type MockPersona = "recruiter" | "hiring_manager" | "engineer" | "staff_engineer" | "executive";

export interface MockConfig {
  interview_type?: MockInterviewType;
  difficulty?: MockDifficulty;
  duration_minutes: number;
  persona?: MockPersona;
  /** A fixed list of questions, asked in order (re-drills, or questions from interview prep: kind "prep"). */
  drill?: Array<{ question: string; kind?: "retry" | "concise" | "prep"; follow_up?: boolean }>;
  /** Required when interview_type is "negotiation". */
  negotiation?: NegotiationSetup;
}

/** POST /v1/prep — likely interview questions from a job description, answered from the resume. */
export interface PrepRequest {
  job_description_id?: string;
  job_text?: string;
  resume_id?: string;
  role?: string;
  /** 4–12, default 8. */
  count?: number;
}

export type PrepCategory = "behavioral" | "technical" | "role" | "motivation" | "curveball";

export interface PrepQuestion {
  question: string;
  category: PrepCategory;
  /** Why this interviewer would ask it (the JD requirement behind it). */
  why: string;
  /** From the resume only. */
  talking_points: string[];
  /** First person, ready to say; "[…]" marks details the candidate fills in. */
  suggested_answer: string;
}

/** POST /v1/prep/import-link — a job posting read from a link (nothing stored). */
export interface ImportedJobPosting {
  url: string;
  title: string | null;
  company: string | null;
  text: string;
}

export interface PrepResponse {
  role: string | null;
  company: string | null;
  questions: PrepQuestion[];
  /** False when no resume was available (answers lean on "[fill in]" prompts). */
  grounded_in_resume: boolean;
}

export interface CreateSessionRequest {
  title: string;
  type: SessionType;
  role?: string;
  language: string;
  answer_language?: string;
  length: AnswerLength;
  style: AnswerStyle;
  auto_answer: boolean;
  document_ids: string[];
  /** Only sent for type === "mock". */
  mock?: MockConfig;
  /** Started from a saved setup (recorded; its documents are used if document_ids is empty). */
  workspace_id?: string;
  /** Standing instructions for every answer ("mention I'm relocating"); from the saved setup's notes if omitted. */
  instructions?: string;
}

/** A saved interview setup ("Google — Senior Security Engineer"). */
export interface WorkspaceInput {
  name: string;
  company?: string | null;
  role?: string | null;
  session_type: SessionType;
  language: string;
  answer_language?: string | null;
  length: AnswerLength;
  style: AnswerStyle;
  auto_answer: boolean;
  notes?: string | null;
  document_ids: string[];
}

export interface Workspace extends WorkspaceInput {
  id: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  session_count: number;
}

/** GET /v1/preflight — can a live session work right now, and what to do if not. */
export interface PreflightCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string | null;
  latency_ms?: number | null;
  /** "blocker": a failure here means a live interview can't work (Start is disabled). Warnings never block. */
  severity?: "blocker" | "warning";
}

export interface PreflightReport {
  checks: PreflightCheck[];
  ok: boolean;
}

export interface OrbitSession {
  id: string;
  title: string;
  type: SessionType;
  role: string | null;
  language: string;
  answer_language: string | null;
  length: AnswerLength;
  style: AnswerStyle;
  auto_answer: boolean;
  status: SessionStatus;
  document_ids: string[];
  question_count: number;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  /** Ended sessions: the report is written by a background job after the session ends. */
  report_status?: "pending" | "ready" | "failed" | null;
  workspace_id?: string | null;
}

export interface SessionTurn {
  id: string;
  speaker: Speaker;
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface SessionQuestion {
  id: string;
  text: string;
  type: QuestionType;
  is_follow_up: boolean;
  source: AnswerSource;
  created_at: string;
}

export interface SessionAnswer {
  id: string;
  question_id: string | null;
  content: LiveAnswer;
  model: string | null;
  first_token_ms: number | null;
  total_ms: number | null;
  /** The user's rating of this answer, if any. */
  feedback?: AnswerFeedback | null;
}

// ─── Answer feedback ─────────────────────────────────────────────────────────

export type AnswerRating = "up" | "down";
/** Why an answer got 👎. Repeated reasons become style hints in later sessions. */
export type AnswerFeedbackReason = "too_long" | "too_generic" | "inaccurate" | "off_topic" | "too_formal";

export interface AnswerFeedback {
  rating: AnswerRating;
  reason: AnswerFeedbackReason | null;
}

/** GET /v1/admin/feedback — answer ratings (counts only, no content). */
export interface FeedbackReport {
  days: number;
  up: number;
  down: number;
  satisfaction: number | null;
  reasons: Partial<Record<AnswerFeedbackReason, number>>;
  by_type: Array<{ key: string; up: number; down: number }>;
  by_model: Array<{ key: string; up: number; down: number }>;
  /** Rated answers / completed answers in the period. */
  rated_share: number | null;
}

/** One interviewer question, graded on what the candidate actually said after it. */
export interface ReviewItem {
  question: string;
  /** The candidate's own words (from the transcript); "" when they didn't answer. */
  you_said: string;
  /** 1–5, or null when the question wasn't answered. */
  score: number | null;
  feedback: string;
  /** A stronger way to say it (first person). */
  better: string;
}

export interface SessionReview {
  overall_score: number | null;
  strengths: string[];
  improvements: string[];
  practice: string[];
  items: ReviewItem[];
}

export interface SessionSummary {
  summary: string;
  topics: string[];
  important_follow_ups: string[];
  potential_weak_areas: string[];
  suggested_preparation: string[];
  questions_asked: string[];
  question_types: Partial<Record<QuestionType, number>>;
  follow_up_count: number;
  /** Post-session scorecard; absent on summaries made before reviews existed. */
  review?: SessionReview | null;
  /** Speaking feedback from the transcript (no model call); null when there was too little speech. */
  delivery?: DeliveryStats | null;
  /** The debrief + thank-you email, once generated (POST /v1/sessions/{id}/follow-up). */
  follow_up?: FollowUp | null;
}

export interface DeliveryStats {
  speaking_seconds: number;
  words: number;
  words_per_minute: number;
  fillers_total: number;
  fillers_per_minute: number;
  top_fillers: Array<{ word: string; count: number }>;
  /** Your share of the talking time (0–1); null when only your side was captured. */
  talk_share: number | null;
  answers: number;
  average_answer_words: number | null;
  longest_answer_words: number | null;
  tips: string[];
}

export interface FollowUp {
  debrief: { went_well: string[]; to_improve: string[]; promised: string[]; next_steps: string[] };
  thank_you: { subject: string; body: string };
}

/** GET /v1/progress — ended sessions (oldest first) with score and speaking stats, plus a summary. */
export interface ProgressPoint {
  id: string;
  title: string;
  type: SessionType;
  ended_at: string | null;
  overall_score: number | null;
  words_per_minute: number | null;
  fillers_per_minute: number | null;
  talk_share: number | null;
}

export interface Progress {
  points: ProgressPoint[];
  summary: {
    sessions: number;
    this_week: number;
    streak_days: number;
    average_score_recent: number | null;
    average_score_before: number | null;
    latest_tips: string[];
  };
}

export interface SessionDetail {
  session: OrbitSession;
  turns: SessionTurn[];
  questions: SessionQuestion[];
  answers: SessionAnswer[];
  summary: SessionSummary | null;
}

export interface LiveTicket {
  ticket: string;
  expires_in: number;
}

// ─── Story bank ──────────────────────────────────────────────────────────────

/** Competencies behavioral interviews probe (matches orbit_api/stories/routes.py COMPETENCIES). */
export const STORY_COMPETENCIES = [
  "leadership",
  "teamwork",
  "conflict",
  "failure",
  "ownership",
  "impact",
  "ambiguity",
  "customer",
  "influence",
  "learning",
  "technical",
  "deadline",
] as const;
export type StoryCompetency = (typeof STORY_COMPETENCIES)[number];

/** A real example in STAR form, reused in every live session as a verified fact for behavioral answers. */
export interface StoryInput {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  competencies: StoryCompetency[];
}

export interface Story extends StoryInput {
  id: string;
  created_at: string;
  updated_at: string;
}

/** POST /v1/stories/draft — drafts from the newest resume (several) or from rough notes (one). Not saved. */
export interface StoryDraftRequest {
  source: "resume" | "notes";
  notes?: string;
  resume_id?: string;
  count?: number;
}

export interface StoryDraftResponse {
  stories: StoryInput[];
  /** False when drafting from the resume found none to draft from. */
  grounded: boolean;
}

// ─── Phone companion ─────────────────────────────────────────────────────────

/** POST /v1/sessions/{id}/companion — the code a phone scans (valid until the session ends or `expires_in` s). */
export interface CompanionShare {
  code: string;
  expires_in: number;
}

/** POST /v1/companion/{code} (no login) — a single-use ticket for WS /v1/sessions/{id}/view. */
export interface CompanionView {
  session_id: string;
  title: string;
  ticket: string;
}

// ─── Screenshots (Phase 7) ───────────────────────────────────────────────────

/** POST /v1/sessions/{id}/screenshots (multipart `image`); the answer streams over the live socket. */
export interface ScreenshotAccepted {
  screenshot_id: string;
}

// ─── Usage / billing ─────────────────────────────────────────────────────────

/** "pending": a new account waiting for the admin (sign-up approval), with nothing included. */
export type PlanId = "free" | "pro" | "unlimited" | "pending";

/** GET /v1/plans (public) — what each plan includes. The server is the only source of limits and prices. */
export interface PlanInfo {
  name: PlanId;
  label: string;
  live_minutes: number | null;
  mock_minutes: number | null;
  screenshots: number | null;
  documents: number | null;
  max_session_minutes: number;
  features: string[];
  price_usd_month: number | null;
  /** Interview minutes and resume AI come from credits (the Free plan), not a monthly allowance. */
  credits?: boolean;
  /** Credit plans: what a new account starts with. */
  welcome?: { resume_credits: number; interview_minutes: number };
}

// ─── Credits and UPI payments ──────────────────────────────────────────────────

/** GET /v1/billing/packs (public) — a credit pack for sale over UPI. Credits never expire. */
export interface CreditPack {
  id: string;
  label: string;
  price_inr: number;
  resume_credits: number;
  interview_minutes: number;
  /** Can be bought right now (the server has a UPI ID). */
  buyable: boolean;
}

export type UpiOrderStatus = "awaiting_payment" | "submitted" | "approved" | "rejected";

/** A UPI payment for a credit pack: pay, give the UTR, the admin approves it, the credits land. */
export interface UpiOrder {
  id: string;
  pack: string;
  label: string;
  amount_inr: number;
  resume_credits: number;
  interview_minutes: number;
  /** Goes in the UPI note, so the payment can be matched. */
  reference: string;
  status: UpiOrderStatus;
  utr: string | null;
  /** The admin's reason (rejected), or a note on approval. */
  note: string | null;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  /** How to pay, while there's still something to pay. `upi_uri` is shown as a QR and, on phones, a tap-through link. */
  upi_id: string | null;
  payee_name: string | null;
  upi_uri: string | null;
}

export interface AdminPayment extends Omit<UpiOrder, "upi_id" | "payee_name" | "upi_uri"> {
  user_id: string;
  email: string;
  name: string | null;
  /** The plan the account has right now (a running grant), if any. */
  current_plan: string | null;
  current_until: string | null;
}

export interface AdminPayments {
  upi_configured: boolean;
  /** Payments with a UTR waiting to be checked. */
  waiting: number;
  payments: AdminPayment[];
}

/** GET /v1/resumes/allowance: resume credits left (one per AI action), and the cheapest pack that adds more. */
export interface ResumeAiAllowance {
  /** The plan includes resume AI: no credits needed. */
  unlimited: boolean;
  credits_left: number;
  upgrade: { pack: string; label: string; price_inr: number; resume_credits: number; interview_minutes: number; buyable: boolean } | null;
}

/** GET /v1/entitlements — the signed-in user's plan, limits, this month's usage, features and credits. */
export interface Entitlements {
  plan: PlanId;
  label: string;
  /** When the admin granted this plan for a while: when it runs out (ISO). */
  until?: string | null;
  limits: {
    live_minutes: number | null;
    mock_minutes: number | null;
    screenshots: number | null;
    documents: number | null;
    max_session_minutes: number;
  };
  usage: { live_minutes: number; mock_minutes: number; screenshots: number; documents: number };
  features: Record<string, boolean>;
  /** Credit plans (Free): what's left to spend; it never expires. Null on plans with their own allowance. */
  credits?: { resume: number | null; interview_minutes_left: number; interview_minutes_total: number } | null;
}

export interface Usage {
  plan: PlanId;
  live_minutes_used: number;
  live_minutes_limit: number | null;
  screenshots_used: number;
  screenshots_limit: number | null;
}

// ─── Admin / advanced settings ─────────────────────────────────────────────────

/** Admin → Users & access: one account and what it may use. */
export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  email_verified: boolean;
  /** admin: always full access · pending: waiting for you · granted: a plan until grant_until · approved: for good */
  access: "admin" | "pending" | "granted" | "approved";
  plan_label: string;
  grant_until: string | null;
  live_minutes_this_month: number;
  /** Credits left (Free plan balance; never expires). */
  resume_credits: number;
  interview_minutes_left: number;
}

export interface AdminUsers {
  approval_required: boolean;
  users: AdminUser[];
}

export type AccessChange =
  | { action: "grant"; plan: "pro" | "unlimited"; hours: number }
  | { action: "approve" }
  | { action: "revoke" };

export interface AdminConfig {
  /** False when ORBIT_CONFIG_SECRET isn't set, so API keys can't be stored in-app. */
  secrets_editable: boolean;
  llm_provider: string;
  stt_provider: string;
  deepseek_base_url: string;
  deepseek_model: string;
  deepseek_reasoning_model: string;
  deepgram_model: string;
  /** Whether a key is present; the plaintext is never returned. */
  deepseek_api_key_set: boolean;
  deepgram_api_key_set: boolean;
}

/** Omit a field to leave it unchanged; send "" for a secret to clear it (revert to env). */
export interface AdminConfigUpdate {
  llm_provider?: string;
  stt_provider?: string;
  deepseek_base_url?: string;
  deepseek_model?: string;
  deepseek_reasoning_model?: string;
  deepgram_model?: string;
  deepseek_api_key?: string;
  deepgram_api_key?: string;
}

export type LatencyMetric =
  | "stt_first_partial"
  | "stt_final"
  | "question_after_speech"
  | "first_token_after_speech"
  | "first_token_after_question";

/** GET /v1/admin/latency — live-latency percentiles (ms) across recent sessions. */
export interface LatencyReport {
  days: number;
  sessions: number;
  metrics: Partial<Record<LatencyMetric, { n: number; p50: number; p95: number; p99: number }>>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** FastAPI returns { detail: string | ValidationError[] }; Orbit errors use { error: { code, message } }. */
export interface ApiErrorBody {
  detail?: string | Array<{ msg: string; loc?: Array<string | number> }> | { code?: string; message?: string };
  error?: { code: string; message: string };
}

/** GET /v1/admin/costs — estimated provider spend (admin). Unpriced LLM calls are counted, never shown as $0. */
export interface CostReport {
  days: number;
  has_data: boolean;
  totals: { usd: number; llm_usd: number; stt_usd: number | null; vision_usd: number; unpriced_llm_requests: number };
  live: {
    hours: number;
    sessions: number;
    stt_minutes: number;
    usd_per_hour: number | null;
    usd_per_session: number | null;
    screenshots: number;
  };
  llm: {
    requests: number;
    cache_hit_ratio: number | null;
    tokens_per_answer: { input: number | null; output: number | null };
    fallback_requests: number;
    by_model: Array<{
      provider: string;
      model: string;
      requests: number;
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      usd: number;
      unpriced: number;
      failed: number;
    }>;
    by_type: Record<string, { requests: number; usd: number; unpriced: number }>;
  };
  per_user: Array<{ user_id: string; email: string | null; plan: string | null; llm_usd: number; stt_usd: number; usd: number }>;
  per_plan: Record<string, { users: number; usd: number }>;
  notes: { stt_price_per_minute: number | null; stt: string; unpriced: string };
}

// ─── Resume maker ────────────────────────────────────────────────────────────

export type ResumeSectionId = "summary" | "experience" | "education" | "skills" | "projects" | "certifications";
/** A place in `section_order`: a standard section, or "extra:<id>" for one of `extras`. */
export type ResumeSectionKey = ResumeSectionId | `extra:${string}`;
export type ResumeTemplate = "classic" | "modern" | "compact" | "sidebar";
export type ResumeFont = "inter" | "arial" | "georgia" | "garamond" | "grotesk";
export type ResumeSpacing = "compact" | "normal" | "relaxed";

export interface ResumeLink {
  label: string;
  url: string;
}

export interface ResumeBasics {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: ResumeLink[];
  summary: string;
}

export interface ResumeExperience {
  id: string;
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
}

export interface ResumeEducation {
  id: string;
  school: string;
  degree: string;
  field: string;
  start: string;
  end: string;
  details: string;
}

export interface ResumeSkillGroup {
  id: string;
  name: string;
  items: string[];
}

export interface ResumeProject {
  id: string;
  name: string;
  link: string;
  description: string;
  bullets: string[];
}

export interface ResumeCertification {
  id: string;
  name: string;
  issuer: string;
  date: string;
}

/** A section beyond the standard ones: Languages, Awards, Volunteering… One line per item. */
export interface ResumeExtraSection {
  id: string;
  title: string;
  items: string[];
  /** A bulleted list, or the items run together on one line ("English · Spanish"). */
  style: "bullets" | "inline";
}

export interface ResumeData {
  basics: ResumeBasics;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkillGroup[];
  projects: ResumeProject[];
  certifications: ResumeCertification[];
  extras: ResumeExtraSection[];
  section_order: ResumeSectionKey[];
}

export interface ResumeDesign {
  template: ResumeTemplate;
  /** #rrggbb */
  accent: string;
  font: ResumeFont;
  /** Points (9–12.5). */
  font_size: number;
  spacing: ResumeSpacing;
  page: "a4" | "letter";
  /** A data: URL (PNG/JPEG/WebP), shrunk before upload. */
  photo: string | null;
  show_photo: boolean;
}

export interface ResumeInput {
  title: string;
  data: ResumeData;
  design: ResumeDesign;
  job_text: string;
  /** Left out, the saved letter is kept as it is. */
  cover_letter?: string;
}

export interface Resume extends ResumeInput {
  cover_letter: string;
  id: string;
  created_at: string;
  updated_at: string;
}

export interface ResumeSummary {
  id: string;
  title: string;
  name: string;
  headline: string;
  template: ResumeTemplate;
  score: number;
  has_job: boolean;
  updated_at: string;
}

export type AtsCategoryId =
  | "contact"
  | "sections"
  | "summary"
  | "experience"
  | "skills"
  | "readability"
  | "layout"
  | "keywords";

export interface AtsCheck {
  id: string;
  category: AtsCategoryId;
  label: string;
  points: number;
  max_points: number;
  passed: boolean;
  fix: string | null;
  /** What the fix is about: "basics.email", "experience.<id>.bullets.2", "skills", "design.template"… */
  target: string | null;
  /** "Fix with AI" can rewrite the target text. */
  ai_fixable: boolean;
  /** How it gets fixed: "ai" (a resume credit), "auto" (worked out without the AI, free), "you" (only you know it). */
  fix_kind?: "ai" | "auto" | "you" | null;
  /** Every line the problem is on. */
  paths?: string[];
}

/** A writing problem on one line (a bullet, the summary), shown under that line in the editor. */
export interface ResumeLineIssue {
  path: string;
  kind: "weak_opener" | "passive" | "filler" | "tense" | "duplicate" | "casing";
  message: string;
  /** "casing" only: the whole line with the names fixed, applied as is. */
  fixed: string | null;
}

export interface AtsReport {
  score: number;
  verdict: string;
  categories: Array<{ id: AtsCategoryId; label: string; points: number; max_points: number }>;
  checks: AtsCheck[];
  keywords: { matched: string[]; missing: string[] } | null;
  has_job: boolean;
  /** Line-by-line writing issues; absent from servers older than the check. */
  issues?: ResumeLineIssue[];
}

export interface ResumeImportRequest {
  source: "text" | "linkedin" | "document";
  text?: string;
  document_id?: string;
}

export interface ResumeImportResponse {
  data: ResumeData;
  title: string;
}

/**
 * One change the editor can apply. `rewrite` and `set` replace the text at `path` (which must still equal `before`);
 * `add_skill` adds the comma-separated skills in `after`; `add_bullet` appends `after` to the role at
 * "experience.<id>.bullets.+". `confirm` is a warning the candidate must read: the AI can't know it's true.
 */
export type ResumeSuggestionKind = "rewrite" | "add_skill" | "add_bullet" | "set";

export interface ResumeSuggestion {
  id: string;
  /** The exact text it replaces, e.g. "experience.<id>.bullets.1" or "basics.summary". */
  path: string;
  label: string;
  before: string;
  after: string;
  reason: string;
  kind?: ResumeSuggestionKind;
  confirm?: string | null;
}

/** "Fix with AI" from the ATS score: one check (`check`), or everything. */
export interface ResumeFixRequest {
  data: ResumeData;
  design: ResumeDesign;
  job_text: string;
  check?: string;
  /** Your answers to `questions`: path -> "about 40 a week". */
  facts?: Record<string, string>;
  /** From the fix that asked the questions: writing your answers in is part of it (free). */
  followup?: string;
}

/** A number only you know, asked about one line. */
export interface ResumeFixQuestion {
  path: string;
  text: string;
  question: string;
}

export interface ResumeFixResponse {
  /** Apply in order; each replaces the text that was sent (`before`). */
  suggestions: ResumeSuggestion[];
  /** Not in your resume yet (skills from the job post, bullets drafted from a job title): keep or skip each. */
  review: ResumeSuggestion[];
  questions: ResumeFixQuestion[];
  design: Partial<ResumeDesign>;
  /** Experience ids, most recent first. */
  order: string[] | null;
  score_before: number;
  score_after: number;
  /** Still failing, of what was asked. */
  remaining: AtsCheck[];
  upgrade_required: boolean;
  ai_error: string | null;
  /** Send back with the answers to `questions`. */
  followup: string | null;
}

export interface ResumeSuggestRequest {
  data: ResumeData;
  design?: ResumeDesign;
  job_text?: string;
  mode?: "improve" | "tailor";
  /** Rewrite just this one field. */
  focus?: string;
  /** Fix this ATS check, by id ("skills_count", "dates", "quantified"…). */
  check?: string;
}
