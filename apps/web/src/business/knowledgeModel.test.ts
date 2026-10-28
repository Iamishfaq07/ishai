import { describe, expect, it } from "vitest";
import type { BizKnowledgeAnswer, BizKnowledgeSummary } from "@orbit/types";
import { EMPTY_KNOWLEDGE, changedKnowledge, filterKnowledge, knowledgeAnswerText, questionKey } from "./knowledgeModel";
const row = (id: string, extra: Partial<BizKnowledgeSummary> = {}): BizKnowledgeSummary => ({ id, title: `Interview ${id}`, category: "interview", audience: "all_hiring", review_due: "", review_overdue: false, revision: 2, published_revision: 2, archived: false, has_draft_changes: false, updated_at: "2026-10-28T00:00:00Z", ...extra });
describe("Business knowledge views", () => {
  it("filters published, archived, overdue and private drafts independently", () => {
    const rows = [row("public"), row("draft", { published_revision: null, has_draft_changes: true }), row("old", { review_overdue: true }), row("archive", { archived: true })];
    expect(filterKnowledge(rows, "", "published").map(r => r.id)).toEqual(["public", "old"]);
    expect(filterKnowledge(rows, "", "drafts").map(r => r.id)).toEqual(["draft"]);
    expect(filterKnowledge(rows, "", "review").map(r => r.id)).toEqual(["old"]);
    expect(filterKnowledge(rows, "", "archived").map(r => r.id)).toEqual(["archive"]);
    expect(filterKnowledge(rows, "  Interview public  ", "all")).toHaveLength(1);
  });
  it("rejects a stale answer when the question, format, sources or selected documents changed", () => {
    const original = questionKey("How do we record feedback?", "answer", "v1", ["a", "b"]);
    expect(questionKey("How do we record feedback?", "answer", "v1", ["b", "a"])).toBe(original);
    expect(questionKey("How do we record feedback?", "checklist", "v1", ["a", "b"])).not.toBe(original);
    expect(questionKey("Another question?", "answer", "v1", ["a", "b"])).not.toBe(original);
    expect(questionKey("How do we record feedback?", "answer", "v2", ["a", "b"])).not.toBe(original);
    expect(questionKey("How do we record feedback?", "answer", "v1", ["a"])).not.toBe(original);
  });
  it("detects draft changes without mutating the saved publication", () => {
    const next = { ...EMPTY_KNOWLEDGE, audience: "coordinators" as const, body: "Draft text" };
    expect(changedKnowledge(next, EMPTY_KNOWLEDGE)).toBe(true);
    expect(EMPTY_KNOWLEDGE.body).toBe("");
  });
});

it("exports the question, source versions, reference IDs and exact quotes with working notes", () => {
  const answer: BizKnowledgeAnswer = { status: "answered", source: "mock", source_version: "snapshot", mode: "checklist", review_overdue: false,
    points: [{ passage_id: "doc:2:0", quote: "Record independent observations", text: "Record the observation before reading peer feedback." }],
    sources: [{ id: "doc:2:0", document_id: "doc", revision: 2, title: "Scorecards", text: "Record independent observations", offset: 0, review_overdue: false }] };
  const exported = knowledgeAnswerText("How do we record feedback?", answer);
  expect(exported).toContain("How do we record feedback?"); expect(exported).toContain("Source: Scorecards · version 2");
  expect(exported).toContain("Reference ID: doc"); expect(exported).toContain("Quote: Record independent observations");
});
