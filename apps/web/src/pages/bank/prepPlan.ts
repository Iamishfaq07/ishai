// A day-by-day prep plan from a guide, up to the interview date (PrepPlan.tsx). Plain functions, so the plan, its
// calendar file and its text copy are the same everywhere and easy to test.
import { icsFold, icsText } from "../jobs/model";
import { RESUME_AI_HOME } from "../resume/paths";
import { companyMockLink, roleMockLink, warmupLink, type BankKind } from "./content";
import type { BankCompany, BankRole } from "./types";

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  /** Where to do it: a part of this guide ("#tips-title") or an Orbit page. */
  to: string;
  /** Needs an Orbit account (the free warm-up and the guide itself don't). */
  account: boolean;
}

export interface PlanDay {
  /** Local date, "2026-11-03". */
  date: string;
  steps: PlanStep[];
}

export interface Plan {
  days: PlanDay[];
  /** The interview day itself, last. */
  interview: string;
  /** The plan starts later than today when the interview is more than MAX_DAYS away. */
  starts: string;
}

/** The longest plan: past two weeks it starts later rather than spreading thin. */
export const MAX_DAYS = 14;

const DAY_MS = 86_400_000;

/** "2026-11-03" for a local date (no time zone shift, unlike toISOString). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Whole days from one local date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

/** What to do, most important first: everything comes from the guide itself. */
export function planSteps(kind: BankKind, entry: BankCompany | BankRole): PlanStep[] {
  const company = kind === "company";
  const name = entry.name;
  const mock = company ? companyMockLink(entry) : roleMockLink(entry as BankRole);
  const values = entry.looks_for.slice(0, 3).map((v) => v.split(":")[0]!.trim());
  return [
    { id: "process", title: `Read how ${company ? name : `${name.toLowerCase()} interviews`} interview${company ? "s" : ""}`, detail: `The ${entry.rounds.length} stages candidates report and what interviewers listen for.`, to: "#rounds-title", account: false },
    { id: "resume", title: "Fit your resume to the job post", detail: "Check its ATS score against the post and fix what's missing.", to: RESUME_AI_HOME, account: true },
    { id: "warmup", title: "Warm up on the guide's questions", detail: "Answer five out loud or by typing; see what to tighten.", to: warmupLink(kind, entry.slug), account: false },
    { id: "mine", title: "Get your likely questions from your resume", detail: "Orbit's AI writes them with answer outlines from your own experience.", to: "#my-questions", account: true },
    { id: "stories", title: "Write three stories", detail: `One each for: ${values.join("; ")}. Situation, what you did, the result.`, to: "/documents/stories", account: true },
    { id: "mock", title: company ? `Mock interview in ${name}'s style` : `A ${name.toLowerCase()} mock interview`, detail: "Out loud with the AI interviewer, then a scored report on every answer.", to: mock, account: true },
    { id: "fix", title: "Fix your weakest answers", detail: "Redo the two answers your report scored lowest, then warm up again.", to: warmupLink(kind, entry.slug), account: false },
    { id: "tips", title: "Go through the tips and your questions for them", detail: "Read the guide's tips and write two questions to ask at the end.", to: "#tips-title", account: false },
    { id: "mock2", title: "One more mock interview", detail: "A full run-through with follow-ups, timed like the real thing.", to: mock, account: true },
  ];
}

const REVIEW: PlanStep = { id: "review", title: "Light review and logistics", detail: "Skim your stories and the stages; check the time, place or link, and rest.", to: "#rounds-title", account: false };

/**
 * The plan from `today` to the interview: the steps spread over the days before it (several a day when time is short,
 * a free day here and there when it isn't), the day before kept light. Null when the date isn't in the future.
 */
export function buildPlan(kind: BankKind, entry: BankCompany | BankRole, interview: string, today: string): Plan | null {
  const away = daysBetween(today, interview);
  if (away < 1) return null;
  const n = Math.min(away, MAX_DAYS);
  const starts = addDays(interview, -n);
  const steps = planSteps(kind, entry);
  // The last day before the interview is the light review; the steps share the days before it (or that day too,
  // when there is only one).
  const working = Math.max(1, n - 1);
  const days: PlanDay[] = Array.from({ length: n }, (_, i) => ({ date: addDays(starts, i), steps: [] }));
  // Short plans drop the second mock first.
  const chosen = n <= 3 ? steps.filter((s) => s.id !== "mock2") : steps;
  chosen.forEach((step, i) => {
    days[Math.floor((i * working) / chosen.length)]!.steps.push(step);
  });
  days[n - 1]!.steps.push(REVIEW);
  return { days: days.filter((d) => d.steps.length), interview, starts };
}

/** All-day calendar events, one per plan day, plus the interview day. */
export function planIcs(plan: Plan, name: string, pageUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ymd = (iso: string) => iso.replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbit//Interview prep plan//EN", "CALSCALE:GREGORIAN"];
  const event = (iso: string, summary: string, description: string) => {
    lines.push("BEGIN:VEVENT", `UID:prep-${ymd(iso)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@orbitanswer.com`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(iso)}`, `DTEND;VALUE=DATE:${ymd(addDays(iso, 1))}`, `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(description)}`, "END:VEVENT");
  };
  for (const day of plan.days) {
    event(day.date, `${name} interview prep: ${day.steps.map((s) => s.title).join(", ")}`,
      day.steps.map((s) => `- ${s.title}: ${s.detail}`).join("\n") + `\n\nGuide: ${pageUrl}`);
  }
  event(plan.interview, `${name} interview`, `Good luck. Guide: ${pageUrl}`);
  return lines.concat("END:VCALENDAR").map(icsFold).join("\r\n") + "\r\n";
}

/** The plan as plain text, to copy into notes. */
export function planText(plan: Plan, name: string, dayLabel: (iso: string) => string): string {
  const out = [`${name} interview prep plan`];
  for (const day of plan.days) {
    out.push("", dayLabel(day.date), ...day.steps.map((s) => `- ${s.title}: ${s.detail}`));
  }
  out.push("", `${dayLabel(plan.interview)}: interview day`);
  return out.join("\n");
}
