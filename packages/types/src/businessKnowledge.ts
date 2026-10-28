/** Business-owned reference material, never applicant documents. */
export interface BizKnowledgeContent {
  title: string; body: string; category: "policy" | "interview" | "onboarding" | "operations";
  audience: "all_hiring" | "coordinators"; review_due: string;
}
export interface BizKnowledgeSummary {
  id: string; title: string; category: BizKnowledgeContent["category"]; audience: BizKnowledgeContent["audience"];
  review_due: string; review_overdue: boolean; needs_update?: boolean; revision: number; published_revision: number | null;
  archived: boolean; has_draft_changes: boolean; updated_at: string;
}
export interface BizKnowledgeDocument extends BizKnowledgeSummary {
  data: BizKnowledgeContent; published: BizKnowledgeContent | null;
  history: Array<{ revision: number; actor: string; at: string }>; history_truncated?: boolean;
  events: Array<{ action: string; actor: string; revision: number; note: string; at: string }>; events_truncated?: boolean;
}
export interface BizKnowledgeLibrary {
  items: BizKnowledgeSummary[]; truncated: boolean; published_count: number; source_version: string; can_manage: boolean;
}
export interface BizKnowledgeAnswer {
  status: "answered" | "insufficient"; source: "ai" | "mock" | "none"; source_version: string;
  mode: "answer" | "checklist"; review_overdue: boolean; needs_update?: boolean;
  points: Array<{ passage_id: string; quote: string; text: string }>;
  sources: Array<{ id: string; document_id: string; revision: number; title: string; text: string; offset: number; review_overdue: boolean; needs_update?: boolean }>;
}

export interface BizKnowledgeReviewItem {
  id: string; title: string; revision: number; published_revision: number; review_due: string;
  state: "needs_update" | "due" | "soon" | "scheduled" | "unscheduled"; owner_id: string | null;
  owner_name: string | null; owner_available: boolean; reminders: boolean; reminded_at: string | null;
  has_draft_changes: boolean;
}
export interface BizKnowledgeReviewInbox {
  items: BizKnowledgeReviewItem[]; owners: Array<{ id: string; name: string }>; as_of: string; soon_days: number;
}
export interface BizKnowledgeReviewBrief {
  tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }>;
  facts: Array<{ id: string; text: string }>; revision: number; excerpts_truncated: boolean; source: "mock" | "ai";
}

export interface BizKnowledgeReadingItem {
  id: string; title: string; category: BizKnowledgeContent["category"]; audience: BizKnowledgeContent["audience"];
  published_revision: number; content_hash: string; review_overdue: boolean; needs_update: boolean;
  acknowledged: boolean; acknowledged_at: string | null; acknowledged_revision: number | null;
}
export interface BizKnowledgeReadingDocument extends BizKnowledgeReadingItem { data: BizKnowledgeContent }
export interface BizKnowledgeReadingList { items: BizKnowledgeReadingItem[]; can_manage: boolean }
export interface BizKnowledgeCoverageItem extends BizKnowledgeReadingItem { eligible: number; acknowledged_count: number; remaining: number }
export interface BizKnowledgeCoverage { items: BizKnowledgeCoverageItem[]; as_of: string }
export interface BizKnowledgeReaders {
  document: BizKnowledgeReadingItem; total: number; offset: number; limit: number;
  items: Array<{ id: string; name: string; role: string; acknowledged: boolean; acknowledged_at: string | null; acknowledged_revision: number | null }>;
}
export interface BizKnowledgeReadingGuide {
  tips: BizKnowledgeReviewBrief["tips"]; facts: BizKnowledgeReviewBrief["facts"]; source: "mock" | "ai";
  content_hash: string; published_revision: number; needs_update: boolean; review_overdue: boolean; excerpts_truncated: boolean;
}
