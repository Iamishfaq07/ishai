import type { WorkflowInboxItem } from "./workflowApi";

export type InboxSort = "due" | "requested" | "role";
export function pausedReview(row: WorkflowInboxItem, now: number): boolean {
  return row.snoozed_until !== null && Date.parse(row.snoozed_until) > now;
}

/** Applies only to the current API page. Never implies a complete company-wide queue or candidate ranking. */
export function visibleReviews(items: readonly WorkflowInboxItem[], query: string, jobId: string, sort: InboxSort): WorkflowInboxItem[] {
  const terms = query.slice(0, 120).toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(row => (!jobId || row.job_id === jobId)
    && terms.every(term => `${row.job_title} ${row.step_title}`.toLowerCase().includes(term)))
    .sort((a, b) => {
      const requested = a.requested_at.localeCompare(b.requested_at);
      return (sort === "role" ? a.job_title.localeCompare(b.job_title, undefined, { sensitivity: "base" })
        : sort === "requested" ? requested : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
        || requested || a.id.localeCompare(b.id);
    });
}
