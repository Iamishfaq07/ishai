import { describe, expect, it } from "vitest";
import { wordDiff } from "./InlineResumeDiff";
import { orbitalState } from "./OrbitalVisualizer";

describe("resume inline diff", () => {
  it("preserves both texts and identifies an added metric", () => {
    const before = "Improved API latency.";
    const after = "Reduced API latency by 40%.";
    const tokens = wordDiff(before, after);
    expect(tokens.filter((t) => t.kind !== "added").map((t) => t.text).join("")).toBe(before);
    expect(tokens.filter((t) => t.kind !== "removed").map((t) => t.text).join("")).toBe(after);
    expect(tokens.some((t) => t.kind === "added" && t.text.includes("40%"))).toBe(true);
  });
  it("keeps unchanged wording and safely bounds work on a large section", () => {
    expect(wordDiff("Kept text", "Kept text").every((t) => t.kind === "equal")).toBe(true);
    expect(wordDiff("word ".repeat(600), "new ".repeat(600))).toHaveLength(2);
  });
});
describe("orbital visual state", () => {
  it("maps the actual live engine states without treating reconnects as listening", () => {
    expect(orbitalState("generating")).toBe("thinking");
    expect(orbitalState("streaming")).toBe("streaming");
    expect(orbitalState("listening")).toBe("listening");
    expect(orbitalState("stt_reconnecting")).toBe("idle");
    expect(orbitalState("ended")).toBe("idle");
  });
});
