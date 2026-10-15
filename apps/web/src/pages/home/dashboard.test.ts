import { describe, expect, it } from "vitest";
import type { JobTrackerEntry, OrbitSession } from "@orbit/types";
import { countdown, lastWeek, pipeline, summaryLine, upcoming } from "./dashboard";

const NOW = new Date("2026-10-16T10:00:00").getTime();
let n = 0;
function job(status: JobTrackerEntry["status"], next_at: string | null = null, company = "Acme"): JobTrackerEntry {
  n += 1;
  return { id: `j${n}`, listing_id: `l${n}`, source: "x", company, title: "Engineer", location: "", url: "", apply_url: "", posted_at: null, status, notes: "",
    applied_at: null, next_at, status_at: "2026-10-01T00:00:00Z", resume_id: null, document_id: null, live: true, created_at: "", updated_at: "" };
}
function session(type: OrbitSession["type"], status: OrbitSession["status"], at: string): OrbitSession {
  return { id: at, type, status, started_at: at, created_at: at } as OrbitSession;
}

describe("mission dashboard figures", () => {
  it("counts the pipeline by stage, with rejections apart from what's in progress", () => {
    const p = pipeline([job("saved"), job("applied"), job("applied"), job("interviewing"), job("offer"), job("rejected")]);
    expect(p.stages).toEqual({ saved: 1, applied: 2, interviewing: 1, offer: 1, rejected: 1 });
    expect(p.active).toBe(4);
    expect(p.total).toBe(6);
  });

  it("lists what's coming from today on, soonest first, never a rejected job's date", () => {
    const list = upcoming([
      job("interviewing", "2026-10-20T09:00:00", "Later"),
      job("applied", "2026-10-16T18:00:00", "Today"),
      job("interviewing", "2026-10-10T09:00:00", "Past"),
      job("rejected", "2026-10-17T09:00:00", "Rejected"),
    ], NOW);
    expect(list.map((e) => e.company)).toEqual(["Today", "Later"]);
  });

  it("says when, in days", () => {
    expect(countdown("2026-10-16T22:00:00", NOW)).toBe("Today");
    expect(countdown("2026-10-17T08:00:00", NOW)).toBe("Tomorrow");
    expect(countdown("2026-10-21T08:00:00", NOW)).toBe("In 5 days");
  });

  it("counts only finished practice in the last 7 days", () => {
    const week = lastWeek([
      session("mock", "ended", "2026-10-15T10:00:00"),
      session("mock", "ended", "2026-10-01T10:00:00"),
      session("mock", "live", "2026-10-15T10:00:00"),
      session("interview", "ended", "2026-10-14T10:00:00"),
    ], NOW);
    expect(week).toEqual({ mocks: 1, lives: 1 });
  });

  it("sums it up in one line, or says plainly that nothing is tracked", () => {
    expect(summaryLine([], NOW)).toMatch(/^Nothing tracked yet/);
    expect(summaryLine([job("applied"), job("offer"), job("interviewing", "2026-10-17T09:00:00", "Hooli")], NOW))
      .toBe("3 applications in progress · 1 offer · next date tomorrow (Hooli)");
  });
});
