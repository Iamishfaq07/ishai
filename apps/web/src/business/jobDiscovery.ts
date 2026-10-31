import type { BizJobListItem, BizJobStatus } from "@orbit/types";

export const JOB_STATUSES = ["all", "open", "draft", "paused", "closed"] as const;
export type JobStatusFilter = typeof JOB_STATUSES[number];
export const JOB_SORTS = ["updated", "new", "applicants", "title"] as const;
export interface JobsView { status: JobStatusFilter; query: string; sort: typeof JOB_SORTS[number]; display: "cards" | "table"; newOnly: boolean }

export function readJobsView(params: URLSearchParams): JobsView {
  const status = params.get("status"); const sort = params.get("sort");
  return {
    status: JOB_STATUSES.find(value => value === status) ?? "all",
    query: (params.get("q") ?? "").slice(0, 120),
    sort: JOB_SORTS.find(value => value === sort) ?? "updated",
    display: params.get("display") === "table" ? "table" : "cards",
    newOnly: params.get("new") === "1",
  };
}

export function discoverJobs(jobs: readonly BizJobListItem[], view: JobsView): BizJobListItem[] {
  const terms = view.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const updated = (job: BizJobListItem) => { const value = Date.parse(job.updated_at); return Number.isNaN(value) ? 0 : value; };
  return jobs.filter(job => (view.status === "all" || job.status === view.status)
    && (!view.newOnly || job.new_applicants > 0)
    && terms.every(term => `${job.title} ${job.department} ${job.locations.join(" ")} ${job.workplace}`.toLowerCase().includes(term)))
    .sort((a, b) => {
      const primary = view.sort === "title" ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        : view.sort === "new" ? b.new_applicants - a.new_applicants
        : view.sort === "applicants" ? b.applicants - a.applicants : updated(b) - updated(a);
      return primary || updated(b) - updated(a) || a.id.localeCompare(b.id);
    });
}

export function jobStatusCounts(jobs: readonly BizJobListItem[]): Record<JobStatusFilter, number> {
  const counts: Record<JobStatusFilter, number> = { all: jobs.length, open: 0, draft: 0, paused: 0, closed: 0 };
  for (const job of jobs) counts[job.status as BizJobStatus] += 1;
  return counts;
}
