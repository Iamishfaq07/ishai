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

export function clearLegacyBrowserAccount(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing was kept there either
  }
}
