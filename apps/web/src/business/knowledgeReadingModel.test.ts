import { describe, expect, it } from "vitest";
import type { BizKnowledgeReadingItem } from "@orbit/types";
import { filterReading, readingDocumentId, readingEstimate, readingPassages, readingStatus } from "./knowledgeReadingModel";

const row = (extra: Partial<BizKnowledgeReadingItem> = {}): BizKnowledgeReadingItem => ({ id: "policy", title: "Interview feedback", category: "interview", audience: "all_hiring", published_revision: 2, content_hash: "a".repeat(64), acknowledged: false, acknowledged_at: null, acknowledged_revision: null, needs_update: false, review_overdue: false, ...extra });
describe("reading desk", () => {
  it("distinguishes a new read from changed wording and current text", () => {
    expect(readingStatus(row())).toBe("Not acknowledged");
    expect(readingStatus(row({ acknowledged_at: "2026-01-01", acknowledged_revision: 1 }))).toBe("Updated since you last acknowledged");
    expect(readingStatus(row({ acknowledged: true, acknowledged_at: "2026-01-01" }))).toBe("Acknowledged current text");
  });
  it("keeps new and changed references in the remaining queue", () => {
    const items = [row(), row({ id: "changed", acknowledged_at: "2026-01-01" }), row({ id: "current", acknowledged: true })];
    expect(filterReading(items, "", "remaining").map(r => r.id)).toEqual(["policy", "changed"]);
    expect(filterReading(items, "", "current").map(r => r.id)).toEqual(["current"]);
  });
  it("combines normalized title search and status without exposing other fields", () => {
    const items = [row(), row({ id: "other", title: "Offer handling", acknowledged: true })];
    expect(filterReading(items, "  INTERVIEW  ", "all")).toEqual([items[0]]);
    expect(filterReading(items, "all_hiring", "all")).toEqual([]);
    expect(filterReading(items, "interview", "current")).toEqual([]);
  });
  it("keeps the complete source text and line endings when building a bounded passage outline", () => {
    const body = "  First paragraph.\r\n\r\nSecond paragraph.\n \nThird paragraph.  \n\n";
    const parts = readingPassages(body);
    expect(parts).toHaveLength(3);
    expect(parts.join("")).toBe(body);
    const long = Array.from({ length: 137 }, (_, i) => `Paragraph ${i}: café, 日本語 and source punctuation.\n\n`).join("");
    expect(readingPassages(long).length).toBeLessThanOrEqual(12);
    expect(readingPassages(long).join("")).toBe(long);
    expect(readingPassages("")).toEqual([]);
  });
  it("states a fixed word-count estimate without inventing completion or understanding", () => {
    expect(readingEstimate("one two\nthree")).toEqual({ words: 3, minutes: 1 });
    expect(readingEstimate("word ".repeat(201))).toEqual({ words: 201, minutes: 2 });
    expect(readingEstimate(" \n ")).toEqual({ words: 0, minutes: 0 });
  });
  it("accepts only complete document UUIDs in direct links", () => {
    const id = "abcdef12-abcd-abcd-abcd-abcdef123456";
    expect(readingDocumentId(id.toUpperCase())).toBe(id);
    for (const value of [null, "", "../admin", "https://example.com", id + "extra", "__proto__"]) expect(readingDocumentId(value)).toBeNull();
  });
});
