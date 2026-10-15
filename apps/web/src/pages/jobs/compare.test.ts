import { describe, expect, it } from "vitest";
import type { JobDetail, JobListing, JobTrackerEntry } from "@orbit/types";
import { compareRows, type CompareJob } from "./compare";

const NOW = Date.parse("2026-10-15T10:00:00Z");

function entry(id: string, extra: Partial<JobTrackerEntry> = {}): JobTrackerEntry {
  return { id, listing_id: `l-${id}`, source: "greenhouse", company: `Co ${id}`, title: "Backend Engineer", location: "Bengaluru",
    url: "", apply_url: "", posted_at: null, status: "saved", notes: "", applied_at: null, next_at: null,
    status_at: "2026-10-10T00:00:00Z", resume_id: null, document_id: null, live: true, created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z", ...extra };
}

function detail(job: Partial<JobListing>, fit: JobDetail["fit"] = null): JobDetail {
  return { job: { id: "x", source: "greenhouse", source_label: "Greenhouse", direct: true, attribution: null, company: "Co",
    title: "Backend Engineer", locations: [], place: "Bengaluru · Hybrid", workplace: "hybrid", employment_type: "full_time",
    level: null, experience: "3-5 years", posted_at: "2026-10-13T10:00:00Z", url: "", apply_url: "", snippet: "", salary: null,
    match: null, tracked: null, ...job } as JobListing, full_text: true, fit, tracker: null };
}

const row = (rows: ReturnType<typeof compareRows>, label: string) => rows.find((r) => r.label === label);

describe("compareRows", () => {
  it("lines the jobs up and marks the best where they differ", () => {
    const jobs: CompareJob[] = [
      { entry: entry("a"), detail: detail({ match: { score: 82, matched: [], missing: ["Kafka"] }, salary: "₹30L – ₹40L a year" },
        { verdict: "Strong", summary: "", why: [], gaps: [], tweaks: [], requirements: [
          { requirement: "Go", status: "met", job_quote: "", resume_quote: "" },
          { requirement: "Kafka", status: "missing", job_quote: "", resume_quote: "" }] }) },
      { entry: entry("b", { status: "interviewing", next_at: "2026-10-20T09:00:00Z" }),
        detail: detail({ match: { score: 64, matched: [], missing: ["Java", "Spring", "AWS"] } },
          { verdict: "Good", summary: "", why: [], gaps: [], tweaks: [], requirements: [
            { requirement: "Go", status: "met", job_quote: "", resume_quote: "" },
            { requirement: "Kafka", status: "met", job_quote: "", resume_quote: "" }] }) },
    ];
    const rows = compareRows(jobs, NOW);
    expect(row(rows, "Skills match")).toEqual({ label: "Skills match", values: ["82 / 100", "64 / 100"], best: [0] });
    expect(row(rows, "Skills you're missing")?.best).toEqual([0]);
    expect(row(rows, "Fit check")?.best).toEqual([0]);
    expect(row(rows, "Requirements")).toEqual({ label: "Requirements", values: ["1 of 2 met", "2 of 2 met"], best: [1] });
    expect(row(rows, "Salary")?.values).toEqual(["₹30L – ₹40L a year", null]);
    expect(row(rows, "Your stage")?.values[1]).toMatch(/^Interviewing · next /);
    expect(row(rows, "Posted")?.values).toEqual(["2 days ago", "2 days ago"]);
    expect(row(rows, "Location")?.best).toEqual([]); // nothing to rank
  });

  it("picks nothing on a tie, and leaves out rows no post fills", () => {
    const same = { match: { score: 70, matched: [], missing: [] } };
    const rows = compareRows([{ entry: entry("a"), detail: detail(same) }, { entry: entry("b"), detail: detail(same) }], NOW);
    expect(row(rows, "Skills match")?.best).toEqual([]);
    expect(row(rows, "Salary")).toBeUndefined();
    expect(row(rows, "Fit check")).toBeUndefined();
  });

  it("still compares a job whose post is gone, from the tracker", () => {
    const rows = compareRows([{ entry: entry("a", { live: false, location: "Pune" }), detail: null }, { entry: entry("b"), detail: detail({}) }], NOW);
    expect(row(rows, "Location")?.values).toEqual(["Pune", "Bengaluru · Hybrid"]);
    expect(row(rows, "Source")?.values).toEqual(["No longer in the feed", "From Co's careers page"]);
  });
});
