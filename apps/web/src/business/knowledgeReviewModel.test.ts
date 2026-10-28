import { describe, expect, it } from "vitest";
import type { BizKnowledgeReviewItem } from "@orbit/types";
import { filterReviews, nextReviewDate } from "./knowledgeReviewModel";
const row = (id: string, extra: Partial<BizKnowledgeReviewItem> = {}): BizKnowledgeReviewItem => ({ id, title: `Policy ${id}`, revision: 2, published_revision: 2, review_due: "2026-10-28", state: "due", owner_id: "owner", owner_name: "Owner", owner_available: true, reminders: false, reminded_at: null, has_draft_changes: false, ...extra });
describe("Business policy review queue", () => {
  it("filters ownership independently from status, search and unavailable owners", () => {
    const rows = [row("one"), row("two", { owner_id: "other", state: "needs_update" }), row("three", { owner_id: null, owner_available: false })];
    expect(filterReviews(rows, "all", "", true, "owner").map(r => r.id)).toEqual(["one"]);
    expect(filterReviews(rows, "needs_update", "", false, "owner").map(r => r.id)).toEqual(["two"]);
    expect(filterReviews(rows, "unassigned", "", false, "owner").map(r => r.id)).toEqual(["three"]);
    expect(filterReviews(rows, "due", "  Policy one  ", false, "owner").map(r => r.id)).toEqual(["one"]);
  });
  it("starts next-review scheduling from the server's UTC snapshot across year boundaries", () => {
    expect(nextReviewDate("2026-10-28")).toBe("2027-01-26");
    expect(nextReviewDate("2028-01-01")).toBe("2028-03-31");
  });
});
