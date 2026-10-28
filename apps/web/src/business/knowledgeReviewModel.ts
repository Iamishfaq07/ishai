import type { BizKnowledgeReviewItem } from "@orbit/types";
export const REVIEW_LABELS = { needs_update: "Updates requested", due: "Review due", soon: "Due within 14 days", scheduled: "Scheduled", unscheduled: "No review date" } as const;
export function filterReviews(rows: BizKnowledgeReviewItem[], status: string, query: string, mine: boolean, userId: string) {
  const term = query.trim().toLowerCase();
  return rows.filter(r => (!mine || r.owner_id === userId) && (!term || r.title.toLowerCase().includes(term)) &&
    (status === "all" || status === "unassigned" && !r.owner_available || r.state === status));
}
export function nextReviewDate(today: string): string {
  const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 90); return date.toISOString().slice(0, 10);
}
