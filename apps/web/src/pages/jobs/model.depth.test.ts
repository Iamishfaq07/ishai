// Jobs AI's honesty and follow-up logic (model.ts): no match % without something to match against, trust badges only
// where the data backs them, what's due on the tracker, jobs found elsewhere, and the search box's quick chips.
import { describe, expect, it } from "vitest";
import type { JobListing, JobPrefs, JobTrackerEntry } from "@orbit/types";
import {
  activeFilterCount,
  daysBetween,
  followUps,
  hasQueryWord,
  inAWeek,
  isEarly,
  isManual,
  linkHost,
  matchBasis,
  postedTime,
  practiceLink,
  stillOpenAt,
  toggleQueryWord,
  trustBadges,
} from "./model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const H = 3600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const at = (ms: number) => new Date(NOW + ms).toISOString();

function prefs(over: Partial<JobPrefs> = {}): JobPrefs {
  return {
    titles: ["Backend Engineer"],
    skills: ["Go"],
    locations: [],
    workplace: ["remote", "hybrid", "onsite"],
    level: null,
    years: null,
    job_types: [],
    posted_within: 7,
    sources_off: [],
    portals: [],
    exclude: [],
    ...over,
  };
}

function listing(over: Partial<JobListing> = {}): JobListing {
  return {
    id: "j1",
    source: "greenhouse",
    source_label: "Greenhouse",
    direct: true,
    attribution: null,
    company: "Groww",
    title: "Backend Engineer",
    locations: ["Bengaluru"],
    place: "Bengaluru",
    workplace: "onsite",
    employment_type: "full_time",
    level: null,
    experience: null,
    posted_at: ago(5 * H),
    url: "https://boards.greenhouse.io/groww/jobs/1",
    apply_url: "https://boards.greenhouse.io/groww/jobs/1",
    snippet: "",
    salary: null,
    match: null,
    tracked: null,
    first_seen_at: ago(5 * H),
    still_listed_at: ago(2 * H),
    ...over,
  };
}

function entry(id: string, status: JobTrackerEntry["status"], moved: string, over: Partial<JobTrackerEntry> = {}): JobTrackerEntry {
  return {
    id,
    listing_id: `l-${id}`,
    source: "lever",
    company: `Co ${id}`,
    title: "Backend Engineer",
    location: "Bengaluru",
    url: "https://jobs.lever.co/acme/1",
    apply_url: "https://jobs.lever.co/acme/1/apply",
    posted_at: null,
    status,
    notes: "",
    applied_at: null,
    next_at: null,
    status_at: moved,
    resume_id: null,
    document_id: null,
    live: true,
    created_at: moved,
    updated_at: moved,
    ...over,
  };
}

const applied = (id: string, days: number, over: Partial<JobTrackerEntry> = {}) =>
  entry(id, "applied", ago(days * D), { applied_at: ago(days * D), ...over });

describe("an honest match", () => {
  it("shows a match % only when there's a resume or skills to match against", () => {
    const empty = prefs({ titles: [], skills: [] });
    expect(matchBasis({ resume: null, prefs: empty })).toBeNull(); // the old "42% match" on every job
    expect(matchBasis({ resume: { id: "r", title: "Blank" }, prefs: empty })).toBeNull(); // a resume with nothing in it
    expect(matchBasis({ resume: { id: "r", title: "CV" }, prefs: prefs() })).toBe("resume");
    expect(matchBasis({ resume: { id: "r", title: "CV" }, prefs: prefs({ skills: [] }) })).toBe("resume"); // its titles
    expect(matchBasis({ resume: null, prefs: prefs({ titles: [], skills: ["Excel", "SQL"] }) })).toBe("skills");
    expect(matchBasis({ resume: null, prefs: prefs({ skills: [] }) })).toBeNull(); // titles alone can't score a job
  });
});

describe("trust and freshness badges", () => {
  it("says early applicant only for posts under two days old, by the earlier of their date and Orbit's first sighting", () => {
    expect(isEarly(listing({ posted_at: ago(47 * H), first_seen_at: ago(47 * H) }), NOW)).toBe(true);
    expect(isEarly(listing({ posted_at: ago(49 * H), first_seen_at: ago(49 * H) }), NOW)).toBe(false);
    // A post without a date is re-dated at every fetch: Orbit has seen it for a week, so it isn't new.
    const undated = listing({ posted_at: ago(1 * H), first_seen_at: ago(7 * D) });
    expect(postedTime(undated)).toBe(undated.first_seen_at);
    expect(isEarly(undated, NOW)).toBe(false);
    expect(isEarly({ posted_at: ago(3 * H) }, NOW)).toBe(true); // an older API without first_seen_at
  });

  it("says direct and still open only for a company's own board, checked within a day", () => {
    const badges = trustBadges(listing(), NOW);
    expect(badges.map((b) => b.id)).toEqual(["early", "direct", "open"]);
    expect(badges[2]!.label).toBe("Still open · checked 2h ago");
    expect(trustBadges(listing({ still_listed_at: ago(30 * H) }), NOW).map((b) => b.id)).toEqual(["early", "direct"]); // stale
    // A feed's post: never "direct", never "still open", even if a still_listed_at came along.
    const feed = listing({ direct: false, source: "remoteok", still_listed_at: ago(H), posted_at: ago(4 * D), first_seen_at: ago(4 * D) });
    expect(trustBadges(feed, NOW)).toEqual([]);
    expect(stillOpenAt({ still_listed_at: null }, NOW)).toBeNull();
    expect(stillOpenAt({ still_listed_at: ago(23 * H) }, NOW)).toBe(ago(23 * H));
  });
});

describe("follow-ups", () => {
  it("nudges a follow-up a week after applying with no reply, until the application goes cold", () => {
    const due = followUps([applied("a", 6), applied("b", 7), applied("c", 12), applied("d", 60)], NOW);
    expect(due.map((f) => [f.entry.id, f.kind, f.days])).toEqual([
      ["c", "follow_up", 12],
      ["b", "follow_up", 7],
    ]);
    expect(due[1]!.text).toBe("Follow up with Co b: applied 7 days ago");
    // Moved along since (its status changed 2 days ago): not waiting on a reply any more.
    expect(followUps([applied("e", 10, { status_at: ago(2 * D) })], NOW)).toEqual([]);
  });

  it("puts dated interviews and follow-ups first: overdue, today, tomorrow, then interviews this week", () => {
    const items = followUps(
      [
        applied("late", 10, { next_at: at(-2 * D) }),
        entry("today", "interviewing", ago(3 * D), { company: "Bosch", next_at: at(0) }),
        entry("tmrw", "interviewing", ago(3 * D), { company: "Razorpay", next_at: at(D) }),
        entry("thu", "interviewing", ago(3 * D), { company: "CRED", next_at: at(3 * D) }),
        applied("later", 3, { next_at: at(4 * D) }), // a follow-up date later this week isn't due yet
        applied("stale", 30, { next_at: at(-20 * D) }), // long past: stale, not overdue
        applied("won", 9, { status: "offer" }), // done
        applied("no", 9, { status: "rejected" }),
        applied("wait", 8),
      ],
      NOW,
    );
    expect(items.map((f) => [f.entry.id, f.kind])).toEqual([
      ["late", "overdue"],
      ["today", "today"],
      ["tmrw", "tomorrow"],
      ["wait", "follow_up"],
      ["thu", "soon"],
    ]);
    expect(items[1]!.text).toBe("Interview with Bosch today");
    expect(items[2]!).toMatchObject({ text: "Interview with Razorpay tomorrow", interview: true });
    expect(items[0]!.interview).toBe(false);
    expect(followUps([], NOW)).toEqual([]);
  });

  it("counts days on the calendar, and 'in a week' is a week from today at noon", () => {
    expect(daysBetween(NOW, NOW + D)).toBe(1);
    expect(daysBetween(NOW, NOW - 3 * D)).toBe(-3);
    const next = new Date(inAWeek(NOW));
    expect(daysBetween(NOW, next.getTime())).toBe(7);
    expect(next.getHours()).toBe(12);
  });

  it("practises on the job's saved post, else its page, else a mock for its title", () => {
    const page = (id: string) => "/jobs/listing/" + id;
    expect(practiceLink(entry("a", "interviewing", ago(D), { document_id: "doc 1" }), page)).toBe("/mock?jd=doc%201&preset=tech15");
    expect(practiceLink(entry("b", "interviewing", ago(D)), page)).toBe("/jobs/listing/l-b");
    const manual = entry("c", "interviewing", ago(D), { listing_id: "ext:0123456789abcdef0123456789abcdef", live: false, title: "SDE 1" });
    expect(practiceLink(manual, page)).toBe("/mock?preset=tech15&role=SDE%201");
  });
});

describe("jobs found elsewhere", () => {
  it("knows a hand-added job and where its link goes", () => {
    expect(isManual({ listing_id: "ext:0123456789abcdef0123456789abcdef" })).toBe(true);
    expect(isManual({ listing_id: "j4f2a" })).toBe(false);
    expect(linkHost("https://www.naukri.com/job-listings-x-123456")).toBe("naukri.com");
    expect(linkHost("")).toBeNull();
    expect(linkHost("javascript:alert(1)")).toBeNull();
  });
});

describe("the quick chips and the filters count", () => {
  it("toggles a word the search box understands, keeping the rest", () => {
    expect(toggleQueryWord("react bangalore", "fresher")).toBe("react bangalore fresher");
    expect(toggleQueryWord("react Fresher bangalore", "fresher")).toBe("react bangalore");
    expect(toggleQueryWord("", "internship")).toBe("internship");
    expect(hasQueryWord("remote internship", "internship")).toBe(true);
    expect(hasQueryWord("internships", "internship")).toBe(false);
  });

  it("counts the filters that differ from the defaults", () => {
    expect(activeFilterCount({ posted_within: 7, workplace: ["remote", "hybrid", "onsite"] }, "", "best")).toBe(0);
    expect(activeFilterCount({ posted_within: 1, workplace: ["remote"] }, "fresher internship", "newest")).toBe(5);
  });
});
