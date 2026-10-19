import type { ApplyAnswerSource, ApplyGroup, ApplyPacketStatus, ApplyWhyNot } from "@orbit/types";

/** Orbit Apply's words and small helpers, kept free of React so they're tested on their own (model.test.ts). */

export const SOURCE_LABEL: Record<ApplyAnswerSource, string> = {
  bank: "Your answers",
  profile: "Your profile",
  generated: "Written for this job",
};

export const GROUPS: Array<{ id: ApplyGroup; label: string; empty: string }> = [
  { id: "prepared", label: "Prepared", empty: "Nothing waiting to go. Find jobs to prepare some." },
  { id: "applied", label: "Applied", empty: "No applications sent yet." },
  { id: "needs_you", label: "Needs you", empty: "Nothing needs you right now." },
  { id: "skipped", label: "Skipped", empty: "Nothing skipped." },
];

export const STATUS_LABEL: Record<ApplyPacketStatus, string> = {
  needs_answer: "Needs your answer",
  review: "Waiting for your review",
  ready: "Ready to send",
  leased: "Sending now",
  submitted: "Applied by Orbit Apply",
  applied: "Applied by you",
  needs_you: "Needs you",
  handoff: "Apply on the job's site",
  failed: "Didn't go through",
  skipped: "Skipped",
  cancelled: "You chose not to apply",
  expired: "Not sent in time",
};

export const WHY_NOT: Record<ApplyWhyNot, string> = {
  not_set_up: "Orbit Apply isn't turned on yet.",
  paused: "Paused. Resume here or in the extension.",
  quiet_hours: "Quiet hours.",
  daily_limit: "Today's limit is reached.",
  busy: "One is being sent now.",
  pacing: "Waiting a few minutes between applications.",
  no_quota: "No applications left on your plan.",
  none: "Nothing prepared to send.",
};

export const ATS_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  recruitee: "Recruitee",
  board: "Job board",
  other: "Company site",
  orbit: "Orbit",
};

/** "a, b\nc" → ["a", "b", "c"]: trimmed, no blanks, no repeats (case-insensitive). */
export function parseList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const item = part.trim().replace(/\s+/g, " ");
    if (item && !out.some((o) => o.toLowerCase() === item.toLowerCase())) out.push(item);
  }
  return out;
}

export const listText = (items: string[]): string => items.join(", ");

/** A yes / no / not said question as a select's value, and back. */
export type Tri = "yes" | "no" | "";
export const toTri = (v: boolean | null | undefined): Tri => (v === true ? "yes" : v === false ? "no" : "");
export const fromTri = (v: string): boolean | null => (v === "yes" ? true : v === "no" ? false : null);

/** Minutes from midnight ↔ "HH:MM" for a time input. */
export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function timeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export const answerText = (value: string | string[]): string => (Array.isArray(value) ? value.join("; ") : value);

/** What the candidate can do with a packet in this status. */
export function actionsFor(status: ApplyPacketStatus): { approve: boolean; dontApply: boolean; retry: boolean; finish: boolean } {
  return {
    approve: status === "review",
    dontApply: ["needs_answer", "review", "ready", "needs_you", "handoff", "failed", "expired"].includes(status),
    retry: ["needs_you", "failed", "expired", "skipped", "cancelled"].includes(status),
    finish: status === "needs_you" || status === "handoff",
  };
}

/** Whether the browser extension is applying: Orbit Apply sends nothing without it. "never": it has never asked for
 *  work; "quiet": not for over 2 days (that browser closed, or auto-apply switched off there); "on": recently. */
export type ExecutorState = "never" | "quiet" | "on";
export const EXECUTOR_QUIET_MS = 2 * 24 * 3600_000;
export function executorState(seenAt: string | null | undefined, now = Date.now()): ExecutorState {
  const at = seenAt ? Date.parse(seenAt) : NaN;
  if (!Number.isFinite(at)) return "never";
  return now - at > EXECUTOR_QUIET_MS ? "quiet" : "on";
}
