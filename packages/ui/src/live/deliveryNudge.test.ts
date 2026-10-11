import { describe, expect, it } from "vitest";
import { currentRun, nudgeFor } from "./deliveryNudge";
import type { TurnView } from "./reducer";

const turn = (turn_id: string, speaker: TurnView["speaker"], text: string, start: number | null, end: number | null, echo = false): TurnView => ({
  turn_id, speaker, text, final: end !== null, start_ms: start, end_ms: end, ...(echo ? { echo: true } : {}),
});

const live = (turns: TurnView[]) => ({
  turnOrder: turns.map((t) => t.turn_id),
  turns: Object.fromEntries(turns.map((t) => [t.turn_id, t])),
});

const words = (n: number, filler = "") => Array.from({ length: n }, (_, i) => (filler && i % 10 === 0 ? filler : "word")).join(" ");

describe("delivery nudges", () => {
  it("reads the answer as your words since the interviewer last spoke", () => {
    const run = currentRun(live([
      turn("a", "candidate", "an earlier answer", 0, 1000),
      turn("q", "interviewer", "Tell me about a project.", 2000, 4000),
      turn("b", "candidate", "I built the payments ledger", 5000, 9000),
      turn("e", "candidate", "tell me about a project", 9000, 9500, true),
      turn("c", "candidate", "um and it", 10_000, null),
    ]));
    expect(run).toEqual({ turnIds: ["b", "c"], words: 8, spanMs: 4000, fillers: 1 });
    expect(currentRun(live([turn("q", "interviewer", "Hi", 0, 1000)]))).toBeNull();
  });

  it("nudges an answer past two minutes to land the point", () => {
    const n = nudgeFor(currentRun(live([turn("b", "candidate", words(300), 0, 130_000)])));
    expect(n?.kind).toBe("long");
    expect(n?.text).toContain("2:10");
  });

  it("nudges a fast pace once there's enough speech to judge it", () => {
    expect(nudgeFor(currentRun(live([turn("b", "candidate", words(80), 0, 24_000)])))?.kind).toBe("fast"); // 200 wpm
    expect(nudgeFor(currentRun(live([turn("b", "candidate", words(40), 0, 12_000)])))).toBeNull(); // too little yet
    expect(nudgeFor(currentRun(live([turn("b", "candidate", words(60), 0, 25_000)])))).toBeNull(); // 144 wpm: fine
  });

  it("nudges a lot of filler words", () => {
    const n = nudgeFor(currentRun(live([turn("b", "candidate", words(60, "um"), 0, 30_000)]))); // 6 "um"s, 120 wpm
    expect(n?.kind).toBe("fillers");
    expect(nudgeFor(currentRun(live([turn("b", "candidate", words(30, "um"), 0, 30_000)])))).toBeNull(); // 3 only
  });

  it("says nothing before any finished turn has a time", () => {
    expect(nudgeFor(currentRun(live([turn("b", "candidate", words(500), null, null)])))).toBeNull();
  });
});
