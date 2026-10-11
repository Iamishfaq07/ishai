import {
  DEFAULT_LIVE_SETTINGS,
  emptyLiveAnswer,
  type AnswerLatency,
  type AnswerLength,
  type AnswerSize,
  type AnswerSource,
  type AudioStatus,
  type CancelReason,
  type LiveAnswer,
  type LiveSettings,
  type LiveState,
  type ProtocolError,
  type ProviderKind,
  type ProviderStatus,
  type QuestionType,
  type ReasoningLevel,
  type ServerEvent,
  type Speaker,
  type MockRoundSummary,
} from "@orbit/types";
import { SESSION_ENDED, type CloseInfo, type ConnectionStatus } from "./client";

export interface TurnView {
  turn_id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
  start_ms: number | null;
  end_ms: number | null;
  /** The interviewer's voice in the mic: not shown, and not the candidate speaking. */
  echo?: boolean;
}

export interface QuestionView {
  question_id: string;
  turn_id: string | null;
  text: string;
  type: QuestionType;
  confidence: number;
  is_follow_up: boolean;
  /** "chat": what was typed in chat, shown above a chat reply (not something the interviewer asked). */
  source?: "chat";
}

/** The question the server gives a screenshot. Asking it again (`answer.request`) re-answers the last screenshot
 * with its image (the server keeps the newest one). */
export const SCREENSHOT_QUESTION = "📷 Screenshot";

export type AnswerStatus = "streaming" | "complete" | "cancelled" | "failed";

export interface AnswerView {
  answer_id: string;
  question_id: string;
  status: AnswerStatus;
  answer: LiveAnswer;
  length: AnswerLength;
  /** Auto length: the size picked for this question ("Quick answer", "Long answer"…). */
  size?: AnswerSize;
  reasoning: ReasoningLevel;
  source: AnswerSource;
  latency: AnswerLatency | null;
  error: ProtocolError | null;
  /** True once at least one chunk arrived — distinguishes "Thinking…" from streaming. */
  has_content: boolean;
  /** Why it stopped early ("stopped": the user pressed Stop; "superseded": a newer question took over). */
  cancel_reason?: CancelReason | null;
  /** Index into turnOrder when the answer appeared (candidate turns from here count toward key points). */
  spoken_from: number;
  /** Chat replies: what was asked in chat (the server's events don't say). Try again asks it again. */
  prompt?: string;
}

export type ChatEntry =
  /**
   * `unanswered`: no reply is coming, and why: the connection dropped before it started (sending it again can work),
   * or the server refused the message (an expired screenshot to rewrite, a message too long).
   */
  | { kind: "user"; id: string; text: string; ts: number; unanswered?: { reason: string; retryable: boolean } }
  | { kind: "answer"; id: string; answer_id: string };

export interface LiveViewState {
  connection: ConnectionStatus;
  connectionDetail: string | null;
  /** Machine-readable reason the connection closed for good (e.g. another live session is running). */
  connectionInfo: CloseInfo | null;
  state: LiveState;
  settings: LiveSettings;
  /**
   * The settings this client asked for: the initial ones plus every change made here. They win over the server's
   * copy, which can be older (`session.started` goes out before the server has read `session.start`, and a new
   * connection's engine starts from the session's saved settings), and they're re-sent on every (re)connect.
   */
  requestedSettings: Partial<LiveSettings>;
  /**
   * The user paused listening. Kept across a reconnect (the new engine starts unpaused, so the pause is sent again),
   * and the UI stays paused meanwhile instead of flashing "Listening".
   */
  userPaused: boolean;
  startedAt: number | null;
  turnOrder: string[];
  turns: Record<string, TurnView>;
  questionOrder: string[];
  questions: Record<string, QuestionView>;
  answerOrder: string[];
  answers: Record<string, AnswerView>;
  /** The question/answer the live panel shows (latest), independent of pinning. */
  currentQuestionId: string | null;
  currentAnswerId: string | null;
  /** A pinned answer freezes the display and is never auto-cancelled server-side. */
  pinnedAnswerId: string | null;
  /** Browsing an earlier answer (local only); null = follow the live answer. */
  viewedAnswerId: string | null;
  /** The live answer when browsing began: a different one since then is a new answer to go back to. */
  browseFromAnswerId: string | null;
  chat: ChatEntry[];
  /**
   * Chat messages still waiting for their reply, oldest first: the server answers them in order. `sentOpen`: it went
   * out on an open socket, so if that drops the reply is lost; one sent while disconnected waits in the client's
   * queue for the next connection.
   */
  pendingChat: Array<{ id: string; text: string; sentOpen: boolean }>;
  mic: AudioStatus;
  system: AudioStatus;
  providers: Partial<Record<ProviderKind, ProviderStatus>>;
  lastError: { code: string; message: string } | null;
  /** Server-reported live-minute status: set when few minutes remain or the limit ended the session. */
  usage: { minutesRemaining: number; limitReached: boolean; reason: "monthly" | "session" } | null;
  /** Mock interview: the AI interviewer's current question, and whether the interview is over. */
  mock: {
    questionId: string;
    text: string;
    isFollowUp: boolean;
    index: number;
    total: number;
    drillKind: "retry" | "follow_up" | "concise" | "prep" | "story" | null;
    /** Salary-negotiation practice: a recruiter on a call, counted in turns. */
    negotiation: boolean;
    /** The server's reading of the question's kind, for "Stuck? Show a structure" (answerHints.ts). */
    questionType?: string;
    /** A panel interview: who's asking. */
    speaker?: { persona: string; name: string; title: string };
  } | null;
  mockCompleted: boolean;
  mockSummary: MockRoundSummary | null;
}

export type LocalAction =
  | { type: "local/connection"; status: ConnectionStatus; detail?: string; info?: CloseInfo }
  | { type: "local/pin"; answer_id: string; pinned: boolean }
  | { type: "local/clear" }
  | { type: "local/view"; answer_id: string | null }
  | { type: "local/chat_sent"; id: string; text: string; ts: number }
  | { type: "local/settings"; settings: Partial<LiveSettings> }
  | { type: "local/pause"; paused: boolean }
  | { type: "local/speaker"; turn_id: string; speaker: Speaker }
  | { type: "local/dismiss_error" };

export type LiveAction = ServerEvent | LocalAction;

export function initialLiveState(settings: Partial<LiveSettings> = {}): LiveViewState {
  return {
    connection: "closed",
    connectionDetail: null,
    connectionInfo: null,
    state: "idle",
    settings: { ...DEFAULT_LIVE_SETTINGS, ...settings },
    requestedSettings: { ...settings },
    userPaused: false,
    startedAt: null,
    turnOrder: [],
    turns: {},
    questionOrder: [],
    questions: {},
    answerOrder: [],
    answers: {},
    currentQuestionId: null,
    currentAnswerId: null,
    viewedAnswerId: null,
    browseFromAnswerId: null,
    pinnedAnswerId: null,
    chat: [],
    pendingChat: [],
    mic: { state: "idle" },
    system: { state: "idle" },
    providers: {},
    lastError: null,
    usage: null,
    mock: null,
    mockCompleted: false,
    mockSummary: null,
  };
}

/** Answer the panel should display: the pinned one, else the one being browsed, else the latest. */
export function selectDisplayedAnswer(s: LiveViewState): AnswerView | null {
  const id = s.pinnedAnswerId ?? s.viewedAnswerId ?? s.currentAnswerId;
  return id ? (s.answers[id] ?? null) : null;
}

export function selectDisplayedQuestion(s: LiveViewState): QuestionView | null {
  const answer = selectDisplayedAnswer(s);
  if ((s.pinnedAnswerId || s.viewedAnswerId) && answer) {
    return answer.source === "chat" ? chatQuestion(answer) : (s.questions[answer.question_id] ?? null);
  }
  if (s.currentQuestionId) return s.questions[s.currentQuestionId] ?? null;
  // A chat reply sits under what was asked in chat, not the interviewer's previous question.
  return answer?.source === "chat" ? chatQuestion(answer) : null;
}

function chatQuestion(answer: AnswerView): QuestionView {
  return {
    question_id: `chat:${answer.answer_id}`,
    turn_id: null,
    text: answer.prompt ?? "",
    type: answer.answer.type,
    confidence: 1,
    is_follow_up: false,
    source: "chat",
  };
}

/** The newest screenshot's question: the only screenshot the server can answer again. */
export function selectLatestScreenshotQuestionId(s: LiveViewState): string | null {
  for (let i = s.questionOrder.length - 1; i >= 0; i--) {
    const q = s.questions[s.questionOrder[i] as string];
    if (q?.text === SCREENSHOT_QUESTION) return q.question_id;
  }
  return null;
}

export type AskAgain =
  | { via: "chat"; text: string }
  /** `text` undefined: the question isn't known here, so the server answers the one it's listening to. */
  | { via: "answer"; text: string | undefined; screenshot: boolean };

/**
 * How an answer is asked again (Try again, Shorter/Longer, another code language), or null when it can't be:
 * - a chat reply: its chat message, sent again (the phone companion never sees what was typed);
 * - a screenshot: the screenshot question, which the server answers with the newest image it kept, so only the
 *   newest screenshot can be;
 * - anything else: its own question. Not simply the one on the card: a newly detected question shows above the
 *   previous answer until its own answer starts.
 */
export function selectAskAgain(s: LiveViewState, answer: AnswerView | null): AskAgain | null {
  if (!answer) return null;
  if (answer.source === "chat") return answer.prompt ? { via: "chat", text: answer.prompt } : null;
  const own = s.questions[answer.question_id]?.text;
  if (answer.source === "screenshot" || own === SCREENSHOT_QUESTION) {
    return answer.question_id === selectLatestScreenshotQuestionId(s)
      ? { via: "answer", text: SCREENSHOT_QUESTION, screenshot: true }
      : null;
  }
  return { via: "answer", text: own, screenshot: false };
}

/**
 * Answers you can flip back through, oldest first: one entry per question (its latest answer with content —
 * a regenerated answer replaces the earlier one), plus each chat reply. Cancelled-empty answers are skipped.
 */
export function selectAnswerHistory(s: LiveViewState): string[] {
  const latest = new Map<string, string>();
  for (const id of s.answerOrder) {
    const a = s.answers[id];
    if (!a || !a.has_content || a.status === "failed") continue;
    const key = a.question_id ? `q:${a.question_id}` : `a:${id}`;
    latest.delete(key); // re-insert so ordering follows the newest version
    latest.set(key, id);
  }
  return [...latest.values()];
}

/** Latest interviewer utterance (partial or final) — what the manual Answer button targets. */
export function selectLatestInterviewerTurn(s: LiveViewState): TurnView | null {
  for (let i = s.turnOrder.length - 1; i >= 0; i--) {
    const turn = s.turns[s.turnOrder[i] as string];
    if (turn && turn.speaker !== "candidate" && turn.text.trim()) return turn;
  }
  return null;
}

function upsertTurn(s: LiveViewState, turn: TurnView): LiveViewState {
  const exists = turn.turn_id in s.turns;
  return {
    ...s,
    turns: { ...s.turns, [turn.turn_id]: turn },
    turnOrder: exists ? s.turnOrder : [...s.turnOrder, turn.turn_id],
  };
}

function patchAnswer(s: LiveViewState, id: string, patch: Partial<AnswerView>): LiveViewState {
  const existing = s.answers[id];
  if (!existing) return s;
  return { ...s, answers: { ...s.answers, [id]: { ...existing, ...patch } } };
}

export const CONNECTION_LOST: ProtocolError = {
  code: "connection_lost",
  message: "The connection dropped before this answer finished.",
  retryable: true,
};

/**
 * The socket is gone, and the server's engine for it with everything in flight: no answer it was writing will
 * finish (its answer.cancelled can't arrive, and the next connection's engine has no active answer, so Stop can't
 * reach it), and no chat message sent on it will be answered. Fail those answers so Try again shows instead of
 * "Thinking…" forever, and mark the messages.
 */
function interrupt(s: LiveViewState): LiveViewState {
  let answers = s.answers;
  for (const a of Object.values(s.answers)) {
    if (a.status !== "streaming") continue;
    if (answers === s.answers) answers = { ...s.answers };
    answers[a.answer_id] = { ...a, status: "failed", error: CONNECTION_LOST };
  }
  const lost = new Set(s.pendingChat.filter((p) => p.sentOpen).map((p) => p.id));
  const next = answers === s.answers ? s : { ...s, answers };
  return unanswered(next, lost, { reason: "The connection dropped before Orbit replied.", retryable: true });
}

/** These chat messages won't get a reply: they stop waiting (so a later reply isn't taken for theirs) and say why. */
function unanswered(
  s: LiveViewState,
  ids: ReadonlySet<string>,
  why: { reason: string; retryable: boolean },
): LiveViewState {
  if (ids.size === 0) return s;
  return {
    ...s,
    pendingChat: s.pendingChat.filter((p) => !ids.has(p.id)),
    chat: s.chat.map((c) => (c.kind === "user" && ids.has(c.id) ? { ...c, unanswered: why } : c)),
  };
}

/**
 * Errors the server sends instead of a chat reply: a rewrite of a screenshot it no longer keeps, or a message it
 * refused (too long). It handles chat messages in order, so it's the oldest one still waiting. ("screenshot_expired"
 * also answers a screenshot's Try again; with a chat message waiting at that same moment, that one is taken for it.)
 */
function refusesChat(error: { code: string; message: string }): boolean {
  return error.code === "screenshot_expired" || (error.code === "invalid_event" && error.message.startsWith("chat.message"));
}

function placeholderAnswer(answer_id: string, question_id: string): AnswerView {
  return {
    answer_id,
    question_id,
    status: "streaming",
    answer: emptyLiveAnswer(),
    length: "standard",
    reasoning: "light",
    source: "auto",
    latency: null,
    error: null,
    has_content: false,
    spoken_from: 0,
  };
}

export function liveReducer(s: LiveViewState, action: LiveAction): LiveViewState {
  switch (action.type) {
    // ── local ────────────────────────────────────────────────────────────
    case "local/connection": {
      const next = { ...s, connection: action.status, connectionDetail: action.detail ?? null, connectionInfo: action.info ?? null };
      if (action.status === "open") return next;
      // Ended while this client was away (from another window or device): it never got session.ended, and
      // reconnecting can't work, so it's over here too (capture stops, the page can point to the review).
      const over = action.status === "closed" && action.info?.code === SESSION_ENDED;
      return interrupt(over ? { ...next, state: "ended" } : next);
    }

    case "local/pin": {
      if (!action.pinned) {
        return s.pinnedAnswerId === action.answer_id ? { ...s, pinnedAnswerId: null } : s;
      }
      return action.answer_id in s.answers ? { ...s, pinnedAnswerId: action.answer_id } : s;
    }

    case "local/clear":
      return {
        ...s,
        currentQuestionId: null,
        currentAnswerId: null,
        pinnedAnswerId: null,
        viewedAnswerId: null,
        browseFromAnswerId: null,
      };

    case "local/view": {
      const viewed = action.answer_id && action.answer_id in s.answers ? action.answer_id : null;
      return {
        ...s,
        viewedAnswerId: viewed,
        browseFromAnswerId: viewed === null ? null : s.viewedAnswerId === null ? s.currentAnswerId : s.browseFromAnswerId,
      };
    }

    case "local/chat_sent":
      return {
        ...s,
        chat: [...s.chat, { kind: "user", id: action.id, text: action.text, ts: action.ts }],
        pendingChat: [...s.pendingChat, { id: action.id, text: action.text, sentOpen: s.connection === "open" }],
      };

    case "local/settings":
      return {
        ...s,
        settings: { ...s.settings, ...action.settings },
        requestedSettings: { ...s.requestedSettings, ...action.settings },
      };

    case "local/pause":
      // Shown right away (also while disconnected: the pause is queued, and re-sent on the next connect).
      if (s.state === "ended") return s;
      return {
        ...s,
        userPaused: action.paused,
        state: action.paused ? "paused" : s.state === "paused" ? "listening" : s.state,
      };

    case "local/speaker": {
      const turn = s.turns[action.turn_id];
      return turn ? { ...s, turns: { ...s.turns, [turn.turn_id]: { ...turn, speaker: action.speaker } } } : s;
    }

    case "local/dismiss_error":
      return { ...s, lastError: null };

    // ── session ──────────────────────────────────────────────────────────
    // The server's settings are the base; what this client asked for goes on top (the server applies it from
    // `session.start` / `settings.update`, but its echo can predate them).
    case "session.started":
      return {
        ...s,
        // A new engine starts listening; a user who paused stays paused (the hook sends the pause again).
        state: s.userPaused ? "paused" : action.data.state,
        settings: { ...action.data.settings, ...s.requestedSettings },
        startedAt: s.startedAt ?? action.ts,
      };
    case "session.paused":
      return { ...s, userPaused: true, state: action.data.state, settings: { ...action.data.settings, ...s.requestedSettings } };
    case "session.resumed":
      return { ...s, userPaused: false, state: action.data.state, settings: { ...action.data.settings, ...s.requestedSettings } };
    case "session.ended":
      return { ...s, state: action.data.state, settings: { ...action.data.settings, ...s.requestedSettings } };

    case "state.changed":
      // Paused, the server still reports work it does for the user (a chat reply streaming, transcription
      // reconnecting) and then "listening", while it isn't listening: stay paused until they resume.
      return { ...s, state: s.userPaused && action.data.state !== "ended" ? "paused" : action.data.state };

    case "audio.mic_status":
      return { ...s, mic: action.data };
    case "audio.system_status":
      return { ...s, system: action.data };

    case "provider.status":
      return { ...s, providers: { ...s.providers, [action.data.provider]: action.data } };

    case "mock.question":
      return {
        ...s,
        mock: { questionId: action.data.question_id, text: action.data.text, isFollowUp: action.data.is_follow_up,
          drillKind: action.data.drill_kind ?? null, negotiation: Boolean(action.data.negotiation),
          ...(action.data.question_type ? { questionType: action.data.question_type } : {}),
          ...(action.data.speaker ? { speaker: action.data.speaker } : {}),
                index: action.data.index, total: action.data.total },
      };
    case "mock.completed":
      return { ...s, mockCompleted: true, mockSummary: action.data };

    case "usage.status":
      return {
        ...s,
        usage: {
          minutesRemaining: action.data.minutes_remaining,
          limitReached: action.data.limit_reached,
          reason: action.data.reason ?? "monthly",
        },
      };

    // ── transcript ───────────────────────────────────────────────────────
    case "transcript.partial": {
      const existing = s.turns[action.data.turn_id];
      // A late partial must never overwrite the finalized text.
      if (existing?.final) return s;
      if (existing && existing.text === action.data.text && existing.speaker === action.data.speaker) return s;
      return upsertTurn(s, {
        turn_id: action.data.turn_id,
        speaker: action.data.speaker,
        text: action.data.text,
        final: false,
        start_ms: existing?.start_ms ?? null,
        end_ms: null,
      });
    }
    case "transcript.final":
      return upsertTurn(s, {
        turn_id: action.data.turn_id,
        speaker: action.data.speaker,
        text: action.data.text,
        final: true,
        start_ms: action.data.start_ms,
        end_ms: action.data.end_ms,
        ...(action.data.echo ? { echo: true } : {}),
      });

    // ── questions ────────────────────────────────────────────────────────
    case "question.detected": {
      const q: QuestionView = { ...action.data };
      const exists = q.question_id in s.questions;
      return {
        ...s,
        questions: { ...s.questions, [q.question_id]: q },
        questionOrder: exists ? s.questionOrder : [...s.questionOrder, q.question_id],
        currentQuestionId: q.question_id,
      };
    }
    case "question.updated": {
      const existing = s.questions[action.data.question_id];
      if (!existing) return s;
      return {
        ...s,
        questions: { ...s.questions, [existing.question_id]: { ...existing, text: action.data.text } },
      };
    }

    // ── answers ──────────────────────────────────────────────────────────
    case "answer.started": {
      const { answer_id, question_id, length, size, reasoning, source } = action.data;
      const existing = s.answers[answer_id];
      const threaded = s.chat.some((c) => c.kind === "answer" && c.answer_id === answer_id);
      // A new chat reply answers the oldest message still waiting: the server handles chat messages in order.
      const asked = source === "chat" && !threaded ? s.pendingChat[0] : undefined;
      const view: AnswerView = {
        ...(existing ?? placeholderAnswer(answer_id, question_id)),
        question_id,
        length,
        ...(size ? { size } : {}),
        reasoning,
        source,
        // Transcript position when this answer appeared: candidate speech after it counts toward its key points.
        spoken_from: existing?.spoken_from ?? s.turnOrder.length,
        ...(asked ? { prompt: asked.text } : {}),
      };
      const seen = answer_id in s.answers;
      return {
        ...s,
        answers: { ...s.answers, [answer_id]: view },
        answerOrder: seen ? s.answerOrder : [...s.answerOrder, answer_id],
        currentAnswerId: answer_id,
        // A chat reply's "question" is its chat message (see selectDisplayedQuestion), until the interviewer asks
        // something new.
        currentQuestionId: source === "chat" ? null : question_id in s.questions ? question_id : s.currentQuestionId,
        chat: source === "chat" && !threaded ? [...s.chat, { kind: "answer", id: `a-${answer_id}`, answer_id }] : s.chat,
        pendingChat: asked ? s.pendingChat.slice(1) : s.pendingChat,
      };
    }
    case "answer.chunk": {
      const { answer_id, partial } = action.data;
      const existing = s.answers[answer_id];
      if (existing && existing.status !== "streaming") return s; // late chunk after completion/cancel
      if (!existing) {
        // Chunk before `answer.started` (e.g. after a reconnect): adopt it.
        const view = { ...placeholderAnswer(answer_id, ""), answer: partial, has_content: true };
        return {
          ...s,
          answers: { ...s.answers, [answer_id]: view },
          answerOrder: [...s.answerOrder, answer_id],
          currentAnswerId: answer_id,
        };
      }
      return patchAnswer(s, answer_id, { answer: partial, has_content: true });
    }
    case "answer.completed": {
      const { answer_id, answer, latency } = action.data;
      if (!(answer_id in s.answers)) {
        const view: AnswerView = {
          ...placeholderAnswer(answer_id, ""),
          status: "complete",
          answer,
          latency,
          has_content: true,
        };
        return {
          ...s,
          answers: { ...s.answers, [answer_id]: view },
          answerOrder: [...s.answerOrder, answer_id],
          currentAnswerId: answer_id,
        };
      }
      return patchAnswer(s, answer_id, { status: "complete", answer, latency, has_content: true });
    }
    case "answer.cancelled": {
      const { answer_id, reason } = action.data;
      let next = patchAnswer(s, answer_id, { status: "cancelled", cancel_reason: reason });
      if (reason === "cleared" && next.currentAnswerId === answer_id) {
        next = { ...next, currentAnswerId: null, currentQuestionId: null };
      }
      if (next.pinnedAnswerId === answer_id && reason !== "superseded") {
        next = { ...next, pinnedAnswerId: null };
      }
      return next;
    }
    case "answer.failed":
      return patchAnswer(s, action.data.answer_id, { status: "failed", error: action.data.error });

    case "error": {
      const next = { ...s, lastError: action.data };
      const oldest = refusesChat(action.data) ? next.pendingChat[0] : undefined;
      return oldest ? unanswered(next, new Set([oldest.id]), { reason: action.data.message, retryable: false }) : next;
    }

    default: {
      const _exhaustive: never = action;
      return s;
    }
  }
}
