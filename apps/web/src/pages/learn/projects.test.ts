import { describe, expect, it } from "vitest";
import { projectNextSteps, reviewerWorksheet } from "./projects";

describe("project follow-through", () => {
  it("does not treat unrelated self-checks or whitespace as completed work", () => {
    const steps = projectNextSteps({ initial: " ", revision: "", reflection: "", checks: ["unrelated"] }, ["Actual test results"]);
    expect(steps.map((s) => s.id)).toEqual(["initial", "revision", "reflection", "rubric:Actual test results"]);
  });
  it("keeps missing reflection visible after implementation and self-review", () => {
    const work = { initial: "First solution", revision: "Changed solution", reflection: "", checks: ["Actual test results"] };
    expect(projectNextSteps(work, ["Actual test results"]).map((s) => s.id)).toEqual(["reflection"]);
    const worksheet = reviewerWorksheet("Synthetic API exercise", work, ["Actual test results"]);
    expect(worksheet).toContain("First solution");
    expect(worksheet).toContain("Supporting excerpt or observed result:");
    expect(worksheet).toContain("Verify authorship and execution separately.");
  });
});
