import type { BizKnowledgeReviewBrief, BizKnowledgeReviewInbox } from "@orbit/types";
import { api } from "../lib/api";
const path = (cid: string) => `/v1/business/companies/${encodeURIComponent(cid)}/knowledge-reviews`;
const post = (data: unknown) => ({ method: "POST", body: JSON.stringify(data) });
export const knowledgeReviews = {
  list: (cid: string) => api.call<BizKnowledgeReviewInbox>(path(cid)),
  assign: (cid: string, id: string, base_revision: number, owner_id: string | null, reminders: boolean, note: string) => api.call(`${path(cid)}/${encodeURIComponent(id)}/owner`, { method: "PUT", body: JSON.stringify({ base_revision, owner_id, reminders, note }) }),
  decide: (cid: string, id: string, base_revision: number, published_revision: number, action: "confirm" | "needs_update", note: string, next_review_date = "") => api.call(`${path(cid)}/${encodeURIComponent(id)}/decision`, post({ base_revision, published_revision, action, note, next_review_date })),
  brief: (cid: string, id: string, base_revision: number) => api.call<BizKnowledgeReviewBrief>(`${path(cid)}/${encodeURIComponent(id)}/brief`, post({ base_revision })),
  remind: (cid: string) => api.call<{ created: number; unavailable_owner: number }>(`${path(cid)}/reminders/run`, post({})),
};
