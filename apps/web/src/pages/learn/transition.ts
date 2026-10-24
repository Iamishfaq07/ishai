export interface Requirement { id: string; requirement: string; evidence: string; nextAction: string; due: string; state: "missing" | "practising" | "demonstrated" }
export interface Transition { currentRole: string; targetRole: string; motivation: string; requirements: Requirement[] }
export const EMPTY_TRANSITION: Transition = { currentRole: "", targetRole: "", motivation: "", requirements: [] };
export function validTransition(v: unknown): v is Transition {
  if (!v || typeof v !== "object" || !("currentRole" in v) || typeof v.currentRole !== "string" || !("targetRole" in v) || typeof v.targetRole !== "string" || !("motivation" in v) || typeof v.motivation !== "string" || !("requirements" in v) || !Array.isArray(v.requirements)) return false;
  return v.requirements.every((r: unknown) => !!r && typeof r === "object" && ["id", "requirement", "evidence", "nextAction", "due"].every((k) => k in r && typeof (r as Record<string, unknown>)[k] === "string") && "state" in r && ["missing", "practising", "demonstrated"].includes(String(r.state)));
}
export const ROLE_STARTERS = {
  data: { title: "Data analyst", requirements: ["Define a business metric and its denominator", "Write reproducible SQL and check data quality", "Explain a recommendation and its uncertainty"] },
  backend: { title: "Backend developer", requirements: ["Design and validate an API contract", "Test retries, concurrency and failure recovery", "Explain a production tradeoff"] },
  support: { title: "Customer support specialist", requirements: ["Prioritize a customer queue", "Write accurate, empathetic responses", "Escalate with verification and clear follow-up"] },
} as const;
export function transitionPlanText(plan: Transition): string {
  return `Career transition plan\nFrom: ${plan.currentRole}\nTarget: ${plan.targetRole}\nWhy: ${plan.motivation}\n\nCandidate-recorded plan; evidence and readiness are not independently verified.\n\n${plan.requirements.map((r) => `Requirement: ${r.requirement}\nState: ${r.state}\nEvidence: ${r.evidence || "Not recorded"}\nNext action: ${r.nextAction || "Not planned"}\nDue: ${r.due || "Not set"}\n`).join("\n")}`;
}
export function weeklyActions(plan: Transition, today: string): Requirement[] {
  return plan.requirements.filter((r) => r.state !== "demonstrated" && r.nextAction.trim()).sort((a, b) => {
    const dateA = /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : "9999-12-31";
    const dateB = /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : "9999-12-31";
    return Number(dateB < today) - Number(dateA < today) || dateA.localeCompare(dateB);
  }).slice(0, 5);
}
