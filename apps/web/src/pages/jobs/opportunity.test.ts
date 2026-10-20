import { describe, expect, it } from "vitest";
import type { JobMission } from "@orbit/types";
import { opportunityStart, opportunityStep } from "./opportunity";

describe("guided opportunity routing", () => {
  it("opens the relevant work without treating navigation as completion", () => {
    expect(opportunityStart("saved", null)).toBe("resume");
    const mission = { resume: { id: "resume" }, snapshots: [] } as unknown as JobMission;
    expect(opportunityStart("saved", mission)).toBe("fit");
    expect(opportunityStart("applied", mission)).toBe("resume");
    expect(opportunityStart("interviewing", mission)).toBe("interview");
    for (const status of ["offer", "hired", "rejected", "withdrawn"]) expect(opportunityStart(status, mission)).toBe("offer");
    expect(opportunityStep("company")).toBe(1);
    expect(opportunityStep("practice")).toBe(3);
    expect(opportunityStep("plan")).toBe(3);
    expect(mission.snapshots).toEqual([]);
  });
});
