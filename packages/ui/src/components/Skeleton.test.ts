import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoadPhase, type LoadPhase } from "./Skeleton";

function setup(timing?: { delay?: number; minimum?: number }) {
  const seen: LoadPhase[] = [];
  const c = createLoadPhase((p) => seen.push(p), timing);
  return { c, seen };
}

describe("skeleton timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never shows a placeholder for a load under 150 ms", () => {
    const { c, seen } = setup();
    c.update(true);
    vi.advanceTimersByTime(149);
    c.update(false);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(["pending", "done"]);
  });

  it("shows it at 150 ms and keeps it at least 300 ms", () => {
    const { c, seen } = setup();
    c.update(true);
    vi.advanceTimersByTime(150);
    expect(c.phase()).toBe("skeleton");
    vi.advanceTimersByTime(50);
    c.update(false);
    expect(c.phase()).toBe("skeleton");
    vi.advanceTimersByTime(249);
    expect(c.phase()).toBe("skeleton");
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["pending", "skeleton", "done"]);
  });

  it("hides it as soon as a long load ends", () => {
    const { c, seen } = setup();
    c.update(true);
    vi.advanceTimersByTime(2000);
    c.update(false);
    expect(seen).toEqual(["pending", "skeleton", "done"]);
  });

  it("keeps a shown placeholder up when loading starts again during its minimum", () => {
    const { c, seen } = setup();
    c.update(true);
    vi.advanceTimersByTime(200);
    c.update(false);
    vi.advanceTimersByTime(100);
    c.update(true);
    vi.advanceTimersByTime(1000);
    expect(c.phase()).toBe("skeleton");
    c.update(false);
    expect(seen).toEqual(["pending", "skeleton", "done"]);
  });

  it("takes its own delay and minimum, and stops its timers when disposed", () => {
    const { c, seen } = setup({ delay: 0, minimum: 500 });
    c.update(true);
    vi.advanceTimersByTime(0);
    c.update(false);
    vi.advanceTimersByTime(499);
    expect(c.phase()).toBe("skeleton");
    c.dispose();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(["pending", "skeleton"]);
  });

  it("ignores repeats", () => {
    const { c, seen } = setup();
    c.update(false);
    c.update(true);
    c.update(true);
    vi.advanceTimersByTime(150);
    expect(seen).toEqual(["pending", "skeleton"]);
  });
});
