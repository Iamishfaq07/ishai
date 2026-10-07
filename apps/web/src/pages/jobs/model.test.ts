import { describe, expect, it } from "vitest";
import type { JobPrefs, JobTrackerEntry } from "@orbit/types";
import {
  addItem,
  byStatus,
  dateInput,
  factsLine,
  fromDateInput,
  isNew,
  matchTone,
  postedAgo,
  profileSummary,
  safeUrl,
  sourceLine,
  toggleWorkplace,
} from "./model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;

function prefs(over: Partial<JobPrefs> = {}): JobPrefs {
  return {
    titles: ["Backend Engineer", "Platform Engineer", "Software Engineer"],
    skills: ["Go"],
    locations: ["Bengaluru"],
    workplace: ["remote", "hybrid", "onsite"],
    level: "mid",
    years: 3.2,
    job_types: [],
    posted_within: 7,
    sources_off: [],
    portals: ["linkedin"],
    exclude: [],
    ...over,
  };
}

function entry(id: string, status: JobTrackerEntry["status"], at: string): JobTrackerEntry {
  return {
    id, listing_id: `l-${id}`, source: "lever", company: "Acme", title: "Backend Engineer", location: "Bengaluru",
    url: "https://jobs.lever.co/acme/1", apply_url: "https://jobs.lever.co/acme/1/apply", posted_at: null, status,
    notes: "", applied_at: null, next_at: null, status_at: at, resume_id: null, document_id: null, live: true,
    created_at: at, updated_at: at,
  };
}

describe("postedAgo", () => {
  it("says how long ago a job was posted, in plain words", () => {
    expect(postedAgo(ago(5 * 60_000), NOW)).toBe("Just now");
    expect(postedAgo(ago(40 * 60_000), NOW)).toBe("40 min ago");
    expect(postedAgo(ago(3 * H), NOW)).toBe("3h ago");
    expect(postedAgo(ago(30 * H), NOW)).toBe("Yesterday");
    expect(postedAgo(ago(5 * 24 * H), NOW)).toBe("5 days ago");
    expect(postedAgo(ago(21 * 24 * H), NOW)).toBe("3 weeks ago");
    expect(postedAgo(new Date(NOW + H).toISOString(), NOW)).toBe("Just now"); // a clock slip isn't "in the future"
  });

  it("marks jobs from the last day as new", () => {
    expect(isNew(ago(23 * H), NOW)).toBe(true);
    expect(isNew(ago(25 * H), NOW)).toBe(false);
  });
});

describe("cards", () => {
  it("colours the match from strong to weak", () => {
    expect(matchTone(85)).toContain("emerald");
    expect(matchTone(70)).toContain("sky");
    expect(matchTone(50)).toContain("amber");
    expect(matchTone(20)).toContain("zinc");
  });

  it("puts the job's facts on one line, skipping what the post doesn't say", () => {
    expect(factsLine({ employment_type: "full_time", experience: "3-5 years", salary: "₹24L – ₹36L a year" })).toBe(
      "Full-time · 3-5 years · ₹24L – ₹36L a year",
    );
    expect(factsLine({ employment_type: null, experience: null, salary: null })).toBe("");
  });

  it("credits the company's own page, or the feed the job came through", () => {
    expect(sourceLine({ direct: true, source_label: "Lever", company: "CRED", attribution: null })).toBe("From CRED's careers page");
    expect(sourceLine({ direct: false, source_label: "Himalayas", company: "X", attribution: { label: "Himalayas", url: "https://himalayas.app", large: false } })).toBe(
      "via Himalayas",
    );
  });

  it("only opens web links", () => {
    expect(safeUrl("https://jobs.lever.co/cred/1")).toBe("https://jobs.lever.co/cred/1");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});

describe("the profile", () => {
  it("adds typed items once each, split at commas, up to the limit", () => {
    expect(addItem(["Go"], " python ,  go, Kubernetes ")).toEqual(["Go", "python", "Kubernetes"]);
    expect(addItem(["a", "b"], "c, d", 3)).toEqual(["a", "b", "c"]);
    expect(addItem(["a"], " , ")).toEqual(["a"]);
  });

  it("keeps at least one work mode on", () => {
    expect(toggleWorkplace(["remote", "hybrid"], "remote")).toEqual(["hybrid"]);
    expect(toggleWorkplace(["remote"], "remote")).toEqual(["remote"]);
    expect(toggleWorkplace(["remote"], "onsite")).toEqual(["remote", "onsite"]);
  });

  it("sums up what the feed looks for", () => {
    expect(profileSummary(prefs())).toBe("Backend Engineer, Platform Engineer +1 · Bengaluru or remote · 3.2 years");
    expect(profileSummary(prefs({ workplace: ["remote"], years: null, level: "senior" }))).toBe(
      "Backend Engineer, Platform Engineer +1 · Remote · Senior",
    );
    expect(profileSummary(prefs({ titles: [], locations: [], workplace: ["onsite"], years: null, level: null }))).toBe("Any role · Anywhere in India");
  });
});

describe("the tracker", () => {
  it("groups jobs by status, most recently moved first", () => {
    const cols = byStatus([entry("a", "applied", "2026-10-01T10:00:00Z"), entry("b", "applied", "2026-10-05T10:00:00Z"), entry("c", "saved", "2026-10-02T10:00:00Z")]);
    expect(cols.applied.map((e) => e.id)).toEqual(["b", "a"]);
    expect(cols.saved.map((e) => e.id)).toEqual(["c"]);
    expect(cols.offer).toEqual([]);
  });

  it("round-trips a date through the date input without moving it a day", () => {
    const iso = fromDateInput("2026-10-09");
    expect(iso).not.toBeNull();
    expect(dateInput(iso)).toBe("2026-10-09");
    expect(fromDateInput("")).toBeNull();
    expect(fromDateInput("9/10/2026")).toBeNull();
    expect(dateInput(null)).toBe("");
  });
});
