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
];

// This tab only. A warm-up in progress has the person's answers; the next account in the tab must not see them.
const SESSION_KEYS = ["orbit.warmupRound"];

function drop(storage: Storage, keys: readonly string[]): void {
  for (const key of keys) storage.removeItem(key);
}

export function clearLegacyBrowserAccount(): void {
  try {
    drop(localStorage, LEGACY_KEYS);
  } catch {
    // storage unavailable: nothing was kept there either
  }
  try {
    drop(sessionStorage, SESSION_KEYS);
  } catch {
    // session storage unavailable
  }
}
