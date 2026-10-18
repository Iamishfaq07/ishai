import { describe, expect, it } from "vitest";
import { actionsFor, answerText, fromTri, minutesToTime, parseList, timeToMinutes, toTri } from "./model";

describe("Orbit Apply's helpers", () => {
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
