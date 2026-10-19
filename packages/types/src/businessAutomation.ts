/** Internal hiring operations. Tasks never make candidate decisions or send external messages. */
export interface BizAutomationRecipe {
  enabled: boolean; stalled_days: number | null; question_hours: number | null;
  feedback_hours: number | null; assessment_hours: number | null; default_assignee_id: string | null;
  scheduling_hours: number | null;
}
export interface BizAutomationRecord {
  revision: number; recipe: BizAutomationRecipe; last_run_at: string | null;
}
export interface BizAutomationJob extends BizAutomationRecord {
  job_id: string; title: string; status: string; owners: Array<{ id: string; name: string }>;
}
export interface BizHiringTask {
  id: string; application_id: string; job_id: string; job_title: string; name: string; reference: string;
  kind: string; title: string; status: "open" | "snoozed" | "done" | "resolved"; assignee_id: string | null;
  due_at: string; snoozed_until: string | null; revision: number; resolution: string | null; actionable: boolean;
}
export interface BizTaskQueue {
  items: BizHiringTask[]; next_after: string | null; counts: Record<string, number>; overdue: number; as_of: string;
}
export interface BizTaskAction {
  base_revision: number; action: "done" | "snooze" | "reopen" | "assign"; note: string;
  assignee_id?: string | null; until?: string;
}
export interface BizAutomationPreview { counts: Record<string, number>; total: number; description: string }
