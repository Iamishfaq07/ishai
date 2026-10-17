import { describe, expect, it } from "vitest";
import type { InterviewSessionContext, JobTrackerEntry, OrbitDocument } from "@orbit/types";
import {
  contextDocumentIds,
  contextSummary,
  dateTimeInput,
  daysUntil,
  fromDateTimeInput,
  hasTime,
  interviewWhen,
  interviewsSoon,
  mockForRound,
  outcomeEffect,
  roundLabel,
  suggestedOutcome,
  upcomingInterviews,
} from "./interviewDay";

const NOW = new Date(2026, 9, 18, 9, 0, 0).getTime(); // Sun 18 Oct 2026, 9 am local
const at = (days: number, hour = 15, minute = 0) => new Date(2026, 9, 18 + days, hour, minute, 0).toISOString();

const entry = (id: string, extra: Partial<JobTrackerEntry> = {}): JobTrackerEntry => ({
  id,
  listing_id: `l-${id}`,
  source: "greenhouse",
  company: `Co ${id}`,
  title: "Backend Engineer",
  location: "",
  url: "",
  apply_url: "",
  posted_at: null,
  status: "interviewing",
  notes: "",
  applied_at: null,
  next_at: null,
  status_at: at(-3),
  resume_id: null,
  document_id: null,
  live: true,
  created_at: at(-10),
  updated_at: at(-3),
  ...extra,
});

const doc = (id: string, kind: OrbitDocument["kind"], status: OrbitDocument["status"] = "ready") =>
  ({ id, kind, status, title: id }) as OrbitDocument;

describe("rounds", () => {
  it("names a round like the server", () => {
    expect(roundLabel("technical", 2)).toBe("Round 2 · Technical round");
    expect(roundLabel("hr", null)).toBe("HR round");
    expect(roundLabel(null, 3)).toBe("Round 3");
    expect(roundLabel(null, null)).toBe("");
  });

  it("picks the interviewer a round would have", () => {
    expect(mockForRound("hr")).toEqual({ persona: "recruiter", interview_type: "behavioral" });
    expect(mockForRound("technical").interview_type).toBe("technical");
    expect(mockForRound("final").persona).toBe("executive");
    expect(mockForRound(null)).toEqual({ persona: "hiring_manager", interview_type: "mixed" });
  });
});

describe("dates", () => {
  it("counts local days and keeps a time only when one was set", () => {
    expect(daysUntil(at(0, 23), NOW)).toBe(0);
    expect(daysUntil(at(1, 0, 5), NOW)).toBe(1);
    expect(daysUntil(at(-1), NOW)).toBe(-1);
    expect(hasTime(at(1, 12))).toBe(false); // the tracker's date-only field saves noon
    expect(hasTime(at(1, 12, 30))).toBe(true);
    expect(interviewWhen(at(1, 12), NOW)).toBe("Tomorrow");
    expect(interviewWhen(at(0, 15), NOW)).toMatch(/^Today, 3:00/);
    expect(interviewWhen(null, NOW)).toBe("");
  });

  it("round-trips a datetime-local value", () => {
    const iso = at(2, 11, 30);
    expect(fromDateTimeInput(dateTimeInput(iso))).toBe(iso);
    expect(fromDateTimeInput("2026-10-20")).toBeNull();
    expect(dateTimeInput(null)).toBe("");
  });
});

describe("which interviews are coming up", () => {
  const entries = [
    entry("later", { next_at: at(5) }),
    entry("soon", { next_at: at(0, 18) }),
    entry("past", { next_at: at(-1) }),
    entry("far", { next_at: at(30) }),
    entry("saved", { status: "saved", next_at: at(1) }),
    entry("applied", { status: "applied", next_at: at(1) }),
    entry("nodate"),
    entry("offer", { status: "offer", next_at: at(1) }),
  ];

  it("lists dated ones soonest first, then interviewing ones without a date (an applied job's date is a follow-up)", () => {
    expect(upcomingInterviews(entries, NOW).map((e) => e.id)).toEqual(["soon", "later", "nodate"]);
    expect(upcomingInterviews(entries, NOW, 14, 2).map((e) => e.id)).toEqual(["soon", "later"]);
  });

  it("has today's and tomorrow's for Home", () => {
    const more = [...entries, entry("tomorrow", { next_at: at(1, 9) })];
    expect(interviewsSoon(more, NOW).map((x) => [x.entry.id, x.days])).toEqual([
      ["soon", 0],
      ["tomorrow", 1],
    ]);
  });
});

describe("a session started from a job", () => {
  const ctx = (extra: Partial<InterviewSessionContext> = {}): InterviewSessionContext => ({
    application_id: "e1",
    title: "Razorpay — Round 2",
    role: "Backend Engineer",
    company: "Razorpay",
    interview_stage: "Round 2",
    key_requirements: [],
    tech_stack: [],
    document_ids: ["jd", "cv-sent"],
    documents: [
      { id: "jd", kind: "job_description", title: "Backend Engineer — Razorpay" },
      { id: "cv-sent", kind: "resume", title: "My CV (sent to Razorpay, 12 Oct 2026)" },
    ],
    resume_included: true,
    version: { kind: "snapshot", id: "s1", title: "My CV", score: 80, at: new Date(2026, 9, 12).toISOString(), note: "" },
    round: { type: null, number: 2, label: "Round 2", at: null },
    guide: "Razorpay",
    notes: [],
    ...extra,
  });
  const docs = [doc("jd", "job_description"), doc("other-jd", "job_description"), doc("cv", "resume"), doc("cv-sent", "resume"), doc("old", "resume", "failed")];

  it("reads the job's documents, and the usual resumes only when the job has none", () => {
    expect(contextDocumentIds(ctx(), docs)).toEqual(["jd", "cv-sent"]);
    expect(contextDocumentIds(ctx({ document_ids: ["jd"], resume_included: false }), docs)).toEqual(["jd", "cv", "cv-sent"]);
  });

  it("says what it starts with", () => {
    expect(contextSummary(ctx())).toMatch(/^The job post, the resume you sent on (12 Oct|Oct 12) and the Razorpay guide$/);
    expect(contextSummary(ctx({ documents: [], version: null, guide: null }))).toBe("");
    expect(contextSummary(ctx({ guide: null, version: { ...ctx().version!, kind: "resume", title: "CV 2" } }))).toBe(
      "The job post and your resume “CV 2”",
    );
  });
});

describe("the wrap-up", () => {
  it("suggests a next round, and says what confirming does", () => {
    expect(suggestedOutcome("applied")).toBe("next_round");
    expect(suggestedOutcome("offer")).toBe("offer");
    expect(outcomeEffect("next_round", "applied", 1)).toBe("Moves it to Interviewing, round 2.");
    expect(outcomeEffect("next_round", "interviewing", null)).toBe("Keeps it at Interviewing, round 2.");
    expect(outcomeEffect("rejected", "interviewing", 2)).toMatch(/Not this time/);
  });
});
