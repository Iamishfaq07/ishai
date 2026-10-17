import { describe, expect, it } from "vitest";
import type { JobTrackerEntry } from "@orbit/types";
import { channelOf, searchInsights } from "./insights";

const NOW = Date.parse("2026-10-15T12:00:00Z"); // a Thursday
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function e(id: string, over: Partial<JobTrackerEntry>): JobTrackerEntry {
  return { id, listing_id: `l-${id}`, source: "greenhouse", company: "Co", title: "Engineer", location: "", url: "", apply_url: "", posted_at: null,
    status: "saved", notes: "", applied_at: null, next_at: null, status_at: ago(1), resume_id: null, document_id: null, live: true,
    created_at: ago(30), updated_at: ago(1), ...over };
}

describe("searchInsights", () => {
  const entries = [
    e("a", { status: "interviewing", applied_at: ago(20), status_at: ago(14) }), // answered in 6 days
    e("b", { status: "rejected", applied_at: ago(10), status_at: ago(8), source: "himalayas" }), // a no, in 2 days
    e("c", { status: "applied", applied_at: ago(18), source: "remoteok" }), // quiet for 18 days
    e("d", { status: "applied", applied_at: ago(3), listing_id: "ext:abc", source: "manual" }), // too soon to tell
    e("f", { status: "offer", applied_at: ago(40), status_at: ago(30) }), // 10 days
    e("g", { status: "saved" }), // never applied: not in the funnel
  ];

  it("counts the funnel from what was applied to", () => {
    const s = searchInsights(entries, NOW);
    expect([s.applied, s.heardBack, s.interviews, s.offers]).toEqual([5, 3, 2, 1]);
    expect(s.responseRate).toBeCloseTo(0.6);
    expect(s.interviewRate).toBeCloseTo(0.4);
    expect(s.medianDaysToHear).toBe(6);
    expect(s.quiet).toBe(1);
  });

  it("splits it by where you applied", () => {
    const s = searchInsights(entries, NOW);
    expect(s.channels).toEqual([
      { channel: "Company careers pages", applied: 2, heardBack: 2, interviews: 2 },
      { channel: "Job boards", applied: 2, heardBack: 1, interviews: 0 },
      { channel: "Found elsewhere", applied: 1, heardBack: 0, interviews: 0 },
    ]);
    expect(channelOf({ listing_id: "ext:x", source: "greenhouse" })).toBe("Found elsewhere");
  });

  it("counts applications per week for the last eight weeks", () => {
    const s = searchInsights(entries, NOW);
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks[7]).toEqual({ start: "2026-10-12", count: 1 }); // applied 3 days ago, this week
    expect(s.weeks.reduce((n, w) => n + w.count, 0)).toBe(5);
  });

  it("measures no wait for a job added straight in as interviewing", () => {
    const at = ago(2);
    const s = searchInsights([e("m", { status: "interviewing", applied_at: at, status_at: at, source: "manual" })], NOW);
    expect([s.applied, s.heardBack, s.medianDaysToHear]).toEqual([1, 1, null]);
    const sameDay = searchInsights([e("n", { status: "rejected", applied_at: ago(2), status_at: ago(1.8) })], NOW);
    expect(sameDay.medianDaysToHear).toBe(0); // a real answer within the day
  });

  it("has no rates before anything is applied to", () => {
    const s = searchInsights([e("x", {})], NOW);
    expect([s.applied, s.responseRate, s.medianDaysToHear]).toEqual([0, null, null]);
  });
});
