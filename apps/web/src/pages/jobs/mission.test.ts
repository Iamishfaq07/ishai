import { describe, expect, it, vi, afterEach } from "vitest";
import { MISSION_STAGES, isSnoozed, missionPath, requirementTone, snooze, stagesDone } from "./mission";

afterEach(() => vi.unstubAllGlobals());

describe("Job Mission Room model", () => {
  it("has six stages in the order a job is won, counted from records", () => {
    expect(MISSION_STAGES.map((s) => s.id)).toEqual(["discover", "prove", "prepare", "apply", "interview", "negotiate"]);
    expect(stagesDone({ stages: { discover: true, prove: true, prepare: false, apply: true, interview: false, negotiate: false } })).toBe(3);
    expect(missionPath("a b")).toBe("/jobs/mission/a%20b");
  });

  it("says a requirement's status in words, never colour alone", () => {
    expect(requirementTone("met")).toEqual({ label: "Shown", tone: "good" });
    expect(requirementTone("partial").label).toBe("Partly");
    expect(requirementTone("missing").label).toBe("Not shown");
  });

  it("snoozes one step for one job and one account, for three days", () => {
    const now = 1_000_000;
    snooze("u1", "job1", "fit", now);
    expect(isSnoozed("u1", "job1", "fit", now + 1000)).toBe(true);
    expect(isSnoozed("u1", "job1", "resume", now)).toBe(false); // a new step shows
    expect(isSnoozed("u2", "job1", "fit", now)).toBe(false); // another account on the same browser
    expect(isSnoozed("u1", "job2", "fit", now)).toBe(false);
    expect(isSnoozed("u1", "job1", "fit", now + 4 * 86_400_000)).toBe(false);
  });
});
