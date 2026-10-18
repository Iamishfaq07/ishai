import { safeLocal } from "@orbit/ui";

/** The welcome tour (Onboarding.tsx): shown once per device after the first sign-in, skippable, replayable. */
const KEY = "orbit.desktop.onboarded";

export function onboardingDone(): boolean {
  return safeLocal.getItem(KEY) !== null;
}

/** Finished or skipped: either way it doesn't come back by itself. */
export function finishOnboarding(how: "finished" | "skipped"): void {
  safeLocal.setItem(KEY, how);
}

/** Settings → About → "Show the welcome tour again". */
export function replayOnboarding(): void {
  safeLocal.removeItem(KEY);
}

/** Where the tour goes next: Back and Next stay inside it; the last step's Next finishes it. */
export function tourStep(current: number, count: number, move: -1 | 1): { step: number; done: boolean } {
  const next = current + move;
  if (next >= count) return { step: count - 1, done: true };
  return { step: Math.max(0, next), done: false };
}
