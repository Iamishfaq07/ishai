import { safeLocal, safeSession } from "@orbit/ui";
import { clearCandidateDrafts } from "./candidateDrafts";
// Things this browser used to keep once for everyone who signed in on it. They are cleared when the account
// changes (useAsync.ts). New copies are stored per account, so the next person doesn't inherit them.
const LEGACY_KEYS = [
  "orbit.support.v1",
  "orbit.support.seen",
  "orbit.support.v1.guest",
  "orbit.support.seen.guest",
  "orbit.checklistDismissed",
  "orbit.practiceGoal",
  "orbit.warmupLog",
  "orbit.workspaceId",
  "orbit.bullet-builder", "orbit.gap-explainer", "orbit.star-check.draft",
  "orbit.github-projects.user", "orbit.gd.history", "orbit.aptitude.history",
];

// This tab only. A warm-up in progress has the person's answers; the next account in the tab must not see them.
const SESSION_KEYS = ["orbit.warmupRound"];

function drop(storage: Pick<Storage, "removeItem">, keys: readonly string[]): void {
  for (const key of keys) storage.removeItem(key);
}

export function clearLegacyBrowserAccount(): void {
  clearCandidateDrafts();
  for (const key of safeLocal.keys()) if (key.startsWith("orbit.tool-local.")) safeLocal.removeItem(key);
  try {
    drop(safeLocal, LEGACY_KEYS);
  } catch {
    // storage unavailable: nothing was kept there either
  }
  try {
    drop(safeSession, SESSION_KEYS);
  } catch {
    // session storage unavailable
  }
}
