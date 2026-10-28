/** Internal headcount approvals. Cost envelopes never become public salary claims. */
export interface BizRequisitionIntake {
  title: string; department: string; reason: "growth" | "replacement" | "project"; positions: number;
  annual_budget_per_position: number | null; currency: string; target_date: string; location: string;
  workplace: "onsite" | "remote" | "hybrid"; business_case: string; outcomes: string; requirements: string[];
}
export type BizRequisitionState = "draft" | "pending" | "approved" | "converted" | "cancelled";
export type BizRequisitionAction = "submit" | "approve" | "request_changes" | "reopen" | "cancel" | "create_job";
export interface BizRequisition {
  id: string; requester_id: string; state: BizRequisitionState; revision: number; data: BizRequisitionIntake;
  approver_ids: string[]; approved_by: string[]; next_approver_id: string | null; job_id: string | null;
  can_edit: boolean; can_approve: boolean; can_manage: boolean; can_create_job: boolean;
  created_at: string; updated_at: string; history_truncated: boolean;
  history: Array<{ id: string; actor: string; action: string; revision: number; note: string; at: string;
    snapshot: { content: BizRequisitionIntake; approvers: string[] } | null }>;
}
export interface BizRequisitionList {
  items: BizRequisition[]; next_after: string | null; approvers: Array<{ id: string; name: string }>;
}
export type BizRequisitionReviewFocus = "intake" | "assessment" | "budget";
export interface BizRequisitionReview {
  focus: BizRequisitionReviewFocus;
  revision: number; source: "ai" | "mock"; source_version: string;
  facts: Array<{ id: string; text: string }>;
  tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }>;
}
