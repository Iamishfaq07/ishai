import type { JobMission, MissionStage } from "@orbit/types";
import { safeLocal } from "@orbit/ui";
export { missionPath } from "./paths";

export const MISSION_TOOLS = [
  { id: "fit", label: "Evidence & fit", group: "job" },
  { id: "resume", label: "Resume kit", group: "job" },
  { id: "company", label: "Company", group: "job" },
  { id: "interview", label: "Interview", group: "interview" },
  { id: "plan", label: "Prep plan", group: "interview" },
  { id: "practice", label: "Practice", group: "interview" },
  { id: "timeline", label: "Timeline", group: "progress" },
  { id: "offer", label: "Offer", group: "progress" },
] as const;
export type MissionTool = typeof MISSION_TOOLS[number]["id"];
export const MISSION_GROUPS = [
  { id: "job", label: "Job & resume", first: "fit" },
  { id: "interview", label: "Interview", first: "interview" },
  { id: "progress", label: "Progress & offer", first: "timeline" },
] as const;

/** One room, while retaining all existing ?tab= specialist deep links. */
export const ROOM_SECTIONS = [
  { id: "overview", label: "Overview", first: "fit" },
  { id: "application", label: "Application", first: "resume" },
  { id: "prepare", label: "Prepare with Saba", first: "practice" },
  { id: "interviews", label: "Interviews", first: "interview" },
  { id: "offer", label: "Offer", first: "offer" },
] as const;
export function roomSection(tool: MissionTool): typeof ROOM_SECTIONS[number]["id"] {
  if (tool === "resume" || tool === "timeline") return "application";
  if (tool === "practice" || tool === "plan") return "prepare";
  if (tool === "interview") return "interviews";
  if (tool === "offer") return "offer";
  return "overview";
}

/** The Mission Room's stages, in the order a job is won; each is done only on a record (job_portal/mission.py). */
export const MISSION_STAGES: Array<{ id: MissionStage; label: string; done: string }> = [
  { id: "discover", label: "Discover", done: "Saved to your tracker" },
  { id: "prove", label: "Prove", done: "Fit checked against your resume" },
  { id: "prepare", label: "Prepare", done: "Resume linked, job post saved or a practice round done" },
  { id: "apply", label: "Apply", done: "Applied" },
  { id: "interview", label: "Interview", done: "Interviewing, or a live round with them" },
  { id: "negotiate", label: "Negotiate", done: "An offer" },
];

/** "3 of 6": how many stages have a record (a count of facts, never a percentage of readiness). */
export function stagesDone(m: Pick<JobMission, "stages">): number {
  return MISSION_STAGES.filter((s) => m.stages[s.id]).length;
}

/** A requirement's status in words and tone: met, partly met, or not shown on the resume. */
export function requirementTone(status: string): { label: string; tone: "good" | "partial" | "missing" } {
  if (status === "met") return { label: "Shown", tone: "good" };
  if (status === "partial") return { label: "Partly", tone: "partial" };
  return { label: "Not shown", tone: "missing" };
}

// "Not now" on the next step: hidden for 3 days, per account and job, on this device.
const SNOOZE_KEY = "orbit.mission.snooze";
const SNOOZE_MS = 3 * 86_400_000;
type Snoozes = Record<string, { key: string; until: number }>;

function read(userId: string): Snoozes {
  try {
    const all = JSON.parse(safeLocal.getItem(SNOOZE_KEY) ?? "{}") as Record<string, Snoozes>;
    return all[userId] && typeof all[userId] === "object" ? all[userId] : {};
  } catch {
    return {};
  }
}

export function isSnoozed(userId: string, entryId: string, key: string, now = Date.now()): boolean {
  const s = read(userId)[entryId];
  return Boolean(s && s.key === key && s.until > now);
}

export function snooze(userId: string, entryId: string, key: string, now = Date.now()): void {
  let all: Record<string, Snoozes>;
  try {
    all = JSON.parse(safeLocal.getItem(SNOOZE_KEY) ?? "{}") as Record<string, Snoozes>;
  } catch {
    all = {};
  }
  all[userId] = { ...read(userId), [entryId]: { key, until: now + SNOOZE_MS } };
  safeLocal.setItem(SNOOZE_KEY, JSON.stringify(all));
}
