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
  /** False when the account was created with Google and has not set a password yet. */
  has_password?: boolean;
  /** Signed up while sign-up approval was on and not given access yet: the app shows a "waiting" banner. */
  approval_pending?: boolean;
  /** Privacy controls (spec §65), account-wide. */
  store_transcripts: boolean;
  /** The country they're applying for jobs in (ISO 3166-1 alpha-2): currency, sample salaries, job search and
   *  wording follow it. Null until set (the app fills it in from the browser's guess). */
  country?: string | null;
  /** Always false: screenshots are analyzed and discarded, never stored. */
  store_screenshots: boolean;
  /** The Career Evidence Vault is switched on for this deployment. Servers from before it leave it out. */
  evidence_vault?: boolean;
  /** Mock-interview languages this server offers: ["en"], or with Hindi and Hinglish when it has them on. */
  practice_languages?: string[];
  /** The camera coach in mock interviews is on for this server. */
  video_mock?: boolean;
  /** Auth responses only: browser clients echo it as X-CSRF-Token on state-changing requests. */
  csrf_token?: string | null;
}

/** GET /v1/auth/config (public): what sign-in / sign-up screens need before anyone is signed in. */
export interface AuthConfig {
  captcha: { provider: "turnstile"; site_key: string } | null;
  email_verification: "required" | "off";
  /** Continue with Google is set up on this server. */
  google?: boolean;
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
  /** The browser's guess at the country they're applying in (ISO 3166-1 alpha-2). */
  country?: string;
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

/** POST /v1/auth/login when two-step sign-in is on: the password was right; the authenticator code comes next. */
export interface TwoFactorChallenge {
  two_factor_required: true;
  challenge: string;
}

/** GET /v1/auth/passkeys: one passkey (only its public key is on the server). */
export interface Passkey {
  id: string;
  name: string;
  /** Synced by a password manager (iCloud Keychain, Google Password Manager…) rather than kept on one device. */
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

/** WebAuthn options as JSON (binary fields base64url), from /v1/auth/passkeys/options and /login/passkey/options. */
export interface PasskeyOptions {
  options: Record<string, unknown>;
}

/** GET /v1/voice: the mock interviewer's natural voice, when the server offers it. */
export interface VoiceStatus {
  available: boolean;
  voices: { id: string; label: string; model: string }[];
  default_voice: string;
  /** Characters of natural voice left today; null = no cap. */
  chars_left: number | null;
}

/** GET /v1/auth/2fa */
export interface TwoFactorStatus {
  enabled: boolean;
  recovery_left: number;
  enabled_at: string | null;
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
  /** A new version of this document (if it's still yours): updated in place instead of copied. */
  replace_id?: string;
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
  interview_stage?: string | null;
  tech_stack?: string[];
  key_requirements?: string[];
  adaptive_depth?: boolean;
  interview_type?: MockInterviewType;
  difficulty?: MockDifficulty;
  duration_minutes: number;
  persona?: MockPersona;
  /** A panel interview: two or three different interviewers taking turns (not for drills or negotiations). */
  panel?: MockPersona[];
  /** The AI video interview: the video-call room (interviewer tile, your camera, captions). Same live interview. */
  video?: boolean;
  /** What the interview is about ("React performance"): every question tests it, resume and job post as context. */
  topic?: string | null;
  /** A one-way (recorded, HireVue-style) video interview: thinking time, then a fixed time to answer each prompt. */
  one_way?: { think_seconds: number; answer_seconds: number };
  /** A fixed list of questions, asked in order (re-drills, or questions from interview prep: kind "prep"). */
  drill?: Array<{
    question: string;
    /** "story": a question a story-bank story answers ("Practise telling it"), tested by its follow-up. */
    kind?: "retry" | "concise" | "prep" | "story" | "answer";
    follow_up?: boolean;
    /** Steers the follow-up, never read out: what was weak last time, or (prep) where to push on the claim. */
    feedback?: string;
  }>;
  /** Required when interview_type is "negotiation". */
  negotiation?: NegotiationSetup;
  /** The company being practised for: a known one is interviewed in its style (GET /v1/interview-styles). A
   *  negotiation names its company in `negotiation` instead. */
  company?: string;
}

/** GET /v1/interview-styles: how a well-known company interviews, as candidates commonly report it. */
export interface CompanyStyle {
  slug: string;
  name: string;
  aliases: string[];
  rounds: string[];
  looks_for: string[];
  questions: string[];
  tips: string[];
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
  /** Questions to ask them at the end ("Do you have any questions for us?"); absent from older servers. */
  ask_them?: Array<{ question: string; why: string }>;
}

export interface CreateSessionRequest {
  title: string;
  type: SessionType;
  role?: string;
  company?: string;
  interview_stage?: string;
  tech_stack?: string[];
  key_requirements?: string[];
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
  company?: string | null;
  interview_stage?: string | null;
  tech_stack?: string[];
  key_requirements?: string[];
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
  /** Salary practice (on the session's own page): its lines never join the practice queue. */
  negotiation?: boolean;
  /** An AI video interview (opened in the video-call room). */
  video?: boolean;
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
  question_id?: string | null;
  missing_points?: string[];
  delivery_score?: number | null;
  clarity_score?: number | null;
  dimensions?: DepthScores;
  question: string;
  /** The candidate's own words (from the transcript); "" when they didn't answer. */
  you_said: string;
  /** 1–5, or null when the question wasn't answered. */
  score: number | null;
  feedback: string;
  /** A stronger way to say it (first person). */
  better: string;
  /** How long the answer ran, first word to last (null when unanswered or unknown; absent on older reports). */
  answer_s?: number | null;
  /** Words in the answer (absent on older reports). */
  words?: number;
}

/** GET /v1/practice/queue — spaced repetition: questions answered weakly in a review, due again until answered well. */
export interface PracticeQueueItem {
  question: string;
  /** The latest review's score (1–5), or null when it wasn't answered. */
  last_score: number | null;
  attempts: number;
  last_practised_at: string;
  due_at: string;
  /** The session whose review graded it last. */
  session_id: string;
}

export interface PracticeQueue {
  due: PracticeQueueItem[];
  upcoming: number;
  next_due_at: string | null;
  /** Questions answered well enough, often enough, to leave the queue. */
  learnt: number;
}

export interface SessionReview {
  overall_score: number | null;
  strengths: string[];
  improvements: string[];
  practice: string[];
  items: ReviewItem[];
}

export interface CareerContext {
  role: string;
  company: string;
  interview_stage: string;
  tech_stack: string[];
  key_requirements: string[];
}
export interface FullPreparation {
  resume_id: string;
  document_id: string;
  practice_link: string;
  coding_link: string;
  context: CareerContext;
  cached: boolean;
}
export type DepthDimension = "problem_framing" | "technical_depth" | "scalability" | "edge_case_rigor" | "communication_clarity";
export type DepthScores = Partial<Record<DepthDimension, number | null>>;
export interface DebriefAttempt {
  id: string; answer: string; created_at: string; score: number; clarity_score: number; feedback: string;
  ideal_answer: string; missing_points: string[]; dimensions: DepthScores;
}
export interface DebriefItem {
  question_id: string; index: number; time_ms: number; question: string; transcript: string; ideal_answer: string;
  ideal_code?: string | null; score: number | null; feedback: string; missing_points: string[];
  delivery_score: number | null; clarity_score: number | null; dimensions: DepthScores; attempts: DebriefAttempt[];
}
export interface Debrief {
  session_id: string; status: string; items: DebriefItem[]; radar: DepthScores; review_ready: boolean; score_basis: string;
}
export interface DefenseCard {
  spofs: string[]; bottlenecks: string[]; trade_offs: string[]; follow_ups: Array<{ question: string; answer: string }>;
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
  /** Salary practice only: the counter-offer email to send the recruiter, from what was said on the call. */
  counter_offer_email?: { subject: string; body: string } | null;
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
  /** Silences of 3 s or more inside one answer (sessions reviewed before 16 Oct 2026 don't have it). */
  long_pauses?: number;
  /** Median seconds from the end of a question to your first words; null when it couldn't be measured. */
  median_start_seconds?: number | null;
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
  /** The camera coach's numbers and their trend; null when it wasn't used. */
  camera?: SessionCamera | null;
}

/** The camera coach's numbers, measured on the person's device (no video or images are kept or sent). */
export interface CameraMetrics {
  seconds: number;
  samples: number;
  face_in_frame_pct: number;
  /** Of the time a face was in frame: the head turned toward the camera (head direction, not eye gaze). */
  facing_camera_pct: number;
  /** Average head turning speed, degrees per second. */
  head_movement_deg_s: number;
}

export interface SessionCamera {
  metrics: CameraMetrics;
  /** Oldest first, this session last. */
  trend: { session_id: string; at: string; face_in_frame_pct: number; facing_camera_pct: number; head_movement_deg_s: number }[];
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

/** The tailoring queue (/v1/resumes/tailor-queue): one resume tailored to several jobs in the background. */
export interface TailorQueueJob {
  /** A pasted job post (at least a few lines), or a saved job from Jobs AI. */
  job_text?: string;
  listing_id?: string;
  label?: string;
}

export interface TailorQueueItem {
  id: string;
  label: string;
  source_resume_id: string;
  status: "queued" | "running" | "done" | "failed";
  result: {
    resume_id: string | null;
    title: string;
    score_before: number | null;
    score_after: number | null;
    changes: number;
    /** Claims the resume doesn't prove: offered in the editor's fix, never applied. */
    to_confirm: number;
    /** Numbers only the candidate knows. */
    questions: number;
  } | null;
  error: string | null;
  created_at: string;
}

/** Career Evidence Vault (/v1/evidence): a claim about the candidate's work and where it comes from. Only
 *  "confirmed" items are used (live answers draw on them); "suggested" ones came from the AI and wait for a check. */
export interface EvidenceItem {
  id: string;
  claim: string;
  /** The source's own words, checked to be in it ("" for a claim the user wrote). */
  quote: string;
  source_kind: "manual" | "story" | "resume";
  /** The story or document; null once that was deleted (the title and quote stay). */
  source_id: string | null;
  source_title: string;
  status: "confirmed" | "suggested";
  created_at: string;
  updated_at: string;
}

export interface EvidenceSuggestRequest {
  source: "story" | "resume";
  story_id?: string;
  resume_id?: string;
}

export interface EvidenceSuggestResponse {
  added: EvidenceItem[];
  /** Proposed but not kept: the quote wasn't in the source, or the vault already had it. */
  dropped: number;
}

/** POST /v1/answers (a question already saved, in near enough the same words, gets this answer instead) and PUT
 *  /v1/answers/{id}: the answer bank, which every live session draws on. */
export interface SavedAnswerInput {
  question: string;
  answer: string;
  /** The session whose review it's saved from. */
  session_id?: string | null;
}

export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  session_id: string | null;
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
export type PlanId = "free" | "basic" | "pro" | "premium" | "unlimited" | "pending";

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
/** A plan for 30 days, paid once through the pack checkout; nothing renews (GET /v1/billing/monthly). */
export interface MonthlyPlan {
  id: string;
  label: string;
  price_inr: number;
  days: number;
  plan: PlanId;
  /** "Most popular", "Best value": the card's badge. */
  badge?: string | null;
  /** The price spread over 30-day months (a quarter or a year bought at once). */
  per_month_inr?: number;
  /** The buyer's currency and price: "INR" in India, "USD" elsewhere (30% above the rupee price). */
  currency?: "INR" | "USD";
  price?: number;
  price_text?: string;
  per_month?: number;
  per_month_text?: string;
  /** What each 30 days includes (null = unlimited). */
  live_minutes: number | null;
  mock_minutes: number | null;
  screenshots: number | null;
  documents: number | null;
  max_session_minutes: number;
  /** Unlimited Resume AI: no credits needed. */
  resume_ai: boolean;
  buyable: boolean;
  checkout?: "razorpay" | "upi" | null;
  international?: boolean;
}

export interface CreditPack {
  id: string;
  label: string;
  price_inr: number;
  resume_credits: number;
  interview_minutes: number;
  /** Free interview time on top ("6 credits + 2 free"); total_minutes is both together. */
  bonus_minutes?: number;
  total_minutes?: number;
  /** "Most popular", "Best value". */
  badge?: string | null;
  /** The buyer's currency and price: "INR" in India, "USD" elsewhere (30% above the rupee price). */
  currency?: "INR" | "USD";
  price?: number;
  price_text?: string;
  /** Can be bought right now (Razorpay or a UPI ID is set up). */
  buyable: boolean;
  /** How: Razorpay's checkout (cards, UPI, netbanking), UPI with a UTR, or not at all. */
  checkout?: "razorpay" | "upi" | null;
  /** Razorpay takes cards issued outside India (ORBIT_RAZORPAY_INTERNATIONAL, once Razorpay has enabled them). */
  international?: boolean;
}

/** POST /v1/billing/razorpay/orders: what the page opens Razorpay's checkout with. */
export interface RazorpayCheckout {
  payment_id: string;
  order_id: string;
  key_id: string;
  amount_paise: number;
  currency: string;
  label: string;
  email: string;
  name: string | null;
}

/** What Razorpay's checkout hands back when the payment goes through (checked on the server). */
export interface RazorpayPaid {
  order_id: string;
  payment_id: string;
  signature: string;
}

/** UPI: awaiting_payment → submitted → approved | rejected. Razorpay: awaiting_payment → processing (Razorpay has the
 *  payment, not captured yet) → approved, or expired (nobody paid the order). */
export type UpiOrderStatus = "awaiting_payment" | "submitted" | "approved" | "rejected" | "processing" | "expired";

/** A UPI payment for a credit pack: pay, give the UTR, the admin approves it, the credits land. */
export interface UpiOrder {
  /** What was charged in its own currency ("$53.99"); amount_inr is the rupee equivalent abroad. */
  currency?: "INR" | "USD";
  amount_text?: string;
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
  /** "upi" (a UTR the admin checks) or "razorpay" (confirmed by Razorpay). */
  method?: "upi" | "razorpay";
  /** Refunds that went through, in rupees. The credits are kept (docs/BILLING.md). */
  refunded_inr?: number;
  /** How to pay, while there's still something to pay. `upi_uri` is shown as a QR and, on phones, a tap-through link. */
  upi_id: string | null;
  payee_name: string | null;
  upi_uri: string | null;
}

export interface AdminPayment extends Omit<UpiOrder, "upi_id" | "payee_name" | "upi_uri"> {
  /** null: the account was deleted (its payment is kept, so the UTR can't be used again). */
  user_id: string | null;
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
  /** Razorpay orders whose payment isn't captured yet. */
  processing?: number;
  /** Razorpay webhook events that couldn't be applied (their payment unknown, or an error). */
  events_to_review?: number;
  /** Refunds whose payment isn't known here yet. */
  unlinked_refunds?: number;
}

/** POST /v1/admin/payments/reconcile: what asking Razorpay about open orders did. */
export interface ReconcileResult {
  checked: number;
  credited: number;
  expired: number;
  errors: number;
  refunds_linked: number;
}

/** GET /v1/resumes/allowance: resume credits left (one per AI action), and the cheapest pack that adds more. */
export interface ResumeAiAllowance {
  /** The plan includes resume AI: no credits needed. */
  unlimited: boolean;
  credits_left: number;
  upgrade: { pack: string; label: string; price_inr: number; price_text?: string | null; resume_credits: number; interview_minutes: number; buyable: boolean } | null;
  /** Single AI fixes already paid for: one credit covers `fixes_per_credit` of them (older servers: absent). */
  fixes_left?: number;
  fixes_per_credit?: number;
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
  credits?: {
    resume: number | null;
    interview_minutes_left: number;
    interview_minutes_total: number;
    /** No credit was ever added: the free starter credits went to another account on this network (one a month)
     * or this inbox, and nothing was bought or granted. The app says why the balance is zero. */
    welcome_missed?: boolean;
  } | null;
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
  /** Everything had and used, all time. */
  usage?: AdminUsage;
  /** Suspended by the admin: can't sign in or use the API. The reason is shown to its owner. */
  suspended_at?: string | null;
  suspended_reason?: string | null;
  /** The admin wrote private notes on it. */
  has_note?: boolean;
}

export interface AdminUsage {
  resume_given: number;
  /** Spent on resume AI actions. */
  resume_used: number;
  /** Taken away by the admin. */
  resume_removed?: number;
  interview_minutes_given: number;
  interview_minutes_removed?: number;
  live_minutes_used: number;
  mock_minutes_used: number;
  sessions: number;
  /** Approved UPI payments. */
  paid_inr: number;
  packs: number;
  /** The last time the account used Orbit (a session, interview time, resume AI or edits, Jobs AI); not sign-ins. */
  last_active: string | null;
}

/** The whole server at a glance. */
export interface AdminTotals {
  users: number;
  signups_7d: number;
  interview_minutes_this_month: number;
  resume_credits_used_this_month: number;
  paid_inr_total: number;
  paid_inr_this_month: number;
  payments_waiting: number;
}

export interface AdminUsers {
  approval_required: boolean;
  users: AdminUser[];
  /** On the first page only. */
  totals?: AdminTotals | null;
  /** Accounts matching the filter and search, all pages. */
  total?: number;
  offset?: number;
  has_more?: boolean;
}

/** "active": used Orbit in the last 7 days · "never_used": signed up and never used it. */
export type AdminUserFilter = "all" | "pending" | "granted" | "paid" | "active" | "never_used" | "suspended";
export type AdminUserSort = "created" | "email" | "last_active" | "paid" | "minutes" | "resume_credits";

export interface AdminUserQuery {
  only?: AdminUserFilter;
  q?: string;
  sort?: AdminUserSort;
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

/** One credit movement on an account (GET /v1/admin/users/{id}). */
export interface AdminLedgerItem {
  id: string;
  at: string;
  kind: "resume" | "interview_seconds";
  /** Signed: resume credits, or interview seconds. */
  amount: number;
  /** welcome | purchase | admin | admin_remove | resume_ai */
  reason: string;
  text: string;
  amount_text: string;
  note: string | null;
  payment_id: string | null;
}

/** A session's kind, state and minutes: never its title or content. */
export interface AdminSessionItem {
  id: string;
  type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  minutes: number;
}

export interface AdminPaymentItem {
  id: string;
  pack: string;
  amount_inr: number;
  status: UpiOrderStatus;
  utr: string | null;
  reference: string;
  resume_credits: number;
  interview_minutes: number;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  note: string | null;
}

/** An audit entry: who did what, and (for admin actions) to which account. */
export interface AdminAuditItem {
  id: string;
  at: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  target: string | null;
  subject_id: string | null;
  /** null once that account is deleted (a delete's target keeps its email). */
  subject_email: string | null;
  ip: string | null;
}

export interface AdminContentCounts {
  documents: number;
  documents_by_kind: Record<string, number>;
  resumes: number;
  stories: number;
  workspaces: number;
  sessions: number;
  sessions_open: number;
  job_profile: boolean;
  jobs_tracked: number;
  jobs_by_status: Record<string, number>;
  fit_checks: number;
  fit_checks_30d: number;
}

/** GET /v1/admin/users/{id}: one account in full. */
export interface AdminUserDetail {
  user: AdminUser;
  /** Private: never shown to the account's owner. */
  admin_note: string | null;
  is_you: boolean;
  /** The admin account: nothing destructive applies. */
  is_admin_account: boolean;
  counts: AdminContentCounts;
  ledger: AdminLedgerItem[];
  sessions: AdminSessionItem[];
  payments: AdminPaymentItem[];
  /** What an admin did to this account, newest first. */
  admin_actions: AdminAuditItem[];
  /** The account's own security events: sign-ins, password changes. */
  events: AdminAuditItem[];
}

export interface AdminUserPatch {
  name?: string;
  email_verified?: boolean;
  admin_note?: string;
}

/** POST /v1/admin/users/{id}/credits/remove. A balance never goes below zero. */
export interface RemoveCreditsRequest {
  resume?: number;
  interview_minutes?: number;
  /** "Set to zero": take whatever is left. */
  all_resume?: boolean;
  all_interview?: boolean;
  /** Shown in the account's history. */
  reason: string;
}

export interface RemoveCreditsResult {
  user: AdminUser;
  removed_resume: number;
  removed_interview_minutes: number;
  /** More was asked for than was left: what was there was taken, and that balance is now zero. */
  clamped: boolean;
  message: string;
}

export interface BulkCreditsResult {
  given: number;
  skipped: Array<{ id: string; why: string }>;
}

export interface AdminAuditPage {
  items: AdminAuditItem[];
  total: number;
  offset: number;
  has_more: boolean;
  /** Every action in this scope, for the filter. */
  actions: string[];
}

export interface AdminAuditQuery {
  scope?: "admin" | "all";
  action?: string;
  user_id?: string;
  q?: string;
  offset?: number;
  limit?: number;
}

/** GET /v1/admin/stats: the server at a glance. Days are in the time zone asked for. */
export interface AdminStats {
  days: number;
  signups: Array<{ day: string; value: number }>;
  interview_minutes: Array<{ day: string; value: number }>;
  users: number;
  active_7d: number;
  active_30d: number;
  suspended: number;
  paid_accounts: number;
  interview_minutes_month: number;
  resume_credits_used_month: number;
  fit_checks_month: number;
  revenue_month_inr: number;
  revenue_total_inr: number;
  payments_waiting: number;
  /** Server settings to fix, as codes: "proxy_secret" (ORBIT_PROXY_SECRET missing in production). */
  warnings?: string[];
}

/** GET /v1/announcement (public): the site-wide banner, if the admin set one. `id` changes with the text. */
export interface Announcement {
  id: string | null;
  text: string | null;
  tone: "info" | "warning";
}

// ---- Contact page and the admin's Inbox (POST /v1/contact, /v1/admin/inbox) ----------------------------------

export type ContactTopic = "general" | "payment" | "technical" | "report_job" | "business" | "feedback" | "other";
/** new = unread · open = read, still to answer · done · spam */
export type ContactStatus = "new" | "open" | "done" | "spam";

/** What the page that opened the form knows (never typed): a reported job, where the sender came from. */
export interface ContactContext {
  listing_id?: string;
  listing_title?: string;
  listing_company?: string;
  listing_url?: string;
  /** "Asked me to pay a fee" */
  reason?: string;
  /** The app page the form was opened from ("/jobs/listing/j3f2"). */
  page?: string;
  /** Which app sent it: "web" or "desktop-0.1.25". */
  platform?: string;
  /** Added by the server for a signed-in sender (never sent): their most recent session. */
  latest_session_id?: string;
}

/** POST /v1/contact (public, signed in or out). */
export interface ContactRequest {
  name: string;
  email: string;
  phone?: string;
  topic: ContactTopic;
  message: string;
  context?: ContactContext;
  /** Signed out, when the server asks for the bot check. */
  captcha_token?: string;
  /** The honeypot: always empty from a person. */
  website?: string;
}

/** GET /v1/jobs/tracker/{id}/timeline: one event of a tracked job's journey. */
export interface JobTimelineEvent {
  kind: "saved" | "fit" | "resume" | "prep_doc" | "contact" | "outreach" | "applied" | "round" | "stage" | "next";
  at: string;
  title: string;
  detail: string;
  link: string | null;
  upcoming: boolean;
}

/** GET /v1/sessions/loop-memory?company=: the candidate's earlier rounds with that company. */
export interface LoopMemory {
  company: string;
  rounds: number;
  last_round_at: string | null;
  questions: string[];
  /** Story-bank titles already told in this loop. */
  stories: string[];
}

/** GET /v1/public/engineering-telemetry. Percentiles are null until enough sessions were measured. */
export interface LatencyPercentiles {
  p50_ms: number;
  p95_ms: number;
  samples: number;
}
export interface EngineeringTelemetry {
  window_days: number;
  sessions: number;
  /** Interviewer stops talking → question recognised. */
  question_detected: LatencyPercentiles | null;
  /** Question recognised → first word of the answer. */
  first_word: LatencyPercentiles | null;
  /** Seconds since the API last started (each deploy restarts it). */
  up_for_s: number;
  measured_at: string;
}

export interface ContactReceipt {
  status: "received";
  /** "C-1A2B3C4D", to quote when writing again. */
  reference: string;
}

/** "todo" = new and open (the default) · "new" = unread · "all" = everything, spam too. */
export type InboxFilter = "todo" | "new" | "done" | "spam" | "all";

export interface InboxQuery {
  status?: InboxFilter;
  topic?: ContactTopic;
  q?: string;
  offset?: number;
  limit?: number;
}

export interface InboxItem {
  id: string;
  reference: string;
  created_at: string;
  name: string;
  email: string;
  topic: ContactTopic;
  topic_label: string;
  status: ContactStatus;
  /** The start of the message, on one line. */
  snippet: string;
  /** The account it was sent from, when signed in. */
  user_id: string | null;
  listing_title: string | null;
  replies: number;
}

export interface InboxCounts {
  new: number;
  open: number;
  done: number;
  spam: number;
  todo: number;
  all: number;
}

export interface InboxPage {
  items: InboxItem[];
  total: number;
  offset: number;
  has_more: boolean;
  /** Every message, whatever the filters: the tabs' numbers and the unread badge. */
  counts: InboxCounts;
}

export interface InboxReply {
  at: string;
  /** The admin's email. */
  by: string;
  text: string;
}

/** GET /v1/admin/inbox/{id}: one message in full (opening an unread one marks it read). */
export interface InboxMessage {
  id: string;
  reference: string;
  created_at: string;
  name: string;
  email: string;
  phone: string | null;
  topic: ContactTopic;
  topic_label: string;
  message: string;
  context: ContactContext | null;
  status: ContactStatus;
  read_at: string | null;
  handled_at: string | null;
  /** The admin's own; never sent to the sender. */
  admin_note: string | null;
  replies: InboxReply[];
  /** The account it was sent from (null if signed out, or deleted since). */
  account: { id: string; email: string; name: string | null } | null;
  /** Messages from the same network in the last 30 days, this one included. */
  same_network_30d: number;
  /** This server can send email: reply from Orbit. Else reply from your own mail app. */
  can_reply: boolean;
}

export interface InboxMessagePatch {
  status?: ContactStatus;
  /** "" clears it. */
  admin_note?: string;
}

/** One line of an account's history: credits in or out, a session and its minutes, a payment. */
export interface AdminActivityItem {
  at: string;
  kind: "credit" | "session" | "payment";
  text: string;
  amount: string | null;
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
  /** The site-wide announcement banner ("" = none). */
  announcement?: string;
  announcement_tone?: "info" | "warning";
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
  /** "" takes the banner down. */
  announcement?: string;
  announcement_tone?: "info" | "warning";
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
    /** What the provider's prompt cache saved: priced calls costed again with no cache hits, minus their cost. */
    cache_saved_usd: number;
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
/** All single-column (ATS-safe) except "sidebar". */
export type ResumeTemplate =
  | "classic"
  | "modern"
  | "compact"
  | "sidebar"
  | "elegant"
  | "minimal"
  | "bold"
  | "executive"
  | "campus"
  | "harvard";
export type ResumeFont =
  | "inter"
  | "arial"
  | "georgia"
  | "garamond"
  | "grotesk"
  | "calibri"
  | "cambria"
  | "helvetica"
  | "times"
  | "trebuchet";
export type ResumeSpacing = "compact" | "normal" | "relaxed";
export type ResumeLineHeight = "tight" | "normal" | "airy";

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
  /** The score as the marksheet gives it: "8.6 / 10 CGPA", "92%". Absent on resumes saved before it existed. */
  grade?: string;
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
  /** Sections kept in the editor but left off the resume. */
  hidden?: ResumeSectionKey[];
  /** Your own headings for the standard sections ("Work experience"). */
  titles?: Partial<Record<ResumeSectionId, string>>;
}

export interface ResumeDesign {
  template: ResumeTemplate;
  /** #rrggbb */
  accent: string;
  font: ResumeFont;
  /** Points (9–12.5). */
  font_size: number;
  spacing: ResumeSpacing;
  line_height?: ResumeLineHeight;
  /** Skills as a comma list, or as tags. */
  skills_style?: "list" | "tags";
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
  /** The revision this text was based on; the server refuses (409) the save if another one landed since. */
  base_revision?: number;
  client_id?: string;
  client_revision?: number;
  pending_suggestions?: ResumeSuggestion[];
}

export interface Resume extends ResumeInput {
  prep_context?: CareerContext & { practice_link?: string; coding_link?: string } | null;
  pending_suggestions?: ResumeSuggestion[];
  cover_letter: string;
  id: string;
  created_at: string;
  updated_at: string;
  /** Bumped by every save (a save based on an older one is refused with 409). */
  revision?: number;
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
  /** "shorten": tighten the longest lines so the resume fits one page, keeping every figure and tool. */
  mode?: "improve" | "tailor" | "shorten";
  /** Rewrite just this one field. */
  focus?: string;
  /** Fix this ATS check, by id ("skills_count", "dates", "quantified"…). */
  check?: string;
  /** "shorten": how many printed lines it's over one page at its most compact layout. */
  lines_over?: number;
}

// ─── Interview prep from the resume (POST /v1/resumes/prep/*, nothing stored) ──

/** What a set of questions is about: a role or project (by its id), the job post ("job"), or the whole resume. */
export interface ResumePrepGroup {
  id: string;
  kind: "role" | "project" | "job" | "general";
  label: string;
}

export interface ResumeOutlinePoint {
  /** "Situation", "Task", "Action" or "Result" in a behavioural answer; else "". */
  label: string;
  text: string;
  /** A prompt for you in place of a fact: the resume doesn't say this part ("Add the result you got"). */
  ask: boolean;
}

export interface ResumeInterviewQuestion {
  id: string;
  /** A ResumePrepGroup id. */
  group: string;
  question: string;
  type: "behavioral" | "technical" | "role" | "motivation";
  /** Built only from the resume. */
  outline: ResumeOutlinePoint[];
  /** Facts only you can add; the resume doesn't say them. */
  missing: string[];
  /** Where the interviewer will push; "" when there's nothing to defend. */
  defend: string;
  /** A behavioural answer's example in a few words. */
  example: string;
}

export interface ResumeQuestionsResponse {
  /** The job the interviewer is hiring for. */
  role: string;
  groups: ResumePrepGroup[];
  questions: ResumeInterviewQuestion[];
}

export type ResumeGapVerdict = "related" | "prepare" | "dont_claim";

export interface ResumeSkillGap {
  skill: string;
  /** One of the ATS score's missing job keywords (else another requirement in the post). */
  keyword: boolean;
  verdict: ResumeGapVerdict;
  /** related: the resume line it rests on. */
  evidence: string;
  /** related: how to say it in the interview. */
  say: string;
  /** What to study or practise first. */
  prepare: string;
  /** dont_claim: how to answer if it comes up. */
  note: string;
}

export interface ResumeSkillGapResponse {
  gaps: ResumeSkillGap[];
  /** The job keywords the resume already shows. */
  matched: string[];
}

/** Cover letter options: the voice, and short (150-200 words) or standard (250-350). */
export type CoverLetterTone = "professional" | "warm" | "confident";
export type CoverLetterLength = "short" | "standard";

/** Naukri's profile fields, from the resume: headline (≤250 characters), profile summary (≤1,000), key skills. */
export interface NaukriProfile {
  headline: string;
  summary: string;
  skills: string[];
}

/** LinkedIn's profile fields, from the resume: headline (≤220 characters), About (≤2,600), top 5 skills. */
export interface LinkedInProfile {
  headline: string;
  about: string;
  skills: string[];
}

export type OutreachKind = "referral" | "cold_email" | "follow_up" | "thank_you" | "screening";

/** What the candidate says about who they're writing to; all optional. */
export interface OutreachInputs {
  recipient?: string;
  company?: string;
  role?: string;
  /** Anything true to mention: "we talked about the Power BI migration". */
  details?: string;
}

export interface OutreachMessage {
  kind: OutreachKind;
  /** The email subject; "" for a LinkedIn or WhatsApp message. */
  subject: string;
  /** A referral request's LinkedIn connection note (≤200 characters); "" otherwise. */
  connection_note: string;
  /** Greeting, message and sign-off, ready to send. */
  message: string;
}

// ---- Jobs (/v1/jobs): the latest jobs that match the user's resume, the search profile behind them, the tracker ----

export type JobWorkplace = "remote" | "hybrid" | "onsite";
export type JobEmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type JobLevel = "fresher" | "junior" | "mid" | "senior";
/** Posted within this many days. */
export type JobPostedWithin = 1 | 3 | 7 | 30;
export type JobStatus = "saved" | "applied" | "interviewing" | "offer" | "rejected";
export type JobSort = "best" | "newest";

/** What the feed looks for: read from a resume by the AI, then the user's to edit. */
export interface JobPrefs {
  titles: string[];
  skills: string[];
  /** Cities ("Bengaluru"), or "India" for anywhere in India. Empty: anywhere in India. */
  locations: string[];
  workplace: JobWorkplace[];
  level: JobLevel | null;
  years: number | null;
  /** Empty: full-time, part-time and contract (internships too for freshers). */
  job_types: JobEmploymentType[];
  posted_within: JobPostedWithin;
  sources_off: string[];
  /** The "search on" sites to show, by id. */
  portals: string[];
  exclude: string[];
  /** Needs an employer to sponsor a work visa: posts that say they won't are left out. */
  needs_sponsorship?: boolean;
}

export interface JobSuggestedProfile {
  titles: string[];
  level: JobLevel;
  years: number;
  skills: string[];
  locations: string[];
  /** "resume": worked out without the AI (today's AI reads were used, or the AI was down). */
  by: "ai" | "resume";
}

export interface JobResumeRef {
  id: string;
  title: string;
}

export interface JobProfile {
  prefs: JobPrefs;
  suggested: JobSuggestedProfile | null;
  /** The resume the feed is matched to. */
  resume: JobResumeRef | null;
  resumes: JobResumeRef[];
  /** AI profile reads left today; null = no cap. */
  ai_left: number | null;
  /** False until the user (or "suggest") saves one; until then it's worked out from the latest resume. */
  saved: boolean;
  /** Every "search on" site: id -> name. */
  portals: Record<string, string>;
  /** The job sources this server uses. */
  sources: Array<{ id: string; label: string }>;
  cities: string[];
  note: string | null;
}

export interface JobAttribution {
  label: string;
  url: string;
  /** The source's terms ask for a large credit (Adzuna: at least 116 x 23 px). */
  large: boolean;
}

export interface JobSourceStatus {
  id: string;
  label: string;
  kind: "board" | "feed" | "search";
  listings: number;
  last_success_at: string | null;
  refreshing: boolean;
  failing: boolean;
}

export interface JobPortalLink {
  id: string;
  name: string;
  url: string;
}

export interface JobMatch {
  /** Out of 100. */
  score: number;
  matched: string[];
  missing: string[];
}

export interface JobListing {
  id: string;
  source: string;
  source_label: string;
  /** The company's own posting: Apply goes straight to the employer. */
  direct: boolean;
  attribution: JobAttribution | null;
  company: string;
  title: string;
  locations: string[];
  /** One line for the card: "Bengaluru, Pune · Hybrid", "Remote (India)". */
  place: string;
  workplace: JobWorkplace | null;
  employment_type: JobEmploymentType | null;
  level: JobLevel | null;
  /** "3-5 years", "5+ years". */
  experience: string | null;
  posted_at: string;
  url: string;
  apply_url: string;
  snippet: string;
  salary: string | null;
  match: JobMatch | null;
  tracked: { id: string; status: JobStatus } | null;
  /** When Orbit first saw the post (a post without a date is dated when it's fetched). */
  first_seen_at?: string;
  /** When Orbit last found it on the company's own careers page; null for feeds and searches (never re-checked). */
  still_listed_at?: string | null;
  /** What the post says about sponsoring a work visa; null when it doesn't say. */
  visa?: "offered" | "not_offered" | null;
  /** The post offers help relocating. */
  relocation?: boolean;
}

export type JobAlertFrequency = "off" | "daily" | "weekly";

/** Job alerts: an email of new matches. `can_email` is false until the address is verified (or the server can't mail). */
export interface JobAlert {
  frequency: JobAlertFrequency;
  sent_at: string | null;
  can_email: boolean;
  email: string;
}

/** One observation of the posting check: whether a post looks like a live opening. Never a verdict. */
export interface JobPostingSignal {
  kind: string;
  tone: "good" | "caution" | "info";
  text: string;
}

export interface JobFeed {
  items: JobListing[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  /** A source is fetching new posts in the background: ask again in a little while. */
  refreshing: boolean;
  sources: JobSourceStatus[];
  portals: JobPortalLink[];
  /** What the search box was read as ("Remote", "Bengaluru", "2 years"). */
  understood: string[];
  keywords: string;
  resume: JobResumeRef | null;
  has_profile: boolean;
}

export interface JobFeedQuery {
  q?: string;
  sort?: JobSort;
  page?: number;
  page_size?: number;
}

export interface JobFitCheck {
  verdict: "Strong" | "Good" | "Stretch";
  summary: string;
  why: string[];
  gaps: string[];
  tweaks: Array<{ change: string; why: string }>;
  /** Requirement by requirement, each quote checked against the post and the resume (absent on older checks). */
  /** evidence_quote: from the candidate's confirmed evidence vault, when that's what meets it (servers from before
   *  it leave it out). */
  requirements?: Array<{ requirement: string; status: "met" | "partial" | "unclear" | "missing"; job_quote: string; resume_quote: string; evidence_quote?: string }>;
}

export interface JobFitResponse {
  check: JobFitCheck;
  /** Answered from the last check of this job and this resume (free). */
  cached: boolean;
  /** Fit checks left today; null = no cap. */
  left: number | null;
}

/** How the user knows a contact (Jobs AI → Outreach → People). */
export type JobContactRelation = "referral" | "recruiter" | "alum" | "hiring_manager" | "interviewer" | "mentor" | "other";

/** A person in the job search: who they are, how to reach them, and when to follow up. */
export interface JobContact {
  id: string;
  name: string;
  company: string;
  title: string;
  relation: JobContactRelation;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  notes: string;
  /** The tracked job they're about, and how the list shows it ("Android Engineer at PhonePe"). */
  application_id: string | null;
  application_label: string | null;
  last_contacted_at: string | null;
  follow_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobContactInput {
  name: string;
  company?: string;
  title?: string;
  relation?: JobContactRelation;
  linkedin_url?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string;
  application_id?: string | null;
  follow_up_at?: string | null;
}

export interface JobTrackerEntry {
  id: string;
  listing_id: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  apply_url: string;
  posted_at: string | null;
  status: JobStatus;
  notes: string;
  applied_at: string | null;
  /** The next interview or follow-up. */
  next_at: string | null;
  /** When it last moved. */
  status_at: string;
  /** The resume tailored for this job, and the job description saved for interview prep. */
  resume_id: string | null;
  document_id: string | null;
  /** The listing is still in the feed (posts are dropped after about 30 days). */
  live: boolean;
  /** As JobListing's: when it was last seen on the company's own careers page. */
  still_listed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobTrackerUpdate {
  status?: JobStatus;
  notes?: string;
  applied_at?: string;
  next_at?: string;
  clear_applied?: boolean;
  clear_next?: boolean;
}

export interface JobDetail {
  job: JobListing;
  /** Orbit has the whole post, not only a snippet. */
  full_text: boolean;
  fit: JobFitCheck | null;
  tracker: JobTrackerEntry | null;
  /** The same job posted elsewhere (same company, title and city); `url` is "" when it isn't an http(s) link. */
  also_listed?: Array<{ id: string; source_label: string; direct: boolean; url: string }>;
  /** The posting check: cautions first, then what's reassuring. */
  checks?: JobPostingSignal[];
}

export interface JobTailorResponse {
  resume_id: string;
  title: string;
  note: string | null;
  /** The job is in the tracker now (saved), with this resume attached. */
  tracker_id: string;
}

/** Jobs AI's public numbers (no session): how many fresh jobs Orbit holds, and what's free each day. */
export interface JobStats {
  /** Posted in the last `days` days. */
  jobs: number;
  companies: number;
  days: number;
  /** The job boards credited by name ("Himalayas", "Remote OK", "Jobicy"). */
  feeds: string[];
  updated_at: string | null;
  /** Free AI fit checks a day. */
  fit_daily: number;
  /** Free AI profile reads a day. */
  profile_daily: number;
}

export interface JobPrepareResponse {
  document_id: string;
  title: string;
  reused: boolean;
  note: string | null;
  tracker_id: string;
}

// ---- Jobs found elsewhere (Naukri, LinkedIn, a campus portal): tracked by hand, `listing_id` "ext:…" ----

/** POST /v1/jobs/tracker/link: what a job's link says, read from its address alone (nothing is fetched). */
export interface JobLinkInfo {
  /** Tidied (no tracking parameters): what's saved. */
  url: string;
  /** "Naukri", "LinkedIn", or the site's host. */
  site: string;
  /** "" when the address doesn't say. Guesses from the address, for the user to check. */
  title: string;
  company: string;
  location: string;
  /** The same post is in Orbit's feed: it's tracked as that post. */
  listing_id: string | null;
  /** This link is already on the tracker. */
  tracked: { id: string; status: JobStatus } | null;
}

/** POST /v1/jobs/tracker/manual: a link, or a company and title (typed values win over the link's). */
export interface JobManualTrack {
  url?: string;
  company?: string;
  title?: string;
  location?: string;
  status?: JobStatus;
  applied_at?: string;
  next_at?: string;
  notes?: string;
  /** The job post saved to Documents, for Practice. */
  document_id?: string;
}

// ---- Offer AI (orbit_api/offers) ----------------------------------------------------------------------------------

/** The pay range in job posts for a role, read from the posts' own pay lines (a year, one currency). */
export interface OfferMarket {
  currency: string;
  count: number;
  p25: number;
  median: number;
  p75: number;
  low: number;
  high: number;
  /** What was read: "Backend Engineer in Bengaluru", or "…, all cities" when the city had too few. */
  scope: string;
  samples: Array<{ listing_id: string; title: string; company: string; salary: string; city: string }>;
}

export type OfferStatus = "considering" | "accepted" | "declined";
export type OfferPf = "capped" | "full" | "none";

/** An offer as the user enters it: every figure is a year's, except the one-off joining bonus. */
export interface OfferInput {
  company: string;
  role: string;
  city: string;
  currency: string;
  fixed: number;
  variable: number;
  joining_bonus: number;
  equity_per_year: number;
  other: number;
  pf: OfferPf;
  employer_costs_in_ctc: boolean;
  deadline: string | null;
  status: OfferStatus;
  notes: string;
}

export interface OfferTakeHome {
  monthly: number;
  yearly_tax: number;
  employee_pf: number;
  employer_costs: number;
  professional_tax: number;
  variable_after_tax: number;
  assumptions: string[];
}

export interface OfferPlan {
  ask: number;
  ask_why: string;
  reasons: string[];
  call_script: string[];
  email: { subject: string; body: string };
  questions: string[];
  watch_outs: string[];
}

export interface JobOfferRecord extends OfferInput {
  id: string;
  first_year: number;
  yearly: number;
  /** India only: what reaches the bank each month (an estimate). */
  take_home: OfferTakeHome | null;
  market: OfferMarket | null;
  position: "below" | "within" | "above" | null;
  plan: OfferPlan | null;
  plan_stale: boolean;
  created_at: string;
  updated_at: string;
}

// ---- LinkedIn AI (orbit_api/linkedin) -----------------------------------------------------------------------------

/** The user's LinkedIn profile as read from its "Save to PDF": the text as it is on LinkedIn. */
export interface LinkedInRead {
  name: string;
  headline: string;
  location: string;
  about: string;
  url: string;
  experience: Array<{ title: string; company: string; dates: string; current: boolean; description: string }>;
  education: Array<{ school: string; degree: string }>;
  skills: string[];
  certifications: string[];
}

export interface LinkedInCheck {
  id: string;
  section: "headline" | "about" | "experience" | "skills" | "keywords" | "extras";
  ok: boolean;
  points: number;
  max: number;
  title: string;
  tip: string;
}

export interface LinkedInAudit {
  score: number;
  checks: LinkedInCheck[];
  /** The skills job posts for the target role ask for most, most asked first. */
  keywords: string[];
  found: string[];
  missing: string[];
  /** Where the profile and the Orbit resume disagree. */
  mismatches: string[];
  /** How many job posts the keywords came from. */
  posts: number;
}

export interface LinkedInState {
  profile: LinkedInRead | null;
  target_role: string;
  audit: LinkedInAudit | null;
  read_at: string | null;
  /** AI reads left today; null = no cap. */
  reads_left: number | null;
}

// ---- Code AI (orbit_api/code) -------------------------------------------------------------------------------------

export type CodeLanguage = "javascript" | "python" | "java" | "cpp";

export interface CodeProblem {
  id: string;
  title: string;
  pattern: string;
  difficulty: "easy" | "medium" | "hard";
  statement: string;
  examples: string[];
  /** The JavaScript function's name: the tests call it. */
  function: string;
  js: string;
  python: string;
  tests: Array<{ args: unknown[]; expected: unknown }>;
  /** The answer is a list whose order doesn't matter. */
  unordered: boolean;
  hints: string[];
  /** The time and space a strong answer reaches. */
  target: string;
}

export interface CodeProblemSummary {
  id: string;
  title: string;
  pattern: string;
  difficulty: CodeProblem["difficulty"];
  attempts: number;
  solved: boolean;
}

export interface CodeReview {
  verdict: "solved" | "partly" | "not_yet";
  summary: string;
  scores: { problem_solving: number; code_quality: number; complexity: number; communication: number };
  complexity: string;
  strengths: string[];
  fixes: string[];
  edge_cases: string[];
  follow_up: string;
}

export interface CodeAttemptRecord {
  id: string;
  language: CodeLanguage;
  code: string;
  approach: string;
  passed: number;
  total: number;
  solved: boolean;
  review: CodeReview | null;
  created_at: string;
}

export interface CodeAttemptInput {
  language: CodeLanguage;
  code: string;
  approach: string;
  passed: number;
  total: number;
  failing: string;
}

/** Job Mission Room (GET /v1/jobs/tracker/{id}/mission): one tracked job as a workspace. Stages are records, not
 * estimates; `next` is the first gap with the reason. */
export type MissionStage = "discover" | "prove" | "prepare" | "apply" | "interview" | "negotiate";

export interface MissionRequirement {
  requirement: string;
  status: string;
  job_quote: string;
  resume_quote: string;
  evidence_quote: string;
}

export interface MissionFit {
  verdict: string;
  summary: string;
  gaps: string[];
  requirements: MissionRequirement[];
  checked_at: string;
}

export interface MissionResume {
  id: string;
  title: string;
  score: number;
  updated_at: string;
}

/** The resume as it was sent for this job: frozen, kept when the resume itself changes or is deleted. */
export interface MissionSnapshot {
  id: string;
  title: string;
  score: number;
  note: string;
  resume_id: string | null;
  created_at: string;
}

export interface MissionOffer {
  id: string;
  company: string;
  role: string;
  fixed: number;
  currency: string;
  status: string;
}

export interface MissionNextStep {
  key: string;
  title: string;
  why: string;
  action: string;
  /** An in-app path, or an in-room action: "link_resume", "snapshot", "link_offer", "mark_applied", "practise", "notes". */
  to: string;
}

export interface JobMission {
  entry_id: string;
  stages: Record<MissionStage, boolean>;
  fit: MissionFit | null;
  resume: MissionResume | null;
  resume_missing: boolean;
  snapshots: MissionSnapshot[];
  offer: MissionOffer | null;
  offers: MissionOffer[];
  practice_rounds: number;
  live_rounds: number;
  next: MissionNextStep | null;
}

/** Interview prep plan (GET /v1/jobs/tracker/{id}/plan): day by day to the interview, from the account's records. */
export type PlanItemKind = "research" | "gap" | "mock" | "queue" | "story" | "warmup" | "logistics" | "review";

export interface PlanItem {
  key: string;
  kind: PlanItemKind;
  title: string;
  detail: string;
  done: boolean;
}

export interface PlanDay {
  date: string;
  /** 0 = the interview day. */
  days_before: number;
  items: PlanItem[];
}

export interface PrepPlan {
  interview_at: string | null;
  days_left: number | null;
  /** Later than today when the interview is more than two weeks away. */
  starts_on: string | null;
  days: PlanDay[];
  done: number;
  total: number;
}

/** POST /v1/offers/{id}/scenario: the offer next to a what-if version (nothing saved). */
export interface OfferScenarioInput {
  fixed_change_pct?: number;
  variable_payout_pct?: number;
  joining_bonus?: number | null;
  equity_value_pct?: number;
  pf?: "capped" | "full" | "none" | null;
}

export interface OfferScenarioFigures {
  fixed: number;
  variable: number;
  joining_bonus: number;
  equity_per_year: number;
  first_year: number;
  yearly: number;
  /** India only. */
  monthly_in_hand: number | null;
  yearly_tax: number | null;
  variable_after_tax: number | null;
}

export interface OfferScenario {
  offer: OfferScenarioFigures;
  scenario: OfferScenarioFigures;
  assumptions: string[];
}

/** GET /v1/auth/sessions: a signed-in device or browser. No IP address is kept. */
export interface SignedInDevice {
  id: string;
  kind: "web" | "desktop" | "other";
  label: string;
  created_at: string;
  last_seen_at: string;
  /** The device this request came from. */
  current: boolean;
}
