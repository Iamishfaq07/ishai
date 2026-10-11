import { describe, expect, it } from "vitest";
import { formatDuration, sessionKindLine } from "./format";

describe("sessionKindLine", () => {
  it("skips the type when the title is the type (a session started without a name)", () => {
    expect(sessionKindLine({ title: "Phone / room audio", type: "phone" })).toBe("");
    expect(sessionKindLine({ title: "Interview — SDE II", type: "interview", role: "SDE II" })).toBe("");
  });

  it("keeps the type and role a custom title doesn't say", () => {
    expect(sessionKindLine({ title: "Google onsite", type: "interview", role: "SDE II" })).toBe("Interview · SDE II");
    expect(sessionKindLine({ title: "HackerRank round", type: "coding", role: null })).toBe("Coding interview");
    expect(sessionKindLine({ title: "SDE II at Swiggy", type: "interview", role: "sde ii" })).toBe("Interview");
  });
});

describe("formatDuration", () => {
  it("never says 0 min for a short session", () => {
    expect(formatDuration(25)).toBe("under a minute");
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(3720)).toBe("1 h 2 min");
    expect(formatDuration(null)).toBe("—");
  });
});
