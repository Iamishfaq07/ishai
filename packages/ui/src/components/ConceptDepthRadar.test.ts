import { describe, expect, it } from "vitest";
import type { DebriefItem } from "@orbit/types";
import { aggregateDepth } from "./ConceptDepthRadar";

describe("concept depth assessments", () => {
  it("uses the latest retry per question and leaves unassessed dimensions empty", () => {
    const items = [
      { dimensions: { technical_depth: 2 }, attempts: [{ dimensions: { technical_depth: 3 } }, { dimensions: { technical_depth: 5 } }] },
      { dimensions: { technical_depth: 3, scalability: null }, attempts: [] },
      { dimensions: { technical_depth: Number.NaN, scalability: 9 }, attempts: [] },
    ] as unknown as DebriefItem[];
    const scores = aggregateDepth(items);
    expect(scores.technical_depth).toBe(4);
    expect(scores.scalability).toBeNull();
    expect(scores.communication_clarity).toBeNull();
  });
  it("never invents radar values for an empty report", () => {
    expect(Object.values(aggregateDepth([]))).toEqual([null, null, null, null, null]);
  });
});
