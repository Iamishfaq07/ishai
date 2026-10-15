import { describe, expect, it } from "vitest";
import type { TailorQueueItem } from "@orbit/types";
import { queueSummary } from "./tailorQueueText";

const item = (over: Partial<TailorQueueItem>): TailorQueueItem => ({ id: "i", label: "Job", source_resume_id: "r", status: "done",
  result: null, error: null, created_at: "2026-10-15T00:00:00Z", ...over });

describe("queueSummary", () => {
  it("says where each job is", () => {
    expect(queueSummary(item({ status: "queued" }))).toBe("Waiting its turn");
    expect(queueSummary(item({ status: "running" }))).toBe("Tailoring now…");
    expect(queueSummary(item({ status: "failed", error: "Out of resume credits." }))).toBe("Out of resume credits.");
  });

  it("sums up what a finished one did", () => {
    expect(queueSummary(item({ result: { resume_id: "x", title: "t", score_before: 55, score_after: 81, changes: 9, to_confirm: 2, questions: 1 } })))
      .toBe("Score 55 → 81 · 9 changes · 2 to confirm · 1 number to add");
    expect(queueSummary(item({ result: { resume_id: "x", title: "t", score_before: 70, score_after: 70, changes: 1, to_confirm: 0, questions: 0 } })))
      .toBe("Score 70 → 70 · 1 change");
  });
});
