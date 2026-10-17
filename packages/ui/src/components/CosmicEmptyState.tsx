import type { ReactNode } from "react";
import { EmptyState, type EmptyStateProps } from "./ui";
import { AnswersScene } from "./scenes/AnswersScene";
import { CopilotScene } from "./scenes/CopilotScene";
import { DocumentsScene } from "./scenes/DocumentsScene";
import { EvidenceScene } from "./scenes/EvidenceScene";
import { JobsScene } from "./scenes/JobsScene";
import { NoResultsScene } from "./scenes/NoResultsScene";
import { OfferScene } from "./scenes/OfferScene";
import { StoriesScene } from "./scenes/StoriesScene";
import { TrackerScene } from "./scenes/TrackerScene";
import { OfflineScene } from "./scenes/OfflineScene";
import { PracticeScene } from "./scenes/PracticeScene";
import { ResumeScene } from "./scenes/ResumeScene";
import { WelcomeScene } from "./scenes/WelcomeScene";

export type CosmicEmptyVariant =
  | "jobs"
  | "offline"
  | "no-results"
  | "resume"
  | "practice"
  | "copilot"
  | "tracker"
  | "offers"
  | "stories"
  | "answers"
  | "evidence"
  | "documents"
  | "capture-recovery"
  | "support";

/** Which Orbit scene each variant shows: the star-atlas line drawings (scenes/), the same in both themes and every
 *  accent, with no glow. */
const ART: Record<CosmicEmptyVariant, () => ReactNode> = {
  jobs: () => <JobsScene />,
  offline: () => <OfflineScene />,
  "no-results": () => <NoResultsScene />,
  copilot: () => <CopilotScene />,
  tracker: () => <TrackerScene />,
  offers: () => <OfferScene />,
  stories: () => <StoriesScene />,
  answers: () => <AnswersScene />,
  evidence: () => <EvidenceScene />,
  documents: () => <DocumentsScene />,
  resume: () => <ResumeScene />,
  practice: () => <PracticeScene />,
  "capture-recovery": () => <OfflineScene />,
  support: () => <WelcomeScene />,
};

/**
 * An EmptyState with one of the Orbit scenes in place of an icon, one per product's main empty screen: `copilot`
 * (a headset and its transcript), `tracker` (three ghost columns), `offers` (a letter and a balance), `stories` (an
 * open STAR book), `answers` (a kept answer), `evidence` (a quote under a shield), `documents` (a fanned stack),
 * `no-results` (a telescope on empty sky), `jobs` (a constellation of openings), `offline` and
 * `capture-recovery` (a dish losing its satellite: a source is down), `resume` (a page in orbit with its ATS ring),
 * `practice` (a microphone and its scorecard), `support` (Orbit and its moons). Decorative: the title and body say
 * what the screen is.
 */
export function CosmicEmptyState({ variant, ...props }: Omit<EmptyStateProps, "art" | "icon"> & { variant: CosmicEmptyVariant }) {
  return <EmptyState {...props} art={<div className="w-44 sm:w-52">{ART[variant]()}</div>} />;
}
