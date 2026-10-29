export interface BizExperiencePlan {
  goal: string; actions: string[]; status: "planned" | "active" | "done"; target_date: string; source_version?: string | null;
}
export interface BizExperienceDashboard {
  job: { id: string; title: string; status: string }; revision: number; enabled: boolean; stage_kinds: string[]; expiry_days: number;
  plan: Partial<BizExperiencePlan>; version: string; facts: Array<{ id: string; text: string }>;
  report: { status: "collecting" | "ready"; participants: number | null; batch_size: number; retention_days: number;
    scores: Array<{ id: string; label: string; mean: number; distribution: Record<string, number> }>;
    priorities: Array<{ id: string; label: string; count: number }> };
}
export interface BizExperienceBrief {
  version: string; source: "ai" | "mock"; facts: BizExperienceDashboard["facts"];
  tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }>;
}
export interface BizCandidateExperience {
  state: "available" | "submitted" | "removed" | "unavailable" | "declined"; notice: string; notice_version: string;
  questions: Record<string, string>; priorities: Record<string, string>; expires_at: string | null;
  response: { ratings: Record<string, number>; improvement: string } | null;
}
