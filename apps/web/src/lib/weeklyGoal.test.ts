import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GOAL, goalState, loadGoal, loadWarmupLog, logWarmupAnswer, saveGoal, weekStart, weeklyCounts } from "./weeklyGoal";

const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime(); // a Wednesday, local time
const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** `n` practice times in the week `back` weeks ago (Tuesday of it). */
const inWeek = (back: number, n: number) => Array.from({ length: n }, (_, i) => weekStart(NOW) - back * WEEK + DAY + i * 60_000);

describe("weeks", () => {
  it("start on Monday at midnight, local time", () => {
    const start = new Date(weekStart(NOW));
    expect(start.getDay()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(NOW - start.getTime()).toBe(2 * DAY + 12 * 3600_000);
    expect(weekStart(start.getTime())).toBe(start.getTime());
  });

  it("count practice per week, this week first, ignoring the future", () => {
    const counts = weeklyCounts([...inWeek(0, 2), ...inWeek(1, 1), ...inWeek(3, 4), NOW + DAY], NOW, 5);
    expect(counts).toEqual([2, 1, 0, 4, 0]);
  });
});

describe("the weekly goal", () => {
  it("starts at nothing, with a freeze ready", () => {
    expect(goalState([], 3, NOW)).toEqual({ goal: 3, done: 0, met: false, weeks: 0, freezeReady: true, frozeLastWeek: false, daysLeft: 5 });
  });

  it("counts weeks in a row, this week once it's met", () => {
    const run = [...inWeek(3, 3), ...inWeek(2, 4), ...inWeek(1, 3)];
    expect(goalState([...run, ...inWeek(0, 1)], 3, NOW)).toMatchObject({ done: 1, met: false, weeks: 3 }); // still going
    expect(goalState([...run, ...inWeek(0, 3)], 3, NOW)).toMatchObject({ done: 3, met: true, weeks: 4 });
  });

  it("lets one missed week go with the freeze, but not two in a row", () => {
    const missedLast = [...inWeek(3, 3), ...inWeek(2, 3), ...inWeek(1, 1)];
    expect(goalState(missedLast, 3, NOW)).toMatchObject({ weeks: 2, freezeReady: false, frozeLastWeek: true });
    const missedTwo = [...inWeek(4, 3), ...inWeek(3, 3), ...inWeek(2, 0), ...inWeek(1, 0)];
    expect(goalState(missedTwo, 3, NOW)).toMatchObject({ weeks: 0, frozeLastWeek: false });
    // Before any run there's nothing to keep: a quiet week is just a quiet week.
    expect(goalState(inWeek(5, 1), 3, NOW)).toMatchObject({ weeks: 0, freezeReady: true });
  });

  it("earns the freeze back after four met weeks", () => {
    const times = [...inWeek(7, 2), ...inWeek(6, 1), ...[5, 4, 3, 2].flatMap((w) => inWeek(w, 2)), ...inWeek(1, 0)];
    // week 7 met, 6 missed (frozen), 5-2 met (freeze back), 1 missed (frozen again): the run is 5.
    expect(goalState(times, 2, NOW)).toMatchObject({ weeks: 5, frozeLastWeek: true, freezeReady: false });
  });
});

describe("what's kept in this browser", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the goal, falling back to the default for anything odd", () => {
    expect(loadGoal()).toBe(DEFAULT_GOAL);
    saveGoal(5);
    expect(loadGoal()).toBe(5);
    store.set("orbit.practiceGoal.guest", "42");
    expect(loadGoal()).toBe(DEFAULT_GOAL);
    store.set("orbit.practiceGoal.guest", "{oops");
    expect(loadGoal()).toBe(DEFAULT_GOAL);
    saveGoal(7, "u1");
    expect(loadGoal("u1")).toBe(7);
    expect(loadGoal("u2")).toBe(DEFAULT_GOAL);
  });

  it("logs warm-up answers as times only, the latest 200", () => {
    for (let i = 0; i < 205; i++) logWarmupAnswer(NOW + i);
    const log = loadWarmupLog();
    expect(log).toHaveLength(200);
    expect(log[0]).toBe(NOW + 5);
    store.set("orbit.warmupLog.guest", JSON.stringify(["x", 1, null]));
    expect(loadWarmupLog()).toEqual([1]);
    logWarmupAnswer(9, "u1");
    expect(loadWarmupLog("u1")).toEqual([9]);
    expect(loadWarmupLog("u2")).toEqual([]);
  });
});
