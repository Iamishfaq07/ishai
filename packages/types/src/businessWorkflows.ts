export interface BizWorkflowStep {
  id: string; title: string; instruction: string; days: number; depends_on: string[];
  workspace: "pipeline" | "interview-plan" | "hiring-desk" | "capacity" | "experience";
}
export interface BizWorkflowPlan { title: string; steps: BizWorkflowStep[] }
export interface BizWorkflowWorkspace {
  job: { id: string; title: string; status: string }; revision: number; version: string; plan: BizWorkflowPlan | null;
  owners: Array<{ id: string; name: string }>; facts: Array<{ id: string; text: string }>;
  runs: Array<{ id: string; title: string; status: string; revision: number; created_at: string }>;
}
export interface BizWorkflowRun {
  id: string; job_id: string; title: string; revision: number; version: string; status: "active" | "completed" | "cancelled";
  start_date: string; plan_revision: number; owners: BizWorkflowWorkspace["owners"]; facts: BizWorkflowWorkspace["facts"];
  counts: { total: number; done: number; ready: number; blocked: number; overdue: number; unassigned: number };
  steps: Array<BizWorkflowStep & { state: "pending" | "done"; owner_id: string | null; owner_current: boolean;
    completed_by: string | null; completed_at: string | null; note: string; blocked: boolean; due_date: string; overdue: boolean; path: string }>;
}
export interface BizWorkflowDraft {
  plan: BizWorkflowPlan; sources: Array<{ step_id: string; fact_id: string; quote: string }>;
  version: string; source: "ai" | "mock";
}
export interface BizWorkflowBrief { version: string; source: "ai" | "mock";
  tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }> }
