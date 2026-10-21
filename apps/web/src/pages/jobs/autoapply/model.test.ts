import { describe, expect, it } from "vitest";
import { actionsFor, answerText, executorState, fromTri, minutesToTime, parseList, sendsItself, timeToMinutes, toTri } from "./model";

describe("Orbit Apply's helpers", () => {
  it("says whether the browser extension is applying", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(executorState(null, now)).toBe("never");
    expect(executorState("not a date", now)).toBe("never");
    expect(executorState("2026-10-19T11:00:00Z", now)).toBe("on");
    expect(executorState("2026-10-16T11:00:00Z", now)).toBe("quiet");
  });

  it("knows when nothing sends an approved application, so the candidate sends it from the kit", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(sendsItself({ execution: "hosted", hosted_enabled: true, executor_seen_at: null }, now)).toBe(true);
    expect(sendsItself({ execution: "browser", hosted_enabled: true, executor_seen_at: "2026-10-19T11:00:00Z" }, now)).toBe(true);
    expect(sendsItself({ execution: "browser", hosted_enabled: false, executor_seen_at: null }, now)).toBe(false);
    expect(sendsItself({ execution: "hosted", hosted_enabled: false, executor_seen_at: "2026-10-10T11:00:00Z" }, now)).toBe(false);
    expect(actionsFor("ready").finish).toBe(false);
    expect(actionsFor("ready", true).finish).toBe(true);
    expect(actionsFor("submitted", true).finish).toBe(false);
  });

  it("reads lists the way they're typed", () => {
    expect(parseList("Backend Engineer, SRE\n  backend engineer ,,Platform  Engineer")).toEqual([
      "Backend Engineer",
      "SRE",
      "Platform Engineer",
    ]);
    expect(parseList("  ")).toEqual([]);
  });

  it("keeps a question the candidate didn't answer unanswered", () => {
    expect(toTri(null)).toBe("");
    expect(fromTri("")).toBeNull();
    expect(fromTri(toTri(true))).toBe(true);
    expect(fromTri(toTri(false))).toBe(false);
  });

  it("turns quiet hours into time inputs and back", () => {
    expect(minutesToTime(22 * 60 + 5)).toBe("22:05");
    expect(timeToMinutes("07:30")).toBe(450);
    expect(timeToMinutes("25:00")).toBeNull();
  });

  it("offers only what each status allows", () => {
    expect(actionsFor("review")).toMatchObject({ approve: true, dontApply: true, retry: false });
    expect(actionsFor("handoff")).toMatchObject({ finish: true, retry: false });
    expect(actionsFor("submitted")).toEqual({ approve: false, dontApply: false, retry: false, finish: false });
    expect(answerText(["A", "B"])).toBe("A; B");
  });
});
