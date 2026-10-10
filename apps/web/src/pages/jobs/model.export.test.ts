import { describe, expect, it } from "vitest";
import type { JobTrackerEntry } from "@orbit/types";
import { fileSlug, nextDateIcs, nextDateTitle, trackerCsv } from "./model";

function job(over: Partial<JobTrackerEntry> = {}): JobTrackerEntry {
  return {
    id: "t1",
    listing_id: "l1",
    source: "manual",
    company: "Swiggy",
    title: "SDE II",
    location: "Bengaluru",
    url: "https://careers.swiggy.com/jobs/1",
    apply_url: "",
    posted_at: null,
    status: "interviewing",
    notes: "",
    applied_at: "2026-10-06T06:30:00.000Z",
    next_at: "2026-10-14T06:30:00.000Z",
    status_at: "2026-10-06T06:30:00.000Z",
    resume_id: null,
    document_id: null,
    live: false,
    created_at: "2026-10-05T06:30:00.000Z",
    updated_at: "2026-10-06T06:30:00.000Z",
    ...over,
  };
}

describe("trackerCsv", () => {
  it("writes a header and one row per job, with a byte-order mark for Excel", () => {
    const csv = trackerCsv([job()]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, row] = csv.slice(1).trimEnd().split("\r\n");
    expect(header).toBe("Company,Role,Location,Status,Applied,Next,Link,Notes,Added");
    expect(row).toBe("Swiggy,SDE II,Bengaluru,Interviewing,2026-10-06,2026-10-14,https://careers.swiggy.com/jobs/1,,2026-10-05");
  });

  it("quotes commas, quotes and line breaks", () => {
    const row = trackerCsv([job({ company: 'Acme, "Inc"', notes: "Round 1\nRound 2" })]).slice(1).split("\r\n")[1]!;
    expect(row.startsWith('"Acme, ""Inc"""')).toBe(true);
    expect(row).toContain('"Round 1\nRound 2"');
  });

  it("never lets a cell run as a spreadsheet formula", () => {
    const row = trackerCsv([job({ notes: "=HYPERLINK(\"x\")", title: "+1 role" })]).slice(1).split("\r\n")[1]!;
    expect(row).toContain("'+1 role");
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("uses the apply link when there is one", () => {
    expect(trackerCsv([job({ apply_url: "https://apply.example/1" })])).toContain("https://apply.example/1");
  });
});

describe("nextDateIcs", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");

  it("is null without a next date", () => {
    expect(nextDateIcs(job({ next_at: null }), now)).toBeNull();
  });

  it("is an all-day event on the next date, ending the day after", () => {
    const ics = nextDateIcs(job(), now)!;
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261014\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261015\r\n");
    expect(ics).toContain("DTSTAMP:20261010T120000Z\r\n");
    expect(ics).toContain("UID:t1-next@orbit\r\n");
    expect(ics).toContain("SUMMARY:Interview: SDE II\\, Swiggy\r\n");
    expect(ics).toContain("LOCATION:Bengaluru\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("rolls the end over a month boundary", () => {
    expect(nextDateIcs(job({ next_at: "2026-10-31T06:30:00.000Z" }), now)).toContain("DTEND;VALUE=DATE:20261101");
  });

  it("escapes notes and folds long lines at 75 octets", () => {
    const notes = "Ask about the team; bring ID, offer letter\n" + "x".repeat(200);
    const ics = nextDateIcs(job({ notes }), now)!;
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // Unfolding (drop each CRLF + space) gives the escaped description back whole.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Ask about the team\\; bring ID\\, offer letter\\n");
    expect(unfolded).toContain("x".repeat(200));
  });

  it("names a follow-up when not interviewing", () => {
    expect(nextDateTitle({ status: "applied", title: "SDE I", company: "Flipkart" })).toBe("Follow up: SDE I, Flipkart");
    expect(nextDateTitle({ status: "offer", title: "SDE I", company: "Flipkart" })).toBe("Offer: SDE I, Flipkart");
  });
});

describe("fileSlug", () => {
  it("makes a safe file name", () => {
    expect(fileSlug("Swiggy", "SDE II")).toBe("swiggy-sde-ii");
    expect(fileSlug("  ", "")).toBe("job");
  });
});
