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
  /** Privacy controls (spec §65), account-wide. */
  store_transcripts: boolean;
  store_screenshots: boolean;
}

/** PATCH /v1/auth/me/privacy → User */
export interface PrivacyUpdate {
  store_transcripts?: boolean;
  store_screenshots?: boolean;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
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

export const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md";

// ─── Sessions ────────────────────────────────────────────────────────────────

export type SessionType = "interview" | "meeting" | "coding" | "assessment" | "phone" | "mock";
export type SessionStatus = "created" | "live" | "ended";

export type MockDifficulty = "easy" | "medium" | "hard";
export type MockInterviewType = "behavioral" | "technical" | "system_design" | "coding" | "mixed";

export interface MockConfig {
  interview_type: MockInterviewType;
  difficulty: MockDifficulty;
  duration_minutes: number;
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

// ─── Screenshots (Phase 7) ───────────────────────────────────────────────────

/** POST /v1/sessions/{id}/screenshots (multipart `image`); the answer streams over the live socket. */
export interface ScreenshotAccepted {
  screenshot_id: string;
}

// ─── Usage / billing ─────────────────────────────────────────────────────────

export type PlanId = "free" | "pro" | "unlimited";

export interface Usage {
  plan: PlanId;
  live_minutes_used: number;
  live_minutes_limit: number | null;
  screenshots_used: number;
  screenshots_limit: number | null;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** FastAPI returns { detail: string | ValidationError[] }; Orbit errors use { error: { code, message } }. */
export interface ApiErrorBody {
  detail?: string | Array<{ msg: string; loc?: Array<string | number> }>;
  error?: { code: string; message: string };
}
