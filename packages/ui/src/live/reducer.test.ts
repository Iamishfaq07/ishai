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
  CONNECTION_LOST,
  SCREENSHOT_QUESTION,
  initialLiveState,
  liveReducer,
  selectAnswerHistory,
  selectAskAgain,
  selectDisplayedAnswer,
  selectDisplayedQuestion,
  selectLatestInterviewerTurn,
  selectLatestScreenshotQuestionId,
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

  it("a stopped answer stays on screen with what was written, and says why it stopped", () => {
    const s = run([
      detected("q1"),
      started("a1", "q1"),
      ev("answer.chunk", { answer_id: "a1", partial: answer(["half an answer"]) }),
      ev("answer.cancelled", { answer_id: "a1", reason: "stopped" }),
    ]);
    expect(s.answers.a1?.status).toBe("cancelled");
    expect(s.answers.a1?.cancel_reason).toBe("stopped");
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("a1");
    expect(selectDisplayedAnswer(s)?.has_content).toBe(true);
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

describe("chat replies", () => {
  const chatStarted = (answerId: string) =>
    ev("answer.started", {
      answer_id: answerId,
      question_id: null as unknown as string, // the server sends null: a chat reply answers no interviewer question
      length: "standard",
      reasoning: "light",
      source: "chat",
    });

  it("show what was asked in chat as their question, not the interviewer's previous one", () => {
    let s = run([
      detected("q1"),
      started("a1", "q1"),
      { type: "local/chat_sent", id: "u1", text: "Give me an example", ts: 1 },
      chatStarted("c1"),
    ]);
    expect(s.answers.c1?.prompt).toBe("Give me an example");
    expect(selectDisplayedAnswer(s)?.answer_id).toBe("c1");
    expect(selectDisplayedQuestion(s)).toMatchObject({ text: "Give me an example", source: "chat" });

    // The interviewer asks something new: it shows on top, as it does over any previous answer.
    s = run([detected("q2", "t2")], s);
    expect(selectDisplayedQuestion(s)?.question_id).toBe("q2");
    // Browsing back to the reply shows its message again.
    s = run([{ type: "local/view", answer_id: "c1" }], s);
    expect(selectDisplayedQuestion(s)).toMatchObject({ text: "Give me an example", source: "chat" });
  });

  it("are paired with their messages in order, even when two are sent before either reply starts", () => {
    const s = run([
      { type: "local/chat_sent", id: "u1", text: "first", ts: 1 },
      { type: "local/chat_sent", id: "u2", text: "second", ts: 2 },
      chatStarted("c1"),
      chatStarted("c1"), // a repeat changes nothing
      chatStarted("c2"),
    ]);
    expect([s.answers.c1?.prompt, s.answers.c2?.prompt]).toEqual(["first", "second"]);
    expect(s.pendingChat).toEqual([]);
  });

  it("are asked again by sending their message (Try again), not by re-asking the interviewer's question", () => {
    const s = run([
      detected("q1"),
      started("a1", "q1"),
      { type: "local/chat_sent", id: "u1", text: "Give me an example", ts: 1 },
      chatStarted("c1"),
    ]);
    expect(selectAskAgain(s, s.answers.c1 ?? null)).toEqual({ via: "chat", text: "Give me an example" });
    // The phone companion doesn't know what was typed: nothing to send.
    const companion = run([chatStarted("c9")]);
    expect(selectAskAgain(companion, companion.answers.c9 ?? null)).toBeNull();
  });
});

describe("a dropped connection", () => {
  const open = { type: "local/connection", status: "open" } as const;
  const drop = { type: "local/connection", status: "reconnecting", detail: "connection lost (1006)" } as const;

  it("fails the answers it was writing (Try again instead of “Thinking…” and a Stop that does nothing)", () => {
    const s = run([
      open,
      detected("q1"), started("a1", "q1"),
      ev("answer.completed", { answer_id: "a1", answer: answer(["done"]), latency: { first_token_ms: 1, total_ms: 2 } }),
      detected("q2", "t2"), started("a2", "q2"), ev("answer.chunk", { answer_id: "a2", partial: answer(["half"]) }),
      detected("q3", "t3"), started("a3", "q3"), // still thinking
      drop,
    ]);
    expect(s.answers.a1?.status).toBe("complete");
    expect(s.answers.a2).toMatchObject({ status: "failed", error: CONNECTION_LOST, has_content: true });
    expect(s.answers.a3).toMatchObject({ status: "failed", error: { retryable: true } });
    // Closing for good does the same.
    const closed = run([open, detected("q1"), started("a1", "q1"), { type: "local/connection", status: "closed" }]);
    expect(closed.answers.a1?.status).toBe("failed");
  });

  it("fails a chat reply that was streaming, which keeps its message for Try again", () => {
    const s = run([open, { type: "local/chat_sent", id: "u1", text: "Give me an example", ts: 1 }, started("c1", "q1", "chat"), drop]);
    expect(s.answers.c1).toMatchObject({ status: "failed", prompt: "Give me an example" });
  });

  it("marks a chat message whose reply hadn't started as lost, and still pairs a queued one after the reconnect", () => {
    let s = run([open, { type: "local/chat_sent", id: "u1", text: "sent, then the socket died", ts: 1 }, drop]);
    expect(s.chat[0]).toMatchObject({ kind: "user", lost: true });
    expect(s.pendingChat).toEqual([]);
    // Sent while reconnecting: the client queues it for the next connection, whose reply answers it.
    s = run([{ type: "local/chat_sent", id: "u2", text: "queued", ts: 2 }, open, started("c1", "q1", "chat")], s);
    expect(s.answers.c1?.prompt).toBe("queued");
    expect(s.chat[1]).not.toHaveProperty("lost");
  });
});

describe("asking an answer again", () => {
  const shot = (qid: string) =>
    ev("question.detected", { question_id: qid, turn_id: null, text: SCREENSHOT_QUESTION, type: "technical", confidence: 1, is_follow_up: false });
  const shotStarted = (answerId: string, qid: string) =>
    ev("answer.started", { answer_id: answerId, question_id: qid, length: "standard", reasoning: "light", source: "screenshot" });

  it("uses the answer's own question, even when a newer one is on the card", () => {
    const s = run([detected("q1"), started("a1", "q1"), detected("q2", "t2")]);
    expect(selectDisplayedQuestion(s)?.question_id).toBe("q2");
    expect(selectAskAgain(s, selectDisplayedAnswer(s))).toEqual({ via: "answer", text: "Question q1", screenshot: false });
  });

  it("asks the screenshot question for the newest screenshot only (the server keeps that image)", () => {
    let s = run([shot("s1"), shotStarted("a1", "s1")]);
    expect(selectLatestScreenshotQuestionId(s)).toBe("s1");
    expect(selectAskAgain(s, s.answers.a1 ?? null)).toEqual({ via: "answer", text: SCREENSHOT_QUESTION, screenshot: true });
    s = run([shot("s2"), shotStarted("a2", "s2")], s);
    expect(selectAskAgain(s, s.answers.a1 ?? null)).toBeNull();
    expect(selectAskAgain(s, s.answers.a2 ?? null)).toMatchObject({ text: SCREENSHOT_QUESTION });
  });

  it("leaves the question to the server when it isn't known here", () => {
    const s = run([ev("answer.chunk", { answer_id: "a9", partial: answer(["x"]) })]);
    expect(selectAskAgain(s, s.answers.a9 ?? null)).toEqual({ via: "answer", text: undefined, screenshot: false });
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

  it("keeps the settings this client asked for over the server's older echo", () => {
    // session.started goes out before the server reads session.start, with the session's saved settings and the
    // defaults for the rest (thinking, wait, code language).
    const serverDefaults = { auto_answer: true, length: "standard", style: "natural", thinking: "off", response_timing: "balanced" } as const;
    let s = initialLiveState({ auto_answer: true, length: "standard", style: "natural", thinking: "high", response_timing: "patient", coding_language: "java" });
    s = run([ev("session.started", { state: "listening", settings: serverDefaults })], s);
    expect(s.settings).toMatchObject({ thinking: "high", response_timing: "patient", coding_language: "java" });

    // Changes made during the session survive the next connection's echo too.
    s = run([{ type: "local/settings", settings: { auto_answer: false, length: "short", style: "concise" } }], s);
    s = run([ev("session.started", { state: "listening", settings: serverDefaults })], s);
    expect(s.settings).toMatchObject({ auto_answer: false, length: "short", style: "concise", thinking: "high" });
    expect(s.requestedSettings).toEqual({
      auto_answer: false, length: "short", style: "concise", thinking: "high", response_timing: "patient", coding_language: "java",
    });
  });

  it("uses the server's settings for anything this client never set (the phone companion sets nothing)", () => {
    const s = run([ev("session.started", { state: "listening", settings: { auto_answer: false, length: "detailed", style: "story" } })]);
    expect(s.settings).toMatchObject({ auto_answer: false, length: "detailed", style: "story" });
  });

  it("stays paused through a reconnect until the user resumes", () => {
    let s = run([
      ev("session.started", { state: "listening", settings: { auto_answer: true, length: "standard", style: "natural" } }),
      { type: "local/pause", paused: true },
    ]);
    expect(s.state).toBe("paused");
    // The new connection's engine starts unpaused: no "Listening" flash while the pause is re-sent.
    s = run([
      { type: "local/connection", status: "reconnecting" },
      { type: "local/connection", status: "open" },
      ev("session.started", { state: "listening", settings: { auto_answer: true, length: "standard", style: "natural" } }),
      ev("state.changed", { state: "listening" }),
    ], s);
    expect(s.state).toBe("paused");
    s = run([ev("session.paused", { state: "paused", settings: { auto_answer: true, length: "standard", style: "natural" } })], s);
    expect(s.userPaused).toBe(true);

    s = run([{ type: "local/pause", paused: false }], s);
    expect(s.state).toBe("listening");
    s = run([ev("state.changed", { state: "speech_detected" })], s);
    expect(s.state).toBe("speech_detected");
  });

  it("a chat reply written while paused doesn't make the UI look unpaused", () => {
    const s = run([
      ev("session.paused", { state: "paused", settings: { auto_answer: true, length: "standard", style: "natural" } }),
      ev("state.changed", { state: "generating" }),
      ev("state.changed", { state: "answer_complete" }),
    ]);
    expect(s.state).toBe("paused");
    expect(run([ev("state.changed", { state: "ended" })], s).state).toBe("ended");
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
  it("marks a salary-negotiation turn", () => {
    const s = run([ev("mock.question", { question_id: "n1", text: "We'd like to offer you $150k.", is_follow_up: false, index: 1, total: 5, negotiation: true })]);
    expect(s.mock?.negotiation).toBe(true);
  });

  it("tracks the interviewer's current question and completion", () => {
    let s = run([ev("mock.question", { question_id: "m1", text: "Tell me about yourself.", is_follow_up: false, index: 1, total: 4 })]);
    expect(s.mock).toEqual({ questionId: "m1", text: "Tell me about yourself.", isFollowUp: false, index: 1, total: 4, drillKind: null, negotiation: false });
    s = run([ev("mock.question", { question_id: "m2", text: "What was the hardest part?", is_follow_up: true, index: 1, total: 4 })], s);
    expect(s.mock?.isFollowUp).toBe(true);
    s = run([ev("mock.question", { question_id: "m3", text: "Short version.", is_follow_up: false, index: 2, total: 4, drill_kind: "concise" })], s);
    expect(s.mock?.drillKind).toBe("concise");
    s = run([ev("mock.completed", { questions: 3, answered: 2, unanswered: 1, follow_ups: 1, drill: true })], s);
    expect(s.mockCompleted).toBe(true);
    expect(s.mockSummary).toMatchObject({ answered: 2, unanswered: 1, drill: true });
  });
});
