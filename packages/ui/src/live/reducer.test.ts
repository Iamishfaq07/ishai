import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  emptyLiveAnswer,
  type LiveAnswer,
  type ServerEvent,
  type ServerEventMap,
  type ServerEventType,
} from "@orbit/types";
import {
  initialLiveState,
  liveReducer,
  selectAnswerHistory,
  selectDisplayedAnswer,
  selectDisplayedQuestion,
  selectLatestInterviewerTurn,
  type LiveAction,
  type LiveViewState,
} from "./reducer";

let seq = 0;
function ev<K extends ServerEventType>(type: K, data: ServerEventMap[K]): ServerEvent {
  seq += 1;
  return { v: PROTOCOL_VERSION, type, seq, ts: 1_000 + seq, data } as ServerEvent;
}

function run(actions: LiveAction[], start: LiveViewState = initialLiveState()): LiveViewState {
  return actions.reduce(liveReducer, start);
}

function answer(points: string[], extra: Partial<LiveAnswer> = {}): LiveAnswer {
  return { ...emptyLiveAnswer("Tell me about yourself."), talking_points: points, ...extra };
}

const detected = (id: string, turn: string | null = "t1") =>
  ev("question.detected", {
    question_id: id,
    turn_id: turn,
    text: `Question ${id}`,
    type: "behavioral",
    confidence: 0.9,
    is_follow_up: false,
  });

const started = (answerId: string, questionId: string, source: "auto" | "manual" | "chat" = "auto") =>
  ev("answer.started", { answer_id: answerId, question_id: questionId, length: "standard", reasoning: "light", source });

describe("transcript", () => {
  it("replaces partials for the same turn and keeps order", () => {
    const s = run([
      ev("transcript.partial", { turn_id: "t1", speaker: "interviewer", text: "Tell me" }),
      ev("transcript.partial", { turn_id: "t1", speaker: "interviewer", text: "Tell me about" }),
      ev("transcript.partial", { turn_id: "t2", speaker: "candidate", text: "Sure" }),
    ]);
    expect(s.turnOrder).toEqual(["t1", "t2"]);
    expect(s.turns.t1?.text).toBe("Tell me about");
    expect(s.turns.t1?.final).toBe(false);
  });

  it("final replaces partial, and a late partial never overwrites the final", () => {
    const s = run([
      ev("transcript.partial", { turn_id: "t1", speaker: "interviewer", text: "Tell me about" }),
      ev("transcript.final", { turn_id: "t1", speaker: "interviewer", text: "Tell me about yourself.", start_ms: 0, end_ms: 1800 }),
      ev("transcript.partial", { turn_id: "t1", speaker: "interviewer", text: "Tell me about your" }),
    ]);
    expect(s.turnOrder).toEqual(["t1"]);
    expect(s.turns.t1).toMatchObject({ text: "Tell me about yourself.", final: true, end_ms: 1800 });
  });

  it("returns the same object for identical partials (no re-render churn)", () => {
    const a = run([ev("transcript.partial", { turn_id: "t1", speaker: "interviewer", text: "Hi" })]);
    const b = liveReducer(a, ev("transcript.partial", { turn_id: "t1", speaker: "interviewer", text: "Hi" }));
    expect(b).toBe(a);
  });

  it("latest interviewer turn skips the candidate", () => {
    const s = run([
      ev("transcript.final", { turn_id: "t1", speaker: "interviewer", text: "Why this role?", start_ms: 0, end_ms: 1 }),
      ev("transcript.partial", { turn_id: "t2", speaker: "candidate", text: "Well" }),
    ]);
    expect(selectLatestInterviewerTurn(s)?.turn_id).toBe("t1");
  });
});

describe("answers", () => {
  it("answer.chunk is idempotent — same partial twice renders the same state", () => {
    const partial = answer(["Led AppSec reviews"]);
    const once = run([detected("q1"), started("a1", "q1"), ev("answer.chunk", { answer_id: "a1", partial })]);
    const twice = liveReducer(once, ev("answer.chunk", { answer_id: "a1", partial }));
    expect(twice.answers.a1).toEqual(once.answers.a1);
    expect(twice.answers.a1?.has_content).toBe(true);
    expect(selectDisplayedAnswer(twice)?.answer.talking_points).toEqual(["Led AppSec reviews"]);
  });

  it("chunks replace (not append) and completion freezes the answer", () => {
    const s = run([
      detected("q1"),
      started("a1", "q1"),
      ev("answer.chunk", { answer_id: "a1", partial: answer(["one"]) }),
      ev("answer.chunk", { answer_id: "a1", partial: answer(["one", "two"]) }),
      ev("answer.completed", {
        answer_id: "a1",
        answer: answer(["one", "two", "three"]),
        latency: { first_token_ms: 900, total_ms: 3000 },
      }),
      ev("answer.chunk", { answer_id: "a1", partial: answer(["stale"]) }),
    ]);
    expect(s.answers.a1?.status).toBe("complete");
    expect(s.answers.a1?.answer.talking_points).toEqual(["one", "two", "three"]);
    expect(s.answers.a1?.latency?.first_token_ms).toBe(900);
  });

  it("a chunk before answer.started (reconnect) is adopted", () => {
    const s = run([ev("answer.chunk", { answer_id: "a9", partial: answer(["x"]) })]);
    expect(s.currentAnswerId).toBe("a9");
    expect(s.answers.a9?.status).toBe("streaming");
  });

  it("superseded answers are marked cancelled and the new one is displayed", () => {
    const s = run([
      detected("q1"),
      started("a1", "q1"),
      detected("q2", "t2"),
      ev("answer.cancelled", { answer_id: "a1", reason: "superseded" }),
      started("a2", "q2"),
    ]);
    expect(s.answers.a1?.status).toBe("cancelled");
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a2");
    expect(selectDisplayedQuestion(s)?.question_id).toBe("q2");
  });

  it("a pinned answer stays displayed (with its question) while new ones stream", () => {
    const s = run([
      detected("q1"),
      started("a1", "q1"),
      { type: "local/pin", answer_id: "a1", pinned: true },
      detected("q2", "t2"),
      started("a2", "q2"),
    ]);
    expect(s.currentAnswerId).toBe("a2");
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a1");
    expect(selectDisplayedQuestion(s)?.question_id).toBe("q1");

    const unpinned = liveReducer(s, { type: "local/pin", answer_id: "a1", pinned: false });
    expect(selectDisplayedAnswer(unpinned)?.answer_id).toBe("a2");
  });

  it("pinning an unknown answer is a no-op", () => {
    const s = run([{ type: "local/pin", answer_id: "nope", pinned: true }]);
    expect(s.pinnedAnswerId).toBeNull();
  });

  it("clear hides the display; server 'cleared' cancel also unpins", () => {
    const base = run([detected("q1"), started("a1", "q1"), { type: "local/pin", answer_id: "a1", pinned: true }]);
    const cleared = liveReducer(base, { type: "local/clear" });
    expect(selectDisplayedAnswer(cleared)).toBeNull();
    expect(selectDisplayedQuestion(cleared)).toBeNull();

    const serverCleared = liveReducer(base, ev("answer.cancelled", { answer_id: "a1", reason: "cleared" }));
    expect(serverCleared.pinnedAnswerId).toBeNull();
    expect(serverCleared.currentAnswerId).toBeNull();
  });

  it("failed answers carry the error", () => {
    const s = run([
      detected("q1"),
      started("a1", "q1"),
      ev("answer.failed", { answer_id: "a1", error: { code: "llm_timeout", message: "AI timed out", retryable: true } }),
    ]);
    expect(s.answers.a1?.status).toBe("failed");
    expect(s.answers.a1?.error?.code).toBe("llm_timeout");
  });

  it("chat answers are threaded into the chat log once", () => {
    const s = run([
      { type: "local/chat_sent", id: "u1", text: "make it shorter", ts: 1 },
      started("a1", "q1", "chat"),
      started("a1", "q1", "chat"),
    ]);
    expect(s.chat.map((c) => c.kind)).toEqual(["user", "answer"]);
  });
});

describe("session + status", () => {
  it("tracks state, settings, and start time", () => {
    const s = run([
      ev("session.started", { state: "listening", settings: { auto_answer: false, length: "short", style: "star" } }),
      ev("state.changed", { state: "question_detected" }),
    ]);
    expect(s.state).toBe("question_detected");
    expect(s.settings.length).toBe("short");
    expect(s.startedAt).not.toBeNull();
  });

  it("records provider and audio status", () => {
    const s = run([
      ev("provider.status", { provider: "stt", name: "mock", state: "mock" }),
      ev("audio.system_status", { state: "error", detail: "Loopback unavailable" }),
    ]);
    expect(s.providers.stt?.state).toBe("mock");
    expect(s.system.detail).toBe("Loopback unavailable");
  });
});

describe("answer history", () => {
  const chunk = (answerId: string, text: string) =>
    ev("answer.chunk", { answer_id: answerId, partial: answer([], { direct_answer: text }) });
  const done = (answerId: string, text: string) =>
    ev("answer.completed", {
      answer_id: answerId,
      answer: answer([], { direct_answer: text }),
      latency: { first_token_ms: 1, total_ms: 2 },
    });

  it("keeps one entry per question (latest version) and lets you browse back without losing live", () => {
    let s = run([
      detected("q1"), started("a1", "q1"), done("a1", "first"),
      detected("q2"), started("a2", "q2"), done("a2", "second (part)"),
      started("a2b", "q2"), done("a2b", "second (whole question)"), // regenerated for the same question
      started("empty", "q2"), // superseded before any content → not browsable
    ]);
    s = run([ev("answer.cancelled", { answer_id: "empty", reason: "superseded" })], s);
    expect(selectAnswerHistory(s)).toEqual(["a1", "a2b"]);

    s = run([{ type: "local/view", answer_id: "a1" }], s);
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a1");
    expect(selectDisplayedQuestion(s)?.question_id).toBe("q1");

    // a new answer arrives while browsing: the view stays put, live moves on underneath
    s = run([detected("q3"), started("a3", "q3"), chunk("a3", "third")], s);
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a1");
    expect(s.currentAnswerId).toBe("a3");

    s = run([{ type: "local/view", answer_id: null }], s);
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a3");
  });

  it("a pin wins over browsing, and clear resets the view", () => {
    let s = run([detected("q1"), started("a1", "q1"), done("a1", "x"), detected("q2"), started("a2", "q2"), done("a2", "y")]);
    s = run([{ type: "local/view", answer_id: "a1" }, { type: "local/pin", answer_id: "a2", pinned: true }], s);
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a2");
    s = run([{ type: "local/clear" }], s);
    expect(s.viewedAnswerId).toBeNull();
  });
});

describe("usage status", () => {
  it("records the low-minutes warning and the limit", () => {
    let s = run([ev("usage.status", { minutes_remaining: 4.6, limit_reached: false })]);
    expect(s.usage).toEqual({ minutesRemaining: 4.6, limitReached: false, reason: "monthly" }); // older servers: no reason
    s = run([ev("usage.status", { minutes_remaining: 0, limit_reached: true })], s);
    expect(s.usage?.limitReached).toBe(true);
  });

  it("keeps which limit it was (this session's maximum length vs the month)", () => {
    const s = run([ev("usage.status", { minutes_remaining: 3, limit_reached: false, reason: "session" })]);
    expect(s.usage).toEqual({ minutesRemaining: 3, limitReached: false, reason: "session" });
  });
});

describe("mock interview", () => {
  it("tracks the interviewer's current question and completion", () => {
    let s = run([ev("mock.question", { question_id: "m1", text: "Tell me about yourself.", is_follow_up: false, index: 1, total: 4 })]);
    expect(s.mock).toEqual({ questionId: "m1", text: "Tell me about yourself.", isFollowUp: false, index: 1, total: 4 });
    s = run([ev("mock.question", { question_id: "m2", text: "What was the hardest part?", is_follow_up: true, index: 1, total: 4 })], s);
    expect(s.mock?.isFollowUp).toBe(true);
    s = run([ev("mock.completed", { questions: 2 })], s);
    expect(s.mockCompleted).toBe(true);
  });
});
