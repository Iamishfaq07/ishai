import { describe, expect, it } from "vitest";
import type { BizEvidenceCoverage, BizHiringPlan } from "@orbit/types";
import { clonePlan, coverageCount, feedbackStages, planPath, roomPath, SAMPLE_TEMPLATES, validateSample } from "./hiringModel";

describe("Hiring Studio evidence and navigation", () => {
  it("counts human observations and disagreement without inventing a winner", () => {
    const rows: BizEvidenceCoverage[] = [
      { criterion_id: "one", name: "Reasoning", observations: [], assessed: false, spread: 0 },
      { criterion_id: "two", name: "Reliability", observations: [], assessed: true, spread: 2 },
    ];
    expect(coverageCount(rows)).toEqual({ assessed: 1, total: 2, disagreements: 1 });
    expect(coverageCount([])).toEqual({ assessed: 0, total: 0, disagreements: 0 });
  });
  it("requires a solution and the candidate's reasoning", () => {
    expect(validateSample({ response: "too short", explanation: "too short", assistance: "ai" })).toContain("solution");
    expect(validateSample({ response: "A".repeat(40), explanation: "too short", assistance: "none" })).toContain("decisions");
    expect(validateSample({ response: "A".repeat(40), explanation: "B".repeat(30), assistance: "ai" })).toBeNull();
  });
  it("provides bounded two-part tasks for different roles", () => {
    expect(Object.keys(SAMPLE_TEMPLATES)).toEqual(["engineering", "support", "operations", "sales"]);
    for (const task of Object.values(SAMPLE_TEMPLATES)) {
      expect(task.brief.length).toBeGreaterThanOrEqual(40);
      expect(task.change_request.length).toBeGreaterThanOrEqual(20);
      expect(task.time_box_min).toBeLessThanOrEqual(30);
      expect(task.required).toBe(false);
    }
  });
  it("isolates editable plan copies and encodes route identifiers", () => {
    const plan: BizHiringPlan = { criteria: [], independent_feedback: true, candidate_intro: "Intro", work_sample: structuredClone(SAMPLE_TEMPLATES.engineering!), response_target_days: 3 };
    const draft = clonePlan(plan);
    draft.work_sample!.brief = "Changed draft";
    expect(plan.work_sample!.brief).not.toBe("Changed draft");
    expect(roomPath("a/b", "c d")).toBe("/business/app/a%2Fb/applications/c%20d/interview");
    expect(planPath("a/b", "c d")).toBe("/business/app/a%2Fb/jobs/c%20d/interview-plan");
  });
  it("keeps an interviewer's archived rounds available for their frozen drafts and addenda", () => {
    const plan: BizHiringPlan = { criteria: [], independent_feedback: true, candidate_intro: "Intro",
      work_sample: null, response_target_days: 3 };
    const options = feedbackStages({ plan: { job_id: "job", revision: 2, plan, updated_at: null },
      stages: [{ id: "round-one", name: "Technical conversation" }],
      feedback: [{ mine: true, stage_id: "round-one" }, { mine: true, stage_id: "removed-stage" },
        { mine: false, stage_id: "private-peer-round" }] });
    expect(options).toEqual([
      { id: "round-one", label: "Technical conversation · earlier plan" },
      { id: "removed-stage", label: "removed-stage · earlier plan" },
    ]);
  });
});
