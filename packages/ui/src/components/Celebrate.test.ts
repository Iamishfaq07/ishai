import { afterEach, describe, expect, it, vi } from "vitest";
import { celebrate, claimMilestone, hasCelebrated } from "./Celebrate";

function fakeStorage(fail = false): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (fail) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("milestones", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are claimed once per device and remembered in storage", () => {
    const storage = fakeStorage();
    expect(claimMilestone("first-mock", storage)).toBe(true);
    expect(claimMilestone("first-mock", storage)).toBe(false);
    expect(claimMilestone("first-applied", storage)).toBe(true);
    expect(JSON.parse(storage.getItem("orbit.celebrated") ?? "")).toEqual(["first-mock", "first-applied"]);
    expect(hasCelebrated("first-offer", storage)).toBe(false);
    // A later visit reads what an earlier one stored.
    const earlier = fakeStorage();
    earlier.setItem("orbit.celebrated", JSON.stringify(["first-offer"]));
    expect(hasCelebrated("first-offer", earlier)).toBe(true);
    expect(claimMilestone("first-offer", earlier)).toBe(false);
  });

  it("survive junk in storage and storage that refuses writes", () => {
    const junk = fakeStorage();
    junk.setItem("orbit.celebrated", "{oops");
    expect(claimMilestone("stories-6", junk)).toBe(true);
    const full = fakeStorage(true);
    expect(claimMilestone("first-interviewing", full)).toBe(true);
    expect(claimMilestone("first-interviewing", full)).toBe(false);
  });

  it("never celebrate during a live session", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("location", { pathname: "/live/abc" });
    expect(celebrate("first-ats-80", { message: "Your resume scores 82. Ready to apply?" })).toBe(false);
    expect(hasCelebrated("first-ats-80", localStorage)).toBe(false);
  });
});
