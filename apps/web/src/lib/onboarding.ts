import type { JobLevel, JobPrefs, JobTrackerEntry } from "@orbit/types";
import type { PresetId } from "../pages/mockPresets";

/**
 * First run: the three welcome questions (what you're here for, your experience and role, where you want to work), and
 * what Home suggests next from those answers and what the account already has. Pure, apart from the small storage
 * helpers, so the choices are unit-tested (onboarding.test.ts). No migration: the answers stay in this browser (per
 * account), and the role and city also go to the Jobs AI search profile, whose `prefs` is JSON already.
 */

export type Goal = "interview" | "resume" | "jobs";
export type Experience = "fresher" | "early" | "experienced";
/** Each product's colour and mark (components/products.tsx). */
/** The products the nav shows: the interview copilot (live help), Practice (mock interviews and the story bank),
 *  Resume AI and Jobs AI. The welcome question's goals stay three: "interview" covers practising and live help. */
export type ProductId = "interview" | "practice" | "resume" | "jobs";

export interface WelcomeAnswers {
  goal: Goal | null;
  experience: Experience | null;
  /** The job they want, as typed or picked ("Data analyst"); "" when not given. */
  role: string;
  /** A city ("Pune"), "India" (anywhere in India) or "Remote"; null when not given. */
  place: string | null;
  /** "done" after the last question; "skipped" when they skipped the rest. */
  status: "done" | "skipped";
  at: string;
}

export const REMOTE = "Remote";
/** The Jobs AI profile's "anywhere in India" (job_portal/profile.py ANYWHERE_IN_INDIA). */
export const ANYWHERE_IN_INDIA = "India";

export const GOALS: Array<{ id: Goal; title: string; body: string }> = [
  { id: "interview", title: "Prepare for an interview", body: "Practise out loud and get a score, or get help during a call." },
  { id: "resume", title: "Get my resume ready", body: "See how screening software reads it, then fix what's weak." },
  { id: "jobs", title: "Find jobs", body: "New openings that fit you, straight from companies' career pages." },
];

export const EXPERIENCE: Array<{ id: Experience; title: string; body: string }> = [
  { id: "fresher", title: "Fresher or student", body: "Less than a year of work" },
  { id: "early", title: "1 to 3 years", body: "Early in my career" },
  { id: "experienced", title: "3 years or more", body: "Experienced" },
];

/** A few common first roles, so most people tap instead of typing. */
export const ROLE_IDEAS: Record<Experience, string[]> = {
  fresher: ["Software developer", "Data analyst", "Customer support", "Sales executive", "Business analyst", "HR executive"],
  early: ["Software engineer", "Data analyst", "Business analyst", "Digital marketing", "Customer success", "Accountant"],
  experienced: ["Senior software engineer", "Product manager", "Data scientist", "Engineering manager", "Sales manager", "Project manager"],
};

/** The cities most jobs are in (canonical names, as Jobs AI's profile spells them). */
export const PLACE_IDEAS = ["Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai", "Delhi", "Gurugram", "Noida", "Kolkata"];

const LEVEL: Record<Experience, JobLevel> = { fresher: "fresher", early: "junior", experienced: "mid" };

/** The one-tap mock interview each kind of candidate starts with (Practice reads `?preset=`). */
export type MockPreset = Exclude<PresetId, "salary">;
export function presetFor(answers: Pick<WelcomeAnswers, "experience"> | null): MockPreset {
  if (answers?.experience === "experienced") return "tech15";
  if (answers?.experience === "early") return "tmay10";
  return "hr5";
}

/** Where someone was headed when they signed up says what they came for (Resume AI's "Start free" → resume). */
export function goalFromPath(path: string | null | undefined): Goal | null {
  if (!path) return null;
  if (/^\/resume-ai(\/|$)/.test(path)) return "resume";
  if (/^\/jobs(\/|$)/.test(path)) return "jobs";
  if (/^\/(warmup|mock|start|sessions)(\/|$)/.test(path)) return "interview";
  return null;
}

/** The Jobs AI search profile with the welcome answers in it: the role first among the titles, and the place. */
export function prefsFromAnswers(base: JobPrefs, answers: WelcomeAnswers): JobPrefs {
  const next: JobPrefs = { ...base };
  const role = answers.role.trim().replace(/\s+/g, " ").slice(0, 80);
  if (role) {
    const rest = base.titles.filter((t) => t.toLowerCase() !== role.toLowerCase());
    next.titles = [role, ...rest].slice(0, 8);
  }
  if (answers.place === REMOTE) {
    next.workplace = ["remote"];
    next.locations = [];
  } else if (answers.place) {
    next.locations = [answers.place];
  }
  if (answers.experience) {
    next.level = LEVEL[answers.experience];
    if (answers.experience === "fresher") next.years = 0;
    else if (base.years === null && answers.experience === "early") next.years = 2;
  }
  return next;
}

/** True when the answers say anything the job search can use. */
export function answersShapeJobSearch(answers: WelcomeAnswers): boolean {
  return Boolean(answers.role.trim() || answers.place || answers.experience);
}

// ─── What the account has, and what to do next ────────────────────────────────────────────────────────────────────

export type TrackedJob = Pick<JobTrackerEntry, "id" | "company" | "title" | "status" | "applied_at" | "next_at" | "document_id">;

export interface HomeFacts {
  /** Resume AI resumes, with the best one's score and id. */
  resumes: number;
  bestResume: { id: string; score: number } | null;
  /** Resumes uploaded to Documents (they count as having a resume). */
  resumeDocs: number;
  /** Mock interviews and live sessions, any state. */
  mocks: number;
  lives: number;
  stories: number;
  jobProfileSaved: boolean;
  tracker: TrackedJob[];
  /** Practice (mock interviews) is on in this build. */
  mockEnabled: boolean;
}

export type StepId =
  | "interview-soon"
  | "follow-up"
  | "warmup"
  | "resume"
  | "improve-resume"
  | "practice"
  | "story"
  | "live"
  | "matches"
  | "job-profile";

export interface Step {
  id: StepId;
  product: ProductId;
  title: string;
  body: string;
  /** What the button says. */
  cta: string;
  to: string;
  /** "About 1 minute": how long it takes, when that helps decide. */
  time?: string;
}

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(fromIso).getTime()) / DAY_MS);
}

/** "today", "tomorrow", "on Fri 10 Oct". */
function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `on ${d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`;
}

/** An interview on the tracker in the next 3 days (or earlier today). */
export function interviewSoon(tracker: TrackedJob[], now: Date): TrackedJob | null {
  const soon = tracker
    .filter((t) => t.status === "interviewing" && t.next_at)
    .filter((t) => {
      const at = new Date(t.next_at as string).getTime();
      return at >= now.getTime() - DAY_MS / 2 && at <= now.getTime() + 3 * DAY_MS;
    })
    .sort((a, b) => new Date(a.next_at as string).getTime() - new Date(b.next_at as string).getTime());
  return soon[0] ?? null;
}

/** Applications a week old or more with no reply recorded and no follow-up planned for later. Oldest first. */
export function followUpsDue(tracker: TrackedJob[], now: Date): TrackedJob[] {
  return tracker
    .filter((t) => t.status === "applied" && t.applied_at && daysBetween(t.applied_at, now) >= 7)
    .filter((t) => !t.next_at || new Date(t.next_at).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.applied_at as string).getTime() - new Date(b.applied_at as string).getTime());
}

/** Every step there is, each with whether it's done, phrased for these answers. */
function catalogue(answers: WelcomeAnswers | null, facts: HomeFacts, now: Date): Array<Step & { done: boolean }> {
  const hasResume = facts.resumes > 0 || facts.resumeDocs > 0;
  const fresher = answers?.experience === "fresher";
  const preset = presetFor(answers);
  const role = answers?.role.trim();
  const place = answers?.place;
  const where = place === REMOTE ? "remote " : "";
  const inPlace = place && place !== REMOTE && place !== ANYWHERE_IN_INDIA ? ` in ${place}` : "";
  const steps: Array<Step & { done: boolean }> = [];

  const soon = interviewSoon(facts.tracker, now);
  if (soon) {
    steps.push({
      id: "interview-soon",
      product: "practice",
      title: `Practise for your ${soon.company} interview`,
      body: `It's ${whenLabel(soon.next_at as string, now)}. A mock interview on their job post shows what to work on.`,
      cta: "Practise now",
      to: facts.mockEnabled ? (soon.document_id ? `/mock?jd=${encodeURIComponent(soon.document_id)}` : "/mock") : "/start",
      done: false,
    });
  }
  steps.push({
    id: "warmup",
    product: "practice",
    title: "Answer one practice question",
    body: "Type or say your answer and see what to improve. It's free and doesn't use your interview minutes.",
    cta: "Try a question",
    to: "/warmup",
    time: "2 minutes",
    done: facts.mocks > 0 || facts.lives > 0,
  });
  steps.push({
    id: "resume",
    product: "resume",
    title: "Add your resume",
    body: "Import the one you have, or start from a template. Orbit uses it for your answers, your ATS score and your job matches.",
    cta: "Add my resume",
    to: "/resume-ai",
    time: "About 1 minute",
    done: hasResume,
  });
  if (facts.bestResume) {
    steps.push({
      id: "improve-resume",
      product: "resume",
      title: `Raise your ATS score from ${facts.bestResume.score}`,
      body: "Resume AI shows what screening software misses in your resume and helps you fix it, one change at a time.",
      cta: "Improve my resume",
      to: `/resume-ai/${encodeURIComponent(facts.bestResume.id)}`,
      done: facts.bestResume.score >= 80,
    });
  }
  steps.push({
    id: "practice",
    product: "practice",
    title: fresher || !answers?.experience ? "Do a 5-minute HR round" : preset === "tmay10" ? "Do a 10-minute practice interview" : "Do a 15-minute technical round",
    body: "An AI interviewer asks, you answer out loud, then you get a score and the answers worth redoing.",
    cta: "Start practising",
    to: facts.mockEnabled ? `/mock?preset=${preset}` : "/start",
    time: preset === "hr5" ? "5 minutes" : preset === "tmay10" ? "10 minutes" : "15 minutes",
    done: facts.mocks > 0,
  });
  steps.push({
    id: "matches",
    product: "jobs",
    title: role ? `See ${where}${role} jobs${inPlace}` : `See ${where}jobs that fit you${inPlace}`,
    body: hasResume
      ? "New openings from companies' own career pages, ranked by how well they match your resume."
      : "New openings from companies' own career pages. Add your resume later to see how well you match each one.",
    cta: "See my matches",
    to: "/jobs/matches",
    done: facts.tracker.length > 0,
  });
  steps.push({
    id: "job-profile",
    product: "jobs",
    title: "Tell Jobs AI what you're looking for",
    body: "Your role, city and experience, so the feed shows jobs you'd actually apply to.",
    cta: "Set up my search",
    to: "/jobs/profile",
    time: "1 minute",
    done: facts.jobProfileSaved,
  });
  const due = followUpsDue(facts.tracker, now)[0];
  if (due && due.applied_at) {
    steps.push({
      id: "follow-up",
      product: "jobs",
      title: `Follow up with ${due.company}`,
      body: `You applied ${daysBetween(due.applied_at, now)} days ago. A short, polite note can move things along.`,
      cta: "Open the tracker",
      to: "/jobs/tracker",
      done: false,
    });
  }
  steps.push({
    id: "story",
    product: "practice",
    title: "Write one story for “Tell me about a time…”",
    body: "A real example from your college, internship or job, ready for the questions everyone asks.",
    cta: "Add a story",
    to: "/documents/stories",
    time: "3 minutes",
    done: facts.stories > 0,
  });
  steps.push({
    id: "live",
    product: "interview",
    title: "Test a live session",
    body: "Check your mic and the interviewer's audio before a real call, so nothing surprises you.",
    cta: "Run a test",
    to: "/start",
    time: "2 minutes",
    done: facts.lives > 0,
  });
  return steps;
}

const ORDER: Record<Goal | "none", StepId[]> = {
  interview: ["interview-soon", "warmup", "resume", "practice", "story", "live", "follow-up", "matches"],
  resume: ["interview-soon", "resume", "improve-resume", "matches", "follow-up", "practice", "story"],
  jobs: ["interview-soon", "matches", "resume", "follow-up", "improve-resume", "practice", "job-profile"],
  none: ["interview-soon", "resume", "practice", "matches", "follow-up", "story", "live"],
};

/**
 * What Home suggests, most useful first: an interview coming up beats everything, then the steps for what they came
 * for, in order, skipping what's done. The first is "Your next step"; the next two are the "then" links.
 */
export function nextSteps(answers: WelcomeAnswers | null, facts: HomeFacts, now = new Date()): Step[] {
  const all = catalogue(answers, facts, now);
  const byId = new Map(all.map((s) => [s.id, s]));
  const order = ORDER[answers?.goal ?? "none"];
  const out: Step[] = [];
  for (const id of order) {
    const step = byId.get(id);
    if (!step || step.done) continue;
    // The warm-up is the first step for someone who hasn't practised at all; once a resume is in, the real mock is.
    if (id === "warmup" && (facts.resumes > 0 || facts.resumeDocs > 0)) continue;
    const { done: _done, ...rest } = step;
    out.push(rest);
  }
  return out;
}

export interface ChecklistItem {
  id: "account" | "resume" | "practice" | "story" | "jobs" | "live";
  title: string;
  to: string;
  done: boolean;
}

/**
 * "Get set up": five things across the three products, after "Create your account", which is ticked already (a
 * started list gets finished more often than an empty one). Ordered for what they came for.
 */
export function checklist(answers: WelcomeAnswers | null, facts: HomeFacts): ChecklistItem[] {
  const items: Record<Exclude<ChecklistItem["id"], "account">, ChecklistItem> = {
    resume: { id: "resume", title: "Add your resume", to: "/resume-ai", done: facts.resumes > 0 || facts.resumeDocs > 0 },
    practice: {
      id: "practice",
      title: facts.mockEnabled ? "Do a practice interview" : "Try a practice question",
      to: facts.mockEnabled ? `/mock?preset=${presetFor(answers)}` : "/warmup",
      done: facts.mocks > 0,
    },
    story: { id: "story", title: "Add a story", to: "/documents/stories", done: facts.stories > 0 },
    jobs: { id: "jobs", title: "Set up your job search", to: "/jobs/profile", done: facts.jobProfileSaved || facts.tracker.length > 0 },
    live: { id: "live", title: "Test a live session", to: "/start", done: facts.lives > 0 },
  };
  const order: Record<Goal | "none", Array<keyof typeof items>> = {
    interview: ["resume", "practice", "story", "live", "jobs"],
    resume: ["resume", "jobs", "practice", "story", "live"],
    jobs: ["jobs", "resume", "practice", "story", "live"],
    none: ["resume", "practice", "jobs", "story", "live"],
  };
  return [
    { id: "account", title: "Create your account", to: "/settings", done: true },
    ...order[answers?.goal ?? "none"].map((k) => items[k]),
  ];
}

// ─── Storage (this browser, per account) ──────────────────────────────────────────────────────────────────────────

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage blocked
  }
}

/** Per account: several people can sign in on one browser (a shared family laptop or a college lab). */
export function answersKey(userId: string): string {
  return `orbit.welcome.${userId}`;
}

const GOAL_IDS = new Set<Goal>(["interview", "resume", "jobs"]);
const EXPERIENCE_IDS = new Set<Experience>(["fresher", "early", "experienced"]);

/** The saved answers, or null (never answered, storage unavailable, or unreadable). */
export function loadAnswers(userId: string, store: KeyValueStore | null = browserStore()): WelcomeAnswers | null {
  try {
    const raw = store?.getItem(answersKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<WelcomeAnswers>;
    return {
      goal: v.goal && GOAL_IDS.has(v.goal) ? v.goal : null,
      experience: v.experience && EXPERIENCE_IDS.has(v.experience) ? v.experience : null,
      role: typeof v.role === "string" ? v.role.slice(0, 80) : "",
      place: typeof v.place === "string" && v.place ? v.place.slice(0, 60) : null,
      status: v.status === "skipped" ? "skipped" : "done",
      at: typeof v.at === "string" ? v.at : "",
    };
  } catch {
    return null;
  }
}

export function saveAnswers(userId: string, answers: WelcomeAnswers, store: KeyValueStore | null = browserStore()): void {
  try {
    store?.setItem(answersKey(userId), JSON.stringify(answers));
  } catch {
    // storage full or blocked: Home falls back to its general order
  }
}
