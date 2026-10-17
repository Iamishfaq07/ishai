import { missionPath } from "../mission";

/**
 * Where interview day lives: a tracked job's interview prep (the Mission Room's Interview tab) and the copilot's setup
 * with that job loaded (`/start?application=`, read by SessionSetup through FromTracker.tsx).
 */
export const INTERVIEW_TAB = "interview";

export function interviewPrepPath(entryId: string): string {
  return `${missionPath(entryId)}?tab=${INTERVIEW_TAB}`;
}

export function copilotPath(entryId: string): string {
  return `/start?application=${encodeURIComponent(entryId)}`;
}
