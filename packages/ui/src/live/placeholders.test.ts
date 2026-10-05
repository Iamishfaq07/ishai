import { describe, expect, it } from "vitest";
import { splitPlaceholders } from "./placeholders";

describe("splitPlaceholders", () => {
  it("separates fill-in prompts from spoken text", () => {
    expect(splitPlaceholders("Hardest part: [the pushback you got] and [how you won them over].")).toEqual([
      { kind: "text", text: "Hardest part: " },
      { kind: "fill", text: "the pushback you got" },
      { kind: "text", text: " and " },
      { kind: "fill", text: "how you won them over" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves text without placeholders alone, and ignores unclosed or empty brackets while streaming", () => {
    expect(splitPlaceholders("Use a hash map")).toEqual([{ kind: "text", text: "Use a hash map" }]);
    expect(splitPlaceholders("Hard part: [the push")).toEqual([{ kind: "text", text: "Hard part: [the push" }]);
    expect(splitPlaceholders("arr[i]")).toEqual([{ kind: "text", text: "arr[i]" }]);
  });

  it("keeps values and code in brackets as text (they used to show as fill-ins and be skipped by Read aloud)", () => {
    const line = "For nums [2, 7, 11, 15] and target 9, I return [0, 1].";
    expect(splitPlaceholders(line)).toEqual([{ kind: "text", text: line }]);
    for (const code of [
      "check nums[left] and dp[i][j]",
      'the result is ["eat", "tea"]',
      "a pair [true, false]",
      "then recurse on [mid+1]",
      "the window [i + 1]",
      "swap [left, right]",
      "an object [{ id: 1 }]",
      "it's [-1, 0]",
    ]) {
      expect(splitPlaceholders(code)).toEqual([{ kind: "text", text: code }]);
    }
  });

  it("still marks fill-ins that look a little like code", () => {
    const fills = (text: string) => splitPlaceholders(text).filter((p) => p.kind === "fill").map((p) => p.text);
    expect(fills("We cut latency by [X%] at [company].")).toEqual(["X%", "company"]);
    expect(fills("I had [5+ years of experience] on [team/project].")).toEqual(["5+ years of experience", "team/project"]);
    expect(fills("Tell them [your manager's name] and [metric, e.g. latency].")).toEqual(["your manager's name", "metric, e.g. latency"]);
  });
});
