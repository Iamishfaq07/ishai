export interface BizWorkflowStep {
  approval?: boolean; id: string; title: string; instruction: string; days: number; depends_on: string[];
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
  reviews: { checkpoints: number; pending: number; changes_requested: number; overdue: number; snoozed: number };
  counts: { total: number; done: number; ready: number; blocked: number; overdue: number; unassigned: number };
  steps: Array<BizWorkflowStep & { review: BizWorkflowReview | null; state: "pending" | "done"; owner_id: string | null; owner_current: boolean;
    completed_by: string | null; completed_at: string | null; note: string; blocked: boolean; due_date: string; overdue: boolean; path: string }>;
}
export interface BizWorkflowDraft {
  plan: BizWorkflowPlan; sources: Array<{ step_id: string; fact_id: string; quote: string }>;
  version: string; source: "ai" | "mock";
}
export interface BizWorkflowBrief { version: string; source: "ai" | "mock";
  tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }> }

export interface BizWorkflowReview {
  id: string; fingerprint: string; status: "pending" | "approved" | "changes_requested";
  requested_at: string; reviewed_at: string | null; requester_id: string | null; reviewer_id: string | null;
  requester_name: string; reviewer_name: string; reviewer_current: boolean;
  request_note: string; response_note: string; valid: boolean; invalidated_at: string | null;
  due_date: string | null; overdue: boolean; reminders_enabled: boolean; snoozed_until: string | null;
  reminder_count: number; last_reminded_at: string | null; previous_review_id: string | null; handoff_note: string;
  can_manage_followup: boolean; invalidation_reason: string; can_decide: boolean; can_withdraw: boolean;
}
export interface BizWorkflowReviewHistory extends BizWorkflowReview {
  evidence: { playbook_title: string; plan_revision: number; start_date: string; checkpoint: BizWorkflowStep;
    checkpoint_owner_id: string | null; prerequisites: Array<{ step: BizWorkflowStep; record: { state: string;
      owner_id: string | null; note: string; completed_at: string | null; completed_by: string | null } }> };
}
