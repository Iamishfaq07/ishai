import { describe, expect, it } from "vitest";
import type { BizRequisition } from "@orbit/types";
import { EMPTY_INTAKE, changedIntake, requisitionTotals, totalBudget } from "./requisitionModel";

describe("Business headcount planning", () => {
  it("keeps cost envelopes distinct from unknown budgets", () => {
    expect(totalBudget(EMPTY_INTAKE)).toBeNull();
    expect(totalBudget({ ...EMPTY_INTAKE, positions: 3, annual_budget_per_position: 120000 })).toBe(360000);
    expect(totalBudget({ ...EMPTY_INTAKE, annual_budget_per_position: 0 })).toBe(0);
  });
  it("counts only approved unconverted positions and never combines currencies", () => {
    const row = (state: BizRequisition["state"], currency: string, positions: number, amount: number) => ({ state, data: { ...EMPTY_INTAKE, currency, positions, annual_budget_per_position: amount } }) as BizRequisition;
    const totals = requisitionTotals([row("approved", "INR", 2, 100), row("approved", "USD", 1, 200), row("pending", "INR", 10, 100), row("converted", "USD", 5, 200)]);
    expect(totals).toEqual({ pending: 1, positions: 3, budgets: { INR: 200, USD: 200 } });
  });
  it("detects changed requirements and preserves the original intake", () => {
    const saved = { ...EMPTY_INTAKE, requirements: ["Customer onboarding"] };
    const edit = { ...saved, requirements: [...saved.requirements, "SQL"] };
    expect(changedIntake(saved, edit)).toBe(true);
    expect(saved.requirements).toEqual(["Customer onboarding"]);
    expect(changedIntake(saved, { ...saved })).toBe(false);
  });
});
