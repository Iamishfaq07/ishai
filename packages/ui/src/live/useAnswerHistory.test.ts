import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  emptyLiveAnswer,
  type ServerEvent,
  type ServerEventMap,
  type ServerEventType,
} from "@orbit/types";
import { initialLiveState, liveReducer, type LiveAction, type LiveViewState } from "./reducer";
import { answerHistoryNav, historyLabel, stepTarget } from "./useAnswerHistory";

let seq = 0;
function ev<K extends ServerEventType>(type: K, data: ServerEventMap[K]): ServerEvent {
  seq += 1;
  return { v: PROTOCOL_VERSION, type, seq, ts: seq, data } as ServerEvent;
}
const run = (actions: LiveAction[], start: LiveViewState = initialLiveState()) => actions.reduce(liveReducer, start);

/** Question + answer `n`, finished. */
function answered(n: number): LiveAction[] {
  return [
    ev("question.detected", { question_id: `q${n}`, turn_id: `t${n}`, text: `Question ${n}`, type: "behavioral", confidence: 1, is_follow_up: false }),
    ev("answer.started", { answer_id: `a${n}`, question_id: `q${n}`, length: "standard", reasoning: "light", source: "auto" }),
    ev("answer.completed", { answer_id: `a${n}`, answer: { ...emptyLiveAnswer(), direct_answer: `Answer ${n}` }, latency: { first_token_ms: 1, total_ms: 2 } }),
  ];
}
const three = () => run([...answered(1), ...answered(2), ...answered(3)]);

/** Press ‹ (-1) or › (+1) the way the strip does. */
function step(s: LiveViewState, delta: number): LiveViewState {
  const to = stepTarget(answerHistoryNav(s), delta);
  return to === undefined ? s : liveReducer(s, { type: "local/view", answer_id: to });
}
const shownId = (s: LiveViewState) => (s.pinnedAnswerId ?? s.viewedAnswerId ?? s.currentAnswerId);

describe("answer history", () => {
  it("flips back and forth, and the newest entry is live", () => {
    let s = three();
    expect(historyLabel(answerHistoryNav(s))).toBe("3 of 3");
    s = step(s, -1);
    expect([shownId(s), historyLabel(answerHistoryNav(s))]).toEqual(["a2", "2 of 3"]);
    s = step(s, 1);
    expect(s.viewedAnswerId).toBeNull(); // back on live
    expect(answerHistoryNav(s).canNext).toBe(false);
  });

  it("after Clear: no number over the empty card, ‹ reaches the last answer, › comes back", () => {
    let s = run([{ type: "local/clear" }], three());
    let nav = answerHistoryNav(s);
    expect(historyLabel(nav)).toBe("3 earlier answers");
    expect(nav.liveIndex).toBe(3);
    s = step(s, -1);
    expect([shownId(s), historyLabel(answerHistoryNav(s))]).toEqual(["a3", "3 of 3"]);
    s = step(s, -1);
    expect(shownId(s)).toBe("a2");
    s = step(step(s, 1), 1);
    expect(s.viewedAnswerId).toBeNull();
    nav = answerHistoryNav(s);
    expect(nav.position).toBeNull();
  });

  it("while the newest answer is still thinking, ‹ goes to the one before it (it used to skip it)", () => {
    let s = run([
      ev("question.detected", { question_id: "q4", turn_id: "t4", text: "Question 4", type: "behavioral", confidence: 1, is_follow_up: false }),
      ev("answer.started", { answer_id: "a4", question_id: "q4", length: "standard", reasoning: "light", source: "auto" }),
    ], three());
    expect(historyLabel(answerHistoryNav(s))).toBe("4 of 4");
    s = step(s, -1);
    expect([shownId(s), historyLabel(answerHistoryNav(s))]).toEqual(["a3", "3 of 4"]);
    s = step(s, 1);
    expect(shownId(s)).toBe("a4");
  });

  it("a failed newest answer is the live position too", () => {
    let s = run([
      ev("question.detected", { question_id: "q4", turn_id: "t4", text: "Question 4", type: "behavioral", confidence: 1, is_follow_up: false }),
      ev("answer.started", { answer_id: "a4", question_id: "q4", length: "standard", reasoning: "light", source: "auto" }),
      ev("answer.failed", { answer_id: "a4", error: { code: "timeout", message: "That took too long.", retryable: true } }),
    ], three());
    s = step(s, -1);
    expect(shownId(s)).toBe("a3");
  });

  it("says “new answer” only when one arrived since browsing began", () => {
    let s = step(three(), -1);
    expect(answerHistoryNav(s)).toMatchObject({ browsing: true, newAnswer: false });
    s = step(s, -1); // still the same browse
    expect(answerHistoryNav(s).newAnswer).toBe(false);
    s = run(answered(4), s);
    expect(answerHistoryNav(s).newAnswer).toBe(true);
  });

  it("doesn't move while an answer is pinned", () => {
    const s = run([{ type: "local/pin", answer_id: "a2", pinned: true }], three());
    expect(stepTarget(answerHistoryNav(s), -1)).toBeUndefined();
    expect(stepTarget(answerHistoryNav(s), 1)).toBeUndefined();
  });
});
