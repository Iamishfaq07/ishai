import { describe, expect, it } from "vitest";
import { formatDuration, sessionKindLine, spokenTime, whenDue } from "./format";

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

describe("whenDue", () => {
  it("says when the next question comes back", () => {
    const now = new Date(2026, 9, 11, 15, 0);
    expect(whenDue(new Date(2026, 9, 11, 20, 0).toISOString(), now)).toBe("later today");
    expect(whenDue(new Date(2026, 9, 12, 9, 0).toISOString(), now)).toBe("tomorrow");
    expect(whenDue(new Date(2026, 9, 14, 9, 0).toISOString(), now)).toBe("in 3 days");
    expect(whenDue(new Date(2026, 9, 25, 9, 0).toISOString(), now)).toMatch(/^on /);
  });
});

describe("spokenTime", () => {
  it("says seconds for a short answer, not \"about 1 min\"", () => {
    expect(spokenTime(3)).toBe("a few seconds");
    expect(spokenTime(50)).toBe("about 20 seconds");
    expect(spokenTime(110)).toBe("about 45 seconds");
    expect(spokenTime(140)).toBe("about 1 min");
    expect(spokenTime(300)).toBe("about 2 min");
  });
});
