import { describe, expect, it } from "vitest";
import { paceNote, rubricRows, splitPlaceholders, topPractice } from "./reviewText";

describe("the review's stronger answer", () => {
  it("marks the placeholders the candidate fills in", () => {
    expect(splitPlaceholders("I cut it by [the percentage] in [the year].")).toEqual([
      { text: "I cut it by ", placeholder: false },
      { text: "[the percentage]", placeholder: true },
      { text: " in ", placeholder: false },
      { text: "[the year]", placeholder: true },
      { text: ".", placeholder: false },
    ]);
    expect(splitPlaceholders("No gaps here.")).toEqual([{ text: "No gaps here.", placeholder: false }]);
    expect(splitPlaceholders("An unclosed [bracket stays text")).toEqual([{ text: "An unclosed [bracket stays text", placeholder: false }]);
  });
});

describe("the rubric and the top three", () => {
  it("shows the criteria that are there, in a fixed order", () => {
    const mark = { score: 4, reason: "r", quote: null };
    expect(rubricRows({ clarity: mark, structure: mark }).map(([label]) => label)).toEqual(["Structure", "Clarity"]);
    expect(rubricRows(undefined)).toEqual([]);
  });

  it("uses the ranked list, or an older review's practice suggestions", () => {
    expect(topPractice({ practice: ["a"], top_practice: [{ practice: "x", questions: [2] }] })).toEqual([{ practice: "x", questions: [2] }]);
    expect(topPractice({ practice: ["a", "b", "c", "d"] })).toEqual([
      { practice: "a", questions: [] },
      { practice: "b", questions: [] },
      { practice: "c", questions: [] },
    ]);
    expect(topPractice({ practice: [], top_practice: [] })).toEqual([]);
  });

  it("flags a pace outside the comfortable range", () => {
    expect([paceNote(190), paceNote(95), paceNote(140)]).toEqual(["fast", "slow", null]);
  });
});
