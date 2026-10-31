import { describe, expect, it } from "vitest";
import type { BizJobListItem } from "@orbit/types";
import { discoverJobs, jobStatusCounts, readJobsView } from "./jobDiscovery";

const job = (id: string, extra: Partial<BizJobListItem>): BizJobListItem => ({ id, slug: id, title: "Engineer", status: "draft", department: "Platform", locations: ["Bengaluru"], workplace: "remote", published_at: null, updated_at: "2026-10-30T12:00:00Z", applicants: 0, new_applicants: 0, public_url: "", ...extra });
const jobs = [job("a", { title: "API engineer", status: "open", applicants: 8, new_applicants: 2 }), job("b", { title: "Designer", department: "Product", locations: ["London"], new_applicants: 1 }), job("c", { title: "API lead", status: "closed", updated_at: "2026-10-31T12:00:00Z", applicants: 10 })];

describe("Business job discovery", () => {
  it("bounds URL input and safely defaults malformed view values", () => {
    expect(readJobsView(new URLSearchParams("status=__proto__&sort=no&display=bad&new=yes"))).toEqual({ status: "all", query: "", sort: "updated", display: "cards", newOnly: false });
    expect(readJobsView(new URLSearchParams({ q: "x".repeat(1000) })).query).toHaveLength(120);
  });
  it("combines all terms, status and the new-applicant filter", () => {
    const view = readJobsView(new URLSearchParams("q=API+BENGALURU&status=open&new=1"));
    expect(discoverJobs(jobs, view).map(item => item.id)).toEqual(["a"]);
    expect(discoverJobs(jobs, { ...view, query: "%" })).toEqual([]);
    expect(discoverJobs(jobs, { ...view, status: "closed" })).toEqual([]);
  });
  it("orders consistently without mutating the source or changing role status", () => {
    const view = readJobsView(new URLSearchParams());
    expect(discoverJobs(jobs, view).map(item => item.id)).toEqual(["c", "a", "b"]);
    expect(discoverJobs(jobs, { ...view, sort: "applicants" }).map(item => item.id)).toEqual(["c", "a", "b"]);
    expect(discoverJobs(jobs, { ...view, sort: "new" }).map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(discoverJobs(jobs, { ...view, sort: "title" }).map(item => item.id)).toEqual(["a", "c", "b"]);
    expect(jobs.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(jobs[0]!.status).toBe("open");
  });
  it("counts only the supplied accessible list and handles invalid dates deterministically", () => {
    expect(jobStatusCounts(jobs)).toEqual({ all: 3, open: 1, draft: 1, paused: 0, closed: 1 });
    const empty = readJobsView(new URLSearchParams());
    expect(discoverJobs([job("z", { updated_at: "invalid" }), jobs[0]!], empty).map(item => item.id)).toEqual(["a", "z"]);
    expect(jobStatusCounts([]).all).toBe(0);
  });
});
