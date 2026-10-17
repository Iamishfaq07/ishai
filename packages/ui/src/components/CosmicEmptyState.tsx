import type { ReactNode } from "react";
import { cx } from "./cx";
import { EmptyState, type EmptyStateProps } from "./ui";
import { AnswersScene } from "./scenes/AnswersScene";
import { BillingScene } from "./scenes/BillingScene";
import { CelebrationScene } from "./scenes/CelebrationScene";
import { CodeScene } from "./scenes/CodeScene";
import { CopilotScene } from "./scenes/CopilotScene";
import { DocumentsScene } from "./scenes/DocumentsScene";
import { EvidenceScene } from "./scenes/EvidenceScene";
import { InboxScene } from "./scenes/InboxScene";
import { InterviewDayScene } from "./scenes/InterviewDayScene";
import { JobsScene } from "./scenes/JobsScene";
import { LearningScene } from "./scenes/LearningScene";
import { LinkedInScene } from "./scenes/LinkedInScene";
import { NoResultsScene } from "./scenes/NoResultsScene";
import { OfferScene } from "./scenes/OfferScene";
import { ReferralScene } from "./scenes/ReferralScene";
import { SecurityScene } from "./scenes/SecurityScene";
import { StoriesScene } from "./scenes/StoriesScene";
import { TrackerScene } from "./scenes/TrackerScene";
import { OfflineScene } from "./scenes/OfflineScene";
import { PracticeScene } from "./scenes/PracticeScene";
import { ResumeScene } from "./scenes/ResumeScene";
import { VideoScene } from "./scenes/VideoScene";
import { WelcomeScene } from "./scenes/WelcomeScene";

export type CosmicEmptyVariant =
  | "jobs"
  | "offline"
  | "no-results"
  | "resume"
  | "practice"
  | "copilot"
  | "quiet"
  | "tracker"
  | "offers"
  | "stories"
  | "answers"
  | "evidence"
  | "documents"
  | "capture-recovery"
  | "support"
  | "linkedin"
  | "code"
  | "learning"
  | "video"
  | "billing"
  | "security"
  | "people"
  | "inbox"
  | "interview-day"
  | "success";

/** Which Orbit scene each variant shows: the star-atlas line drawings (scenes/), the same in both themes and every
 *  accent, with no glow. */
const ART: Record<CosmicEmptyVariant, () => ReactNode> = {
  jobs: () => <JobsScene />,
  offline: () => <OfflineScene />,
  "no-results": () => <NoResultsScene />,
  copilot: () => <CopilotScene />,
  quiet: () => <CopilotScene quiet />,
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
  linkedin: () => <LinkedInScene />,
  code: () => <CodeScene />,
  learning: () => <LearningScene />,
  video: () => <VideoScene />,
  billing: () => <BillingScene />,
  security: () => <SecurityScene />,
  people: () => <ReferralScene />,
  inbox: () => <InboxScene />,
  "interview-day": () => <InterviewDayScene />,
  success: () => <CelebrationScene />,
};

/** A variant's scene on its own, sized by `className` (a page header's `art`, a card's corner). Decorative. */
export function SceneArt({ variant, className }: { variant: CosmicEmptyVariant; className?: string }) {
  return <div className={className}>{ART[variant]()}</div>;
}

/**
 * An EmptyState with one of the Orbit scenes in place of an icon, one per product's main empty screen: `copilot`
 * (a headset and its transcript; `quiet`, nothing heard), `tracker` (three ghost columns), `offers` (a letter and a
 * balance), `stories` (an open STAR book), `answers` (a kept answer), `evidence` (a quote under a shield), `documents`
 * (a fanned stack), `no-results` (a telescope on empty sky), `jobs` (a constellation of openings), `offline` and
 * `capture-recovery` (a dish losing its satellite: a source is down), `resume` (a page in orbit with its ATS ring),
 * `practice` (a microphone and its scorecard), `support` (Orbit and its moons), `linkedin` (a profile card and the
 * search that finds it), `code` (a code window and its tests), `learning` (a path of lessons), `video` (a call with
 * the interviewer), `billing` (a receipt and a credit), `security` (a shield, a key, a code), `people` (two people
 * and the link between them), `inbox` (a letter into the tray, a chat waiting), `interview-day` (a calendar and its
 * checklist), `success` (a ticked world, sparks thrown out). Decorative: the title and body say what the screen is.
 * Hovering the empty state nudges the scene's subject.
 */
export function CosmicEmptyState({ variant, className, ...props }: Omit<EmptyStateProps, "art" | "icon"> & { variant: CosmicEmptyVariant }) {
  return <EmptyState {...props} className={cx("scene-host", className)} art={<SceneArt variant={variant} className="w-44 sm:w-52" />} />;
}
