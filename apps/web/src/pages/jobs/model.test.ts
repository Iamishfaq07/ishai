import { describe, expect, it } from "vitest";
import type { JobListing, JobPrefs, JobTrackerEntry } from "@orbit/types";
import {
  addItem,
  byStatus,
  followUps,
  followUpState,
  dateInput,
  factsLine,
  fromDateInput,
  isNew,
  jobAsks,
  jobFacts,
  matchTone,
  nextUp,
  outreachKindFor,
  postedAgo,
  profileStamp,
  profileSummary,
  safeUrl,
  samePrefs,
  sourceLine,
  toggleWorkplace,
  withTracked,
} from "./model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;

it("keeps confirmed hires out of interview and follow-up reminders", () => {
  const hired = { ...entry("hired", "hired", ago(H)), next_at: ago(-H), applied_at: ago(240 * H) };
  expect(nextUp([hired], NOW)).toBeNull();
  expect(followUps([hired], NOW)).toEqual([]);
  expect(byStatus([hired]).hired).toEqual([hired]);
});

it("keeps withdrawn applications out of interview and follow-up reminders", () => {
  const withdrawn = { ...entry("withdrawn", "withdrawn", ago(H)), next_at: ago(-H), applied_at: ago(240 * H) };
  expect(nextUp([withdrawn], NOW)).toBeNull();
  expect(followUps([withdrawn], NOW)).toEqual([]);
  expect(byStatus([withdrawn]).withdrawn).toEqual([withdrawn]);
});

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

  it("lists a job's key facts, only those the post states", () => {
    expect(
      jobFacts({ company: "CRED", place: "Bengaluru · Hybrid", workplace: "hybrid", employment_type: "full_time", level: "mid", experience: "3-5 years", salary: null }),
    ).toEqual([
      ["Company", "CRED"],
      ["Location", "Bengaluru · Hybrid"],
      ["Work mode", "Hybrid"],
      ["Job type", "Full-time"],
      ["Level", "Mid-level"],
      ["Experience", "3-5 years"],
    ]);
    expect(jobFacts({ company: "X", place: "", workplace: null, employment_type: null, level: null, experience: null, salary: "₹20L a year" })).toEqual([
      ["Company", "X"],
      ["Salary", "₹20L a year"],
    ]);
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

describe("the feed's cache key", () => {
  it("changes with the profile or its resume, and only then", () => {
    const resume = { id: "r1", title: "Backend" };
    const base = profileStamp({ prefs: prefs(), resume });
    expect(profileStamp({ prefs: prefs(), resume: { ...resume, title: "Renamed" } })).toBe(base);
    expect(profileStamp({ prefs: prefs({ posted_within: 1 }), resume })).not.toBe(base);
    expect(profileStamp({ prefs: prefs(), resume: { id: "r2", title: "Backend" } })).not.toBe(base);
    expect(profileStamp({ prefs: prefs(), resume: null })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-z]+$/);
  });

  it("tells an edited profile from the saved one", () => {
    expect(samePrefs(prefs(), prefs())).toBe(true);
    expect(samePrefs(prefs(), prefs({ exclude: ["sales"] }))).toBe(false);
  });
});

describe("the tracker", () => {
  it("groups jobs by status, most recently moved first", () => {
    const cols = byStatus([entry("a", "applied", "2026-10-01T10:00:00Z"), entry("b", "applied", "2026-10-05T10:00:00Z"), entry("c", "saved", "2026-10-02T10:00:00Z")]);
    expect(cols.applied.map((e) => e.id)).toEqual(["b", "a"]);
    expect(cols.saved.map((e) => e.id)).toEqual(["c"]);
    expect(cols.offer).toEqual([]);
  });

  it("shows each job's latest place on the tracker: just changed, else the tracker, else the feed", () => {
    const job = (id: string, tracked: JobListing["tracked"] = null) => ({ id, tracked }) as JobListing;
    const items = [job("l-a"), job("l-b", { id: "b", status: "saved" }), job("l-c", { id: "c", status: "saved" })];
    const tracker = [entry("a", "applied", "2026-10-05T10:00:00Z"), entry("b", "interviewing", "2026-10-05T10:00:00Z")];
    expect(withTracked(items, {}, tracker).map((j) => j.tracked?.status ?? null)).toEqual(["applied", "interviewing", null]);
    expect(withTracked(items, {}, null).map((j) => j.tracked?.status ?? null)).toEqual([null, "saved", "saved"]);
    expect(withTracked(items, { "l-a": null, "l-c": { id: "c", status: "offer" } }, tracker).map((j) => j.tracked?.status ?? null)).toEqual([
      null,
      "interviewing",
      "offer",
    ]);
    expect(withTracked(items, {}, null)[1]).toBe(items[1]); // unchanged jobs stay the same object
  });

  it("finds what's coming up next, from today on", () => {
    const at = (id: string, status: JobTrackerEntry["status"], next: string | null) => ({ ...entry(id, status, "2026-10-01T10:00:00Z"), next_at: next });
    const list = [
      at("past", "interviewing", "2026-10-01T12:00:00Z"),
      at("later", "interviewing", "2026-10-20T12:00:00Z"),
      at("soon", "applied", "2026-10-09T12:00:00Z"),
      at("dropped", "rejected", "2026-10-08T12:00:00Z"),
      at("none", "saved", null),
    ];
    expect(nextUp(list, NOW)?.id).toBe("soon");
    expect(nextUp([list[0]!, list[4]!], NOW)).toBeNull();
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

describe("Outreach for a job", () => {
  it("opens on the message for how far along the job is", () => {
    expect(outreachKindFor("saved")).toBe("referral");
    expect(outreachKindFor("applied")).toBe("follow_up");
    expect(outreachKindFor("interviewing")).toBe("thank_you");
    for (const s of ["offer", "rejected", null, undefined] as const) expect(outreachKindFor(s)).toBeNull();
  });

  it("shows the job's skills the resume has first, each once, at most a few", () => {
    expect(jobAsks({ matched: ["Go", "Kafka"], missing: ["Java", "go", "AWS"] })).toEqual(["Go", "Kafka", "Java", "AWS"]);
    expect(jobAsks({ matched: ["A", "B", "C"], missing: ["D", "E"] }, 4)).toEqual(["A", "B", "C", "D"]);
    expect(jobAsks(null)).toEqual([]);
  });
});

describe("followUpState", () => {
  it("reads a contact's follow-up date against today", () => {
    const now = new Date(2026, 9, 11, 15, 0);
    expect(followUpState(null, now)).toBeNull();
    expect(followUpState(new Date(2026, 9, 9, 12).toISOString(), now)).toBe("overdue");
    expect(followUpState(new Date(2026, 9, 11, 9).toISOString(), now)).toBe("today");
    expect(followUpState(new Date(2026, 9, 12, 12).toISOString(), now)).toBe("later");
  });
});

describe("the profile outside India", () => {
  it("says anywhere in the country the user applies in", async () => {
    const { anywhereLabel, profileSummary } = await import("./model");
    expect(anywhereLabel("IN")).toBe("Anywhere in India");
    expect(anywhereLabel("DE")).toBe("Anywhere in Germany");
    expect(profileSummary(prefs({ titles: [], locations: ["Anywhere"], workplace: ["onsite"], years: null, level: null }), "GB")).toBe(
      "Any role · Anywhere in the United Kingdom",
    );
  });
});

describe("the entry level outside India", () => {
  it("is called Entry level there and Fresher in India, with the server's id either way", async () => {
    const { LEVELS, activeFilterCount, levelLabel, levelsFor } = await import("./model");
    expect(levelsFor("IN")).toBe(LEVELS);
    expect(levelsFor("US").map((l) => l.id)).toEqual(LEVELS.map((l) => l.id));
    expect(levelLabel("fresher", "IN")).toBe("Fresher");
    expect(levelLabel("fresher", "US")).toBe("Entry level");
    expect(levelLabel("senior", "US")).toBe("Senior");
    const job = { company: "X", place: "", workplace: null, employment_type: null, level: "fresher" as const, experience: null, salary: null };
    expect(jobFacts(job)).toContainEqual(["Level", "Fresher"]);
    expect(jobFacts(job, "GB")).toContainEqual(["Level", "Entry level"]);
    expect(profileSummary(prefs({ years: null, level: "fresher" }), "US")).toMatch(/Entry level$/);
    // The quick chip's word ("entry-level" outside India) counts as a filter, like "fresher".
    const p = { posted_within: 7 as const, workplace: ["onsite", "remote", "hybrid"] as JobPrefs["workplace"] };
    expect(activeFilterCount(p, "react entry-level", "best")).toBe(1);
    expect(activeFilterCount(p, "react fresher", "best")).toBe(1);
  });
});
