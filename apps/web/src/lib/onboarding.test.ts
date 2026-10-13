import { describe, expect, it } from "vitest";
import type { JobPrefs } from "@orbit/types";
import {
  answersKey,
  checklist,
  followUpsDue,
  goalFromPath,
  interviewSoon,
  loadAnswers,
  nextSteps,
  practiceHref,
  prefsFromAnswers,
  presetFor,
  saveAnswers,
  type HomeFacts,
  type KeyValueStore,
  type TrackedJob,
  type WelcomeAnswers,
} from "./onboarding";

const NOW = new Date("2026-10-08T10:00:00+05:30");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const inHours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

const empty: HomeFacts = {
  resumes: 0,
  bestResume: null,
  resumeDocs: 0,
  mocks: 0,
  lives: 0,
  stories: 0,
  jobProfileSaved: false,
  tracker: [],
  mockEnabled: true,
};

function answers(over: Partial<WelcomeAnswers> = {}): WelcomeAnswers {
  return { goal: "jobs", experience: "fresher", role: "Data analyst", place: "Pune", status: "done", at: NOW.toISOString(), ...over };
}

function job(over: Partial<TrackedJob> = {}): TrackedJob {
  return { id: "t1", company: "Razorpay", title: "SDE-1", status: "applied", applied_at: null, next_at: null, document_id: null, ...over };
}

const prefs: JobPrefs = {
  titles: ["Analyst"],
  skills: ["SQL"],
  locations: ["Bengaluru"],
  workplace: ["remote", "hybrid", "onsite"],
  level: null,
  years: null,
  job_types: [],
  posted_within: 7,
  sources_off: [],
  portals: ["linkedin"],
  exclude: [],
};

const ids = (a: WelcomeAnswers | null, f: HomeFacts) => nextSteps(a, f, NOW).map((s) => s.id);

describe("nextSteps (Home's 'Your next step')", () => {
  it("leads with what they came for", () => {
    expect(ids(answers({ goal: "jobs" }), empty)[0]).toBe("matches");
    expect(ids(answers({ goal: "resume" }), empty)[0]).toBe("resume");
    expect(ids(answers({ goal: "interview" }), empty)[0]).toBe("warmup");
  });

  it("asks for a resume first when nothing was answered", () => {
    expect(ids(null, empty)[0]).toBe("resume");
    expect(ids(answers({ status: "skipped", goal: null }), empty)[0]).toBe("resume");
  });

  it("names the role and the city in the jobs step", () => {
    const [first] = nextSteps(answers(), empty, NOW);
    expect(first?.title).toBe("See Data analyst jobs in Pune");
    expect(first?.to).toBe("/jobs/matches");
    expect(nextSteps(answers({ place: "Remote", role: "" }), empty, NOW)[0]?.title).toBe("See remote jobs that fit you");
    expect(nextSteps(answers({ place: "India" }), empty, NOW)[0]?.title).toBe("See Data analyst jobs");
  });

  it("skips what's done and moves on", () => {
    const withResume = { ...empty, resumes: 1, bestResume: { id: "r1", score: 54 } };
    expect(ids(answers({ goal: "resume" }), withResume)[0]).toBe("improve-resume");
    expect(nextSteps(answers({ goal: "resume" }), withResume, NOW)[0]?.title).toBe("Raise your ATS score from 54");
    const good = { ...withResume, bestResume: { id: "r1", score: 86 } };
    expect(ids(answers({ goal: "resume" }), good)).not.toContain("improve-resume");
    expect(ids(answers({ goal: "resume" }), good)[0]).toBe("matches");
  });

  it("counts a Documents resume as having one", () => {
    expect(ids(null, { ...empty, resumeDocs: 1 })).not.toContain("resume");
  });

  it("drops the warm-up once they have a resume or have practised", () => {
    const interview = answers({ goal: "interview" });
    expect(ids(interview, { ...empty, resumes: 1, bestResume: { id: "r", score: 90 } })[0]).toBe("practice");
    expect(ids(interview, { ...empty, mocks: 1 })).not.toContain("warmup");
  });

  it("picks a mock interview that fits the experience", () => {
    const facts = { ...empty, resumes: 1, bestResume: { id: "r", score: 90 } };
    const practice = (experience: WelcomeAnswers["experience"]) =>
      nextSteps(answers({ goal: "interview", experience }), facts, NOW).find((s) => s.id === "practice");
    expect(practice("fresher")).toMatchObject({ title: "Do a 5-minute HR round", to: "/mock?preset=hr5&role=Data+analyst" });
    expect(practice("early")?.to).toBe("/mock?preset=tmay10&role=Data+analyst");
    expect(practice("experienced")?.to).toBe("/mock?preset=tech15&role=Data+analyst");
    expect(practice(null)?.to).toBe("/mock?preset=hr5&role=Data+analyst");
    const noRole = nextSteps(answers({ goal: "interview", experience: "fresher", role: " " }), facts, NOW).find((s) => s.id === "practice");
    expect(noRole?.to).toBe("/mock?preset=hr5");
  });

  it("sends practice to a live session when mock interviews are off", () => {
    const step = nextSteps(answers({ goal: "interview" }), { ...empty, mockEnabled: false, resumes: 1, bestResume: null }, NOW).find(
      (s) => s.id === "practice",
    );
    expect(step?.to).toBe("/start");
  });

  it("puts an interview in the next few days before everything else", () => {
    const tracker = [job({ status: "interviewing", company: "Bosch", next_at: inHours(20), document_id: "d1" })];
    const [first] = nextSteps(answers({ goal: "resume" }), { ...empty, tracker }, NOW);
    expect(first).toMatchObject({
      id: "interview-soon",
      title: "Practise for your Bosch interview",
      to: "/mock?jd=d1&role=SDE-1&company=Bosch",
    });
    expect(first?.body).toMatch(/^It's tomorrow\./);
  });

  it("suggests a follow-up a week after applying", () => {
    const tracker = [job({ applied_at: daysAgo(9) })];
    const steps = nextSteps(answers({ goal: "jobs" }), { ...empty, tracker, resumes: 1, bestResume: { id: "r", score: 85 } }, NOW);
    expect(steps[0]).toMatchObject({ id: "follow-up", title: "Follow up with Razorpay" });
    expect(steps[0]?.body).toContain("9 days ago");
  });

  it("returns every open step once, with no 'done' flag on them", () => {
    const steps = nextSteps(null, empty, NOW);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) expect(s).not.toHaveProperty("done");
  });
});

describe("practiceHref", () => {
  it("keeps only the parts that are known", () => {
    expect(practiceHref()).toBe("/mock");
    expect(practiceHref({ preset: "hr5", role: "  " })).toBe("/mock?preset=hr5");
    expect(practiceHref({ jd: "d1", role: "SDE 1", company: "Bosch" })).toBe("/mock?jd=d1&role=SDE+1&company=Bosch");
  });
});

describe("interviewSoon and followUpsDue", () => {
  it("only counts interviews from earlier today to three days out", () => {
    expect(interviewSoon([job({ status: "interviewing", next_at: inHours(80) })], NOW)).toBeNull();
    expect(interviewSoon([job({ status: "interviewing", next_at: inHours(-30) })], NOW)).toBeNull();
    expect(interviewSoon([job({ status: "applied", next_at: inHours(5) })], NOW)).toBeNull();
    const a = job({ id: "a", status: "interviewing", next_at: inHours(40) });
    const b = job({ id: "b", status: "interviewing", next_at: inHours(4) });
    expect(interviewSoon([a, b], NOW)?.id).toBe("b");
  });

  it("waits a week and respects a follow-up planned for later", () => {
    expect(followUpsDue([job({ applied_at: daysAgo(3) })], NOW)).toHaveLength(0);
    expect(followUpsDue([job({ applied_at: daysAgo(8), next_at: inHours(24) })], NOW)).toHaveLength(0);
    const old = job({ id: "old", applied_at: daysAgo(20) });
    const newer = job({ id: "newer", applied_at: daysAgo(8) });
    expect(followUpsDue([newer, old], NOW).map((t) => t.id)).toEqual(["old", "newer"]);
  });
});

describe("checklist", () => {
  it("starts with the account ticked and has five steps after it", () => {
    const list = checklist(null, empty);
    expect(list).toHaveLength(6);
    expect(list[0]).toMatchObject({ id: "account", done: true });
    expect(list.slice(1).every((i) => !i.done)).toBe(true);
  });

  it("orders the steps for the goal", () => {
    expect(checklist(answers({ goal: "jobs" }), empty)[1]?.id).toBe("jobs");
    expect(checklist(answers({ goal: "interview" }), empty).map((i) => i.id)).toEqual(["account", "resume", "practice", "story", "live", "jobs"]);
  });

  it("ticks steps from real data", () => {
    const list = checklist(null, { ...empty, resumeDocs: 1, mocks: 2, tracker: [job()] });
    const done = Object.fromEntries(list.map((i) => [i.id, i.done]));
    expect(done).toMatchObject({ resume: true, practice: true, jobs: true, story: false, live: false });
  });
});

describe("prefsFromAnswers (the Jobs AI profile)", () => {
  it("puts the role first and the city in, keeping the rest", () => {
    const next = prefsFromAnswers(prefs, answers());
    expect(next.titles).toEqual(["Data analyst", "Analyst"]);
    expect(next.locations).toEqual(["Pune"]);
    expect(next.level).toBe("fresher");
    expect(next.years).toBe(0);
    expect(next.skills).toEqual(["SQL"]);
    expect(next.portals).toEqual(["linkedin"]);
  });

  it("doesn't repeat a role that's already there", () => {
    expect(prefsFromAnswers(prefs, answers({ role: "  analyst " })).titles).toEqual(["analyst"]);
  });

  it("makes Remote a work mode, not a city", () => {
    const next = prefsFromAnswers(prefs, answers({ place: "Remote" }));
    expect(next.workplace).toEqual(["remote"]);
    expect(next.locations).toEqual([]);
  });

  it("leaves what wasn't answered alone", () => {
    const next = prefsFromAnswers(prefs, answers({ role: "", place: null, experience: null }));
    expect(next).toEqual(prefs);
  });

  it("maps experience to the profile's levels", () => {
    expect(prefsFromAnswers(prefs, answers({ experience: "early" }))).toMatchObject({ level: "junior", years: 2 });
    expect(prefsFromAnswers({ ...prefs, years: 2.5 }, answers({ experience: "early" })).years).toBe(2.5);
    expect(prefsFromAnswers(prefs, answers({ experience: "experienced" }))).toMatchObject({ level: "mid", years: null });
  });
});

describe("goalFromPath and presetFor", () => {
  it("reads the goal from where they were going", () => {
    expect(goalFromPath("/resume-ai")).toBe("resume");
    expect(goalFromPath("/resume-ai/abc")).toBe("resume");
    expect(goalFromPath("/jobs/matches")).toBe("jobs");
    expect(goalFromPath("/warmup")).toBe("interview");
    expect(goalFromPath("/jobsearch")).toBeNull();
    expect(goalFromPath(null)).toBeNull();
  });

  it("starts freshers and the unknown on the HR round", () => {
    expect(presetFor(null)).toBe("hr5");
    expect(presetFor({ experience: "fresher" })).toBe("hr5");
  });
});

describe("saved answers", () => {
  function memory(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it("round-trips per account", () => {
    const store = memory();
    saveAnswers("u1", answers(), store);
    expect(loadAnswers("u1", store)).toEqual(answers());
    expect(loadAnswers("u2", store)).toBeNull();
    expect([...store.data.keys()]).toEqual([answersKey("u1")]);
  });

  it("ignores junk instead of throwing", () => {
    const store = memory();
    store.setItem(answersKey("u1"), "{not json");
    expect(loadAnswers("u1", store)).toBeNull();
    store.setItem(answersKey("u1"), JSON.stringify({ goal: "dance", experience: 3, role: 7, place: "" }));
    expect(loadAnswers("u1", store)).toMatchObject({ goal: null, experience: null, role: "", place: null, status: "done" });
  });

  it("works without storage", () => {
    expect(loadAnswers("u1", null)).toBeNull();
    expect(() => saveAnswers("u1", answers(), null)).not.toThrow();
  });
});
