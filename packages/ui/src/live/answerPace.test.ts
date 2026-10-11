import { describe, expect, it } from "vitest";
import { answerBand, answerWords, bandLabel, clock, paceState } from "./answerPace";
import type { TurnView } from "./reducer";

const turn = (turn_id: string, speaker: TurnView["speaker"], text: string, echo = false): TurnView => ({
  turn_id, speaker, text, final: true, start_ms: null, end_ms: null, ...(echo ? { echo: true } : {}),
});

describe("answer pace", () => {
  it("gives each kind of question its usual length", () => {
    expect(answerBand({ isFollowUp: false, drillKind: null })).toEqual({ min: 45, max: 120 });
    expect(answerBand({ isFollowUp: false, drillKind: "prep" })).toEqual({ min: 45, max: 120 });
    expect(answerBand({ isFollowUp: true, drillKind: null })).toEqual({ min: 20, max: 90 });
    expect(answerBand({ isFollowUp: false, drillKind: "concise" })).toEqual({ min: 20, max: 45 });
  });

  it("reads an answer as warming up, a good length, or long", () => {
    const band = { min: 45, max: 120 };
    expect(paceState(10, band)).toBe("warming");
    expect(paceState(45, band)).toBe("good");
    expect(paceState(120, band)).toBe("good");
    expect(paceState(121, band)).toBe("long");
  });

  it("shows minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(75.9)).toBe("1:15");
    expect(clock(-3)).toBe("0:00");
    expect(bandLabel({ min: 45, max: 120 })).toBe("0:45–2:00");
  });

  it("counts the candidate's words since the question, leaving out the interviewer and echoes", () => {
    const turns = {
      a: turn("a", "candidate", "an earlier answer"),
      q: turn("q", "interviewer", "Tell me about yourself."),
      b: turn("b", "candidate", "I build  payment systems"),
      e: turn("e", "candidate", "tell me about yourself", true),
      c: turn("c", "candidate", "at a fintech"),
    };
    expect(answerWords({ turnOrder: ["a", "q", "b", "e", "c"], turns }, 1)).toBe(7);
    expect(answerWords({ turnOrder: ["a"], turns }, 1)).toBe(0);
  });
});
