/**
 * Orbit Live Protocol v1 — TypeScript mirror of apps/api/orbit_api/live/events.py.
 * See docs/PROTOCOL.md. Change both sides together and bump PROTOCOL_VERSION.
 */

export const PROTOCOL_VERSION = 1 as const;

export const QUESTION_TYPES = [
  "behavioral",
  "technical",
  "coding",
  "system_design",
  "resume",
  "leadership",
  "salary",
  "culture",
  "clarification",
  "follow_up",
  "small_talk",
  "non_question",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const LIVE_STATES = [
  "idle",
  "listening",
  "speech_detected",
  "question_detected",
  "generating",
  "streaming",
  "answer_complete",
  "follow_up_detected",
  "stt_reconnecting",
  "ai_reconnecting",
  "error",
  "paused",
  "ended",
] as const;
export type LiveState = (typeof LIVE_STATES)[number];

/** "auto" (the default for new sessions) sizes each answer to its question; the others are fixed lengths. */
export type AnswerLength = "auto" | "short" | "standard" | "detailed";
/**
 * What "auto" picked for one answer: brief (1–3 sentences: "Have you used Docker?"), short ("What is an API?"),
 * medium (intro, why us, "how does X work"), long (a story, an approach), detailed (system design, deep multi-part).
 */
export type AnswerSize = "brief" | "short" | "medium" | "long" | "detailed";
/** The candidate's level answers are pitched at; "auto" infers it from the resume and the role. */
export type ExperienceLevel = "auto" | "fresher" | "junior" | "mid" | "senior";
/** Offered styles are natural / concise / story (all spoken prose); the rest are legacy values on older sessions. */
export type AnswerStyle = "natural" | "concise" | "story" | "bullets" | "star" | "technical" | "executive";
/** Model thinking effort: off answers immediately; low/high/max add seconds of reasoning before the first word. */
export type ThinkingLevel = "off" | "low" | "high" | "max";
/** How long to wait after the interviewer stops before auto-answering (quick ≈ 0, balanced ≈ 1.5 s, patient ≈ 3 s). */
export type ResponseTiming = "quick" | "balanced" | "patient";

export interface LiveSettings {
  auto_answer: boolean;
  length: AnswerLength;
  style: AnswerStyle;
  answer_language?: string;
  response_timing?: ResponseTiming;
  thinking?: ThinkingLevel;
  /** Preferred language for code in coding answers (unset: the model picks). */
  coding_language?: CodingLanguage;
  /** Unset or "auto": inferred from the session's resume and role. */
  experience?: ExperienceLevel;
}

export type CodingLanguage = "python" | "java" | "javascript" | "typescript" | "cpp" | "csharp" | "go" | "rust" | "sql";

/**
 * Speaker labels. PROTOCOL.md leaves the value set open; the mic channel maps to
 * "candidate", system audio to "interviewer". "other" covers extra meeting participants.
 */
export type Speaker = "interviewer" | "candidate" | "other" | "unknown";

/** Binary audio channel byte: 0 = mic (candidate), 1 = system (interviewer/others). */
export const AUDIO_CHANNEL = { mic: 0, system: 1 } as const;
export type AudioChannel = (typeof AUDIO_CHANNEL)[keyof typeof AUDIO_CHANNEL];

export interface LiveAnswerCode {
  language: string;
  content: string;
}

export interface FactSource {
  ref: string;
  chunk_id: string;
  doc_kind: string;
  document: string;
  label: string;
  excerpt: string;
  /** From the user's own documents (a resume fact), not a JD requirement or a note. */
  verified: boolean;
}

export interface LiveAnswer {
  question: string;
  type: QuestionType;
  direct_answer: string;
  talking_points: string[];
  example: string | null;
  code: LiveAnswerCode | null;
  time_complexity: string | null;
  space_complexity: string | null;
  follow_up: string | null;
  context_used: string[];
  /**
   * Where the answer's claims about the user come from: "verified" (stated in their documents), "inferred" (built
   * on them but going further — check the details), "example" (unsupported: illustrative details to swap for
   * their real experience), "general" (no personal claims). The server never leaves "verified" without a source.
   */
  grounding?: "verified" | "inferred" | "example" | "general" | null;
  /** The document facts the answer's claims about the user rely on (resolved from the model's SOURCES). */
  sources?: FactSource[];
  /** 3–6 short labels for the answer's points, in order (drives the "NEXT" checklist). */
  key_points?: string[];
  /** Coding answers: the task in one line, edge cases to mention, example tests (`input → expected`). */
  problem?: string | null;
  edge_cases?: string[];
  tests?: string[];
  /** System design mode: structured sections behind the spoken talk track. */
  design?: Array<{ title: string; text: string }>;
  /** Debug mode: root cause, minimal fix, why it failed, and a unified diff (the corrected code is `code`). */
  debug?: { root_cause: string | null; fix: string | null; why: string | null; diff: string | null } | null;
  /** Up to 3 technical words the spoken answer uses, with their plain meaning (shown dimmed, never said). */
  terms?: AnswerTerm[];
}

export interface AnswerTerm {
  term: string;
  meaning: string;
}

export interface Envelope<TType extends string = string, TData = unknown> {
  v: typeof PROTOCOL_VERSION;
  type: TType;
  seq?: number;
  ts: number;
  data: TData;
}

// ─── Client → server ─────────────────────────────────────────────────────────

export interface ClientEventMap {
  "session.start": { settings?: Partial<LiveSettings> };
  "session.pause": Record<string, never>;
  "session.resume": Record<string, never>;
  "session.end": Record<string, never>;
  /**
   * `size` / `simpler`: this one answer only (the card's Shorter / Longer / Simpler on an auto-length session); the
   * session keeps its settings. Servers from before them ignore both.
   */
  "answer.request": { question_text?: string; size?: AnswerSize; simpler?: boolean };
  /** Mock interview: the candidate is done answering — ask the next question now. */
  "mock.next": Record<string, never>;
  "answer.pin": { answer_id: string; pinned: boolean };
  "answer.clear": Record<string, never>;
  /** Stop writing the answer on screen, keeping what's there. */
  "answer.stop": Record<string, never>;
  "chat.message": { text: string };
  "settings.update": Partial<LiveSettings>;
  "speaker.correct": { turn_id: string; speaker: Speaker };
  /** Mock STT only. speed: 0.5–50 (default 1). */
  "dev.simulate": { fixture: string; speed?: number };
}
export type ClientEventType = keyof ClientEventMap;
export type ClientEvent = {
  [K in ClientEventType]: Envelope<K, ClientEventMap[K]>;
}[ClientEventType];

// ─── Server → client ─────────────────────────────────────────────────────────

export type AudioStatusState = "idle" | "connected" | "reconnecting" | "error";
export interface AudioStatus {
  state: AudioStatusState;
  detail?: string;
}

export type ProviderKind = "stt" | "llm";
/** "connecting": the provider socket isn't open yet (audio is buffered) — never reported as ok prematurely. */
export type ProviderState = "connecting" | "ok" | "reconnecting" | "down" | "mock";
export interface ProviderStatus {
  provider: ProviderKind;
  name: string;
  state: ProviderState;
  detail?: string;
}

export interface SessionStateData {
  state: LiveState;
  settings: LiveSettings;
}

export type ReasoningLevel = "light" | "deep";
export type AnswerSource = "auto" | "manual" | "chat" | "screenshot";
export type CancelReason = "superseded" | "cleared" | "session_ended" | "stopped";

export interface AnswerLatency {
  first_token_ms: number | null;
  total_ms: number;
}

export interface ProtocolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ServerEventMap {
  "session.started": SessionStateData;
  "session.paused": SessionStateData;
  "session.resumed": SessionStateData;
  "session.ended": SessionStateData;
  "state.changed": { state: LiveState };
  "audio.mic_status": AudioStatus;
  "audio.system_status": AudioStatus;
  "transcript.partial": { turn_id: string; speaker: Speaker; text: string };
  "transcript.final": {
    turn_id: string;
    speaker: Speaker;
    text: string;
    start_ms: number;
    end_ms: number;
    /** The interviewer's voice heard by the mic (speakers, no headphones): not something the candidate said. */
    echo?: boolean;
  };
  "question.detected": {
    question_id: string;
    /** null for manual answers not tied to a transcript turn. */
    turn_id: string | null;
    text: string;
    type: QuestionType;
    confidence: number;
    is_follow_up: boolean;
  };
  "question.updated": { question_id: string; text: string };
  "answer.started": {
    answer_id: string;
    question_id: string;
    /** The fixed length this answer was written to (never "auto": an auto answer gives the nearest one). */
    length: AnswerLength;
    /** Auto length: the size picked for this question (or asked for with Shorter / Longer). */
    size?: AnswerSize;
    reasoning: ReasoningLevel;
    source: AnswerSource;
  };
  "answer.chunk": { answer_id: string; partial: LiveAnswer };
  "answer.completed": { answer_id: string; answer: LiveAnswer; latency: AnswerLatency };
  "answer.cancelled": { answer_id: string; reason: CancelReason };
  "answer.failed": { answer_id: string; error: ProtocolError };
  "provider.status": ProviderStatus;
  /** Mock interview: the AI interviewer's next question (the client speaks it). */
  "mock.question": {
    question_id: string;
    text: string;
    is_follow_up: boolean;
    index: number;
    total: number;
    /** Re-drill sessions only: a weak question again, its live follow-up, or the short version. */
    drill_kind?: "retry" | "follow_up" | "concise" | "prep" | "story";
    /** Salary-negotiation practice: the AI is a recruiter, and `index`/`total` count turns of the call. */
    negotiation?: boolean;
    /** What kind of question it is ("behavioral", "system_design", "follow_up"…), for the structure hint. */
    question_type?: string;
    /** A panel interview: which panelist asks it. */
    speaker?: { persona: string; name: string; title: string };
  };
  /** Mock interview finished (planned questions or time used up); session.ended follows. */
  "mock.completed": MockRoundSummary;
  /** Live-minute quota (server-enforced): a warning when few minutes remain; at the limit the session ends. */
  /** `reason`: which limit — this month's allowance ("monthly") or this session's maximum length ("session"). */
  "usage.status": { minutes_remaining: number; limit_reached: boolean; reason?: "monthly" | "session" };
  error: { code: string; message: string };
}
export type ServerEventType = keyof ServerEventMap;
export type ServerEvent = {
  [K in ServerEventType]: Envelope<K, ServerEventMap[K]>;
}[ServerEventType];

/** Transcript fixtures the server's mock STT provider can replay via `dev.simulate`. */
export const DEV_FIXTURES = ["behavioral_interview", "technical_interview", "coding_interview", "meeting"] as const;

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  auto_answer: true,
  length: "auto",
  style: "natural",
  response_timing: "balanced",
  thinking: "off",
};

export function emptyLiveAnswer(question = ""): LiveAnswer {
  return {
    question,
    type: "technical",
    direct_answer: "",
    talking_points: [],
    example: null,
    code: null,
    time_complexity: null,
    space_complexity: null,
    follow_up: null,
    context_used: [],
  };
}

const SERVER_EVENT_TYPES: ReadonlySet<string> = new Set<ServerEventType>([
  "session.started",
  "session.paused",
  "session.resumed",
  "session.ended",
  "state.changed",
  "audio.mic_status",
  "audio.system_status",
  "transcript.partial",
  "transcript.final",
  "question.detected",
  "question.updated",
  "answer.started",
  "answer.chunk",
  "answer.completed",
  "answer.cancelled",
  "answer.failed",
  "provider.status",
  "usage.status",
  "mock.question",
  "mock.completed",
  "error",
]);

/** Shallow structural check for frames received off the wire. */
export function isServerEvent(value: unknown): value is ServerEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === PROTOCOL_VERSION &&
    typeof v.type === "string" &&
    SERVER_EVENT_TYPES.has(v.type) &&
    typeof v.data === "object" &&
    v.data !== null
  );
}

/** End of a mock round: counts for the summary screen (the graded scorecard comes from the session review). */
export interface MockRoundSummary {
  questions: number;
  topics?: number;
  follow_ups?: number;
  answered?: number;
  unanswered?: number;
  average_answer_words?: number;
  drill?: boolean;
  negotiation?: boolean;
}
