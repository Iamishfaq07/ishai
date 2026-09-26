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

export interface LoginRequest {
  email: string;
  password: string;
}

/** Web clients rely on the httpOnly cookie; desktop stores access_token in the OS keychain. */
export interface AuthResponse {
  user: User;
  access_token: string;
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
export type MockInterviewType = "behavioral" | "technical" | "system_design" | "coding" | "mixed";

export type MockPersona = "recruiter" | "hiring_manager" | "engineer" | "staff_engineer" | "executive";

export interface MockConfig {
  interview_type?: MockInterviewType;
  difficulty?: MockDifficulty;
  duration_minutes: number;
  persona?: MockPersona;
  /** A fixed list of questions, asked in order (re-drills, or questions from interview prep: kind "prep"). */
  drill?: Array<{ question: string; kind?: "retry" | "concise" | "prep"; follow_up?: boolean }>;
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

export type PlanId = "free" | "pro" | "unlimited";

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
}

/** GET /v1/entitlements — the signed-in user's plan, limits, this month's usage and features. */
export interface Entitlements {
  plan: PlanId;
  label: string;
  limits: {
    live_minutes: number | null;
    mock_minutes: number | null;
    screenshots: number | null;
    documents: number | null;
    max_session_minutes: number;
  };
  usage: { live_minutes: number; mock_minutes: number; screenshots: number; documents: number };
  features: Record<string, boolean>;
}

export interface Usage {
  plan: PlanId;
  live_minutes_used: number;
  live_minutes_limit: number | null;
  screenshots_used: number;
  screenshots_limit: number | null;
}

// ─── Admin / advanced settings ─────────────────────────────────────────────────

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
