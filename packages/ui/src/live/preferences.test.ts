import { afterEach, describe, expect, it, vi } from "vitest";
import { loadResponseTiming, saveResponseTiming } from "./preferences";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("response timing preference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to balanced, round-trips, and ignores junk", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadResponseTiming()).toBe("balanced");
    saveResponseTiming("patient");
    expect(loadResponseTiming()).toBe("patient");
    localStorage.setItem("orbit.responseTiming", "whenever");
    expect(loadResponseTiming()).toBe("balanced");
  });

  it("works without storage (defaults, no throw)", () => {
    expect(loadResponseTiming()).toBe("balanced");
    expect(() => saveResponseTiming("quick")).not.toThrow();
  });
});
