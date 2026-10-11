import { describe, expect, it } from "vitest";
import { oneWayPhase } from "./oneWay";

describe("one-way interview clock", () => {
  it("thinks, then answers, then is over", () => {
    expect(oneWayPhase(0, 30, 90)).toEqual({ phase: "think", left: 30, progress: 0 });
    expect(oneWayPhase(29.2, 30, 90)).toMatchObject({ phase: "think", left: 1 });
    expect(oneWayPhase(30, 30, 90)).toEqual({ phase: "answer", left: 90, progress: 0 });
    expect(oneWayPhase(75, 30, 90)).toEqual({ phase: "answer", left: 45, progress: 0.5 });
    expect(oneWayPhase(120, 30, 90)).toEqual({ phase: "over", left: 0, progress: 1 });
  });

  it("goes straight to answering when there's no thinking time", () => {
    expect(oneWayPhase(0, 0, 60)).toEqual({ phase: "answer", left: 60, progress: 0 });
  });
});
