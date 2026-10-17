import type { ReactNode } from "react";
import { EmptyState, type EmptyStateProps } from "./ui";
import { JobsScene } from "./scenes/JobsScene";
import { OfflineScene } from "./scenes/OfflineScene";
import { PracticeScene } from "./scenes/PracticeScene";
import { ResumeScene } from "./scenes/ResumeScene";
import { WelcomeScene } from "./scenes/WelcomeScene";

export type CosmicEmptyVariant = "jobs" | "offline" | "resume" | "practice" | "capture-recovery" | "support";

/** Which Orbit scene each variant shows: the star-atlas line drawings (scenes/), the same in both themes and every
 *  accent, with no glow. */
const ART: Record<CosmicEmptyVariant, () => ReactNode> = {
  jobs: () => <JobsScene />,
  offline: () => <OfflineScene />,
  resume: () => <ResumeScene />,
  practice: () => <PracticeScene />,
  "capture-recovery": () => <OfflineScene />,
  support: () => <WelcomeScene />,
};

/**
 * An EmptyState with one of the Orbit scenes in place of an icon: `jobs` (a constellation of openings), `offline` and
 * `capture-recovery` (a dish losing its satellite: a source is down), `resume` (a page in orbit with its ATS ring),
 * `practice` (a microphone and its scorecard), `support` (Orbit and its moons). Decorative: the title and body say
 * what the screen is.
 */
export function CosmicEmptyState({ variant, ...props }: Omit<EmptyStateProps, "art" | "icon"> & { variant: CosmicEmptyVariant }) {
  return <EmptyState {...props} art={<div className="w-44 sm:w-52">{ART[variant]()}</div>} />;
}
