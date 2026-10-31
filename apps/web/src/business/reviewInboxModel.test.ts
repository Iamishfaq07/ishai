import { describe, expect, it } from "vitest";
import type { WorkflowInboxItem } from "./workflowApi";
import { pausedReview, visibleReviews } from "./reviewInboxModel";

const review = (id: string, extra: Partial<WorkflowInboxItem>): WorkflowInboxItem => ({ id, job_id: "job-a", job_title: "Platform engineer", run_id: "run-a", step_title: "Launch checkpoint", requested_at: "2026-10-28T10:00:00Z", due_date: null, overdue: false, snoozed_until: null, path: "/business/app/company/workflow-studio", ...extra });
const rows = [review("undated", {}), review("due", { due_date: "2026-10-30", overdue: true }), review("other", { job_id: "job-b", job_title: "Designer", due_date: "2026-11-02", requested_at: "2026-10-27T10:00:00Z" })];
describe("Review inbox local discovery", () => {
  it("orders undated work after due-dated work and preserves source rows", () => {
    expect(visibleReviews(rows, "", "", "due").map(row => row.id)).toEqual(["due", "other", "undated"]);
    expect(rows.map(row => row.id)).toEqual(["undated", "due", "other"]);
  });
  it("combines literal search terms with a specific loaded role", () => {
    expect(visibleReviews(rows, "  PLATFORM launch ", "job-a", "due").map(row => row.id)).toEqual(["due", "undated"]);
    expect(visibleReviews(rows, "%", "", "due")).toEqual([]);
    expect(visibleReviews(rows, "platform", "job-b", "due")).toEqual([]);
    expect(visibleReviews(rows, "", "missing", "due")).toEqual([]);
  });
  it("offers explicit request and role ordering without creating a company-wide list", () => {
    expect(visibleReviews(rows, "", "", "requested").map(row => row.id)).toEqual(["other", "due", "undated"]);
    expect(visibleReviews(rows, "", "", "role").map(row => row.id)).toEqual(["other", "due", "undated"]);
    expect(visibleReviews([], "", "", "due")).toEqual([]);
  });
  it("distinguishes expired, current and invalid pause timestamps", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(pausedReview(review("a", { snoozed_until: "2026-11-01T00:00:00Z" }), now)).toBe(true);
    for (const timestamp of [null, "invalid", "2026-10-31T00:00:00Z", "2026-10-31T12:00:00Z"]) expect(pausedReview(review("a", { snoozed_until: timestamp }), now)).toBe(false);
  });
});
