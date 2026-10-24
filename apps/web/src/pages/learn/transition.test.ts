import { expect, it } from "vitest";
import { weeklyActions, validTransition, transitionPlanText, type Transition } from "./transition";

it("prioritizes overdue actions, excludes self-assessed completed requirements and caps the list", () => {
  const plan: Transition = { currentRole: "Support", targetRole: "Analyst", motivation: "Data work", requirements: [
    { id: "later", requirement: "SQL", evidence: "", state: "practising", nextAction: "Write query", due: "2026-11-01" },
    { id: "old", requirement: "Metrics", evidence: "", state: "missing", nextAction: "Define metric", due: "2026-10-01" },
    { id: "done", requirement: "Chart", evidence: "My synthetic chart", state: "demonstrated", nextAction: "Review", due: "2026-09-01" },
  ] };
  expect(weeklyActions(plan, "2026-10-24").map((r) => r.id)).toEqual(["old", "later"]);
  expect(transitionPlanText(plan)).toContain("not independently verified");
  expect(validTransition({ ...plan, requirements: [null] })).toBe(false);
  expect(validTransition(plan)).toBe(true);
});
