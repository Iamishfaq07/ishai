import type { BizEvidenceCoverage, BizHiringPlan, BizHiringRoom, BizInterviewFeedback, BizSampleSubmission, BizWorkSampleSpec } from "@orbit/types";

export const roomPath = (cid: string, aid: string) => `/business/app/${encodeURIComponent(cid)}/applications/${encodeURIComponent(aid)}/interview`;
export const planPath = (cid: string, jid: string) => `/business/app/${encodeURIComponent(cid)}/jobs/${encodeURIComponent(jid)}/interview-plan`;
export const COVERAGE_WORDS = ["Not observed", "Needs support", "Developing", "Meets the bar", "Strong evidence"] as const;
export function coverageCount(rows: BizEvidenceCoverage[]) {
  return { assessed: rows.filter((row) => row.assessed).length, total: rows.length,
    disagreements: rows.filter((row) => row.spread >= 2).length };
}
export function feedbackStages(room: Pick<BizHiringRoom, "plan" | "stages"> & {
  feedback: Array<Pick<BizInterviewFeedback, "mine" | "stage_id">>;
}) {
  const current = new Set(room.plan.plan.criteria.map((c) => c.stage_id));
  const all = new Set([...current, ...room.feedback.filter((f) => f.mine).map((f) => f.stage_id)]);
  return [...all].map((id) => ({ id, label: (room.stages.find((s) => s.id === id)?.name ?? id)
    + (current.has(id) ? "" : " · earlier plan") }));
}
export function validateSample(input: BizSampleSubmission): string | null {
  if (input.response.trim().length < 40) return "Describe your solution in at least 40 characters.";
  if (input.explanation.trim().length < 30) return "Explain your own decisions in at least 30 characters.";
  return null;
}
export const SAMPLE_TEMPLATES: Record<string, BizWorkSampleSpec> = {
  engineering: {
    title: "Keep a small service reliable", time_box_min: 25, required: false,
    brief: "A service accepts customer orders and places them on a queue. Workers sometimes retry the same order. Sketch a small solution in code or plain language that prevents duplicate charges. Include the data you would store, a test for retries, and one limit of your approach. Use fictional data only; do not build a production application.",
    change_request: "The payment provider now times out after charging a customer. Show how you would change your solution to recover safely without charging twice. Explain one trade-off.",
    candidate_guidance: "Aim for 25 minutes. Notes, pseudocode and tools are welcome. Explain what you personally chose and disclose any assistance. Do not share an employer's confidential material.",
  },
  support: {
    title: "Handle a difficult customer hand-off", time_box_min: 20, required: false,
    brief: "Three fictional customers contact you at once: an account cannot sign in, an invoice appears twice, and a team requests a feature. Explain how you would prioritise them. Draft a short first reply for the duplicate invoice and a hand-off note for the next support agent. Do not promise a refund you have not verified.",
    change_request: "The customer shares evidence that both invoices were paid. Update your response and hand-off, including what you would verify before escalating.",
    candidate_guidance: "Use fictional names and data. You may use tools; explain the reasoning behind your priorities and disclose assistance. Keep the task to about 20 minutes.",
  },
  operations: {
    title: "Recover a disrupted hand-off", time_box_min: 20, required: false,
    brief: "A fictional warehouse expected 120 units, received 110, and has orders for 115. A delivery partner reports a delay. Write a concise action plan, identify the facts you need to verify, and draft a hand-off for the next shift. Explain how you would communicate uncertainty to customers.",
    change_request: "A recount finds another 8 units, but 5 are damaged. Revise the plan and identify one control that would prevent the same mismatch.",
    candidate_guidance: "Work with the fictional quantities given. Tools are welcome; explain your own assumptions and disclose assistance. About 20 minutes is enough.",
  },
  sales: {
    title: "Prepare an honest discovery call", time_box_min: 20, required: false,
    brief: "A fictional small business wants to replace manual onboarding but has not shared its budget or decision process. Draft five discovery questions, a concise opening message, and a next-step plan. Explain how you would establish whether your product is a fit without inventing capabilities or ROI.",
    change_request: "The prospect says a competitor already has approval and asks for an unsupported feature. Revise your next step and explain how you would handle the request honestly.",
    candidate_guidance: "Use fictional company details. You may use tools; disclose assistance and explain why you chose your questions. Keep this to about 20 minutes.",
  },
};
export function clonePlan(plan: BizHiringPlan): BizHiringPlan { return structuredClone(plan); }
