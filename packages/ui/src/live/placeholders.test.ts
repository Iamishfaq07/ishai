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
});
