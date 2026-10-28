import type { BizRequisition, BizRequisitionIntake, BizRequisitionState } from "@orbit/types";
export const REQUISITION_STATES: Record<BizRequisitionState, string> = {
  draft: "Draft", pending: "Awaiting approval", approved: "Approved", converted: "Job draft created", cancelled: "Cancelled",
};
export const EMPTY_INTAKE: BizRequisitionIntake = {
  title: "", department: "", reason: "growth", positions: 1, annual_budget_per_position: null, currency: "INR",
  target_date: "", location: "", workplace: "hybrid", business_case: "", outcomes: "", requirements: [],
};
export const changedIntake = (a: BizRequisitionIntake, b: BizRequisitionIntake) => JSON.stringify(a) !== JSON.stringify(b);
export const totalBudget = (d: BizRequisitionIntake) => d.annual_budget_per_position === null ? null : d.positions * d.annual_budget_per_position;
/** Totals cover loaded rows only; currencies stay separate and actual hiring spend is not inferred. */
export function requisitionTotals(rows: BizRequisition[]) {
  const approved = rows.filter(r => r.state === "approved");
  const budgets: Record<string, number> = {};
  for (const row of approved) { const total = totalBudget(row.data); if (total !== null) budgets[row.data.currency] = (budgets[row.data.currency] ?? 0) + total; }
  return { pending: rows.filter(r => r.state === "pending").length, positions: approved.reduce((sum, r) => sum + r.data.positions, 0), budgets };
}
