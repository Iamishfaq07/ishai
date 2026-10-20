import { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Briefcase, FileText, Gauge, IdCard, ListChecks, PenLine, Search, Target, Wand2, buttonClass } from "@orbit/ui";
import { LINKEDIN_AI_FAQ } from "../../../worker/faqs/linkedin-ai.js";
import { PRACTICE_PAGE } from "../../marketing/catalog";
import { CrossSell, FactsBand, FaqBlock, FinalCta, HeroShowcase, StepsWithUI, ToolkitGrid } from "../../marketing/kit";
import { PublicLayout } from "../../marketing/PublicLayout";
import { Eyebrow, Section } from "../../marketing/primitives";
import { StickyCta } from "../../marketing/StickyCta";
import { JOBS_AI_HOME } from "../jobs/paths";
import { RESUME_AI_HOME } from "../resume/paths";
import { HEADLINE_SHOWN, LINKEDIN_HOME } from "./model";
import { AboutArt, FixCardArt, FreeFixesArt, KeywordsArt, LinkedInHeroArt, PROFILE_AFTER, PROFILE_BEFORE, PasteStepArt, PdfStepArt, ScoreStepArt } from "./publicArt";
import { ScoreTrail } from "./ScorePanel";
import { SearchPreview } from "./SearchPreview";

/** Sign-up and sign-in from here come back to LinkedIn. */
const BACK_HERE = { from: LINKEDIN_HOME };

/**
 * /linkedin-ai: LinkedIn for signed-out visitors (the tool itself is /linkedin, signed in), built with the product
 * pages' section kit (DECISIONS D79): a sample profile's real score climbing as its fixes go in, the facts, three
 * steps, the fixes as working pieces, the real recruiter-search preview (switch it between before and after), the
 * questions, what comes next and one last action. Orbit's own drawing of everything, never LinkedIn's look or logo.
 */
export function LinkedInPublicPage() {
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  return (
    <PublicLayout authState={BACK_HERE} context="LinkedIn">
      <HeroShowcase
        product={{ id: "linkedin", name: "LinkedIn", icon: IdCard }}
        title={["See your profile", "as recruiters do."]}
        lead="LinkedIn scores your LinkedIn profile out of 100 for the role you want, section by section, and writes the fixes to paste in: the headline, the About, your latest roles, your skills and a clean URL. It keeps your numbers and never makes one up."
        ctas={heroCtas}
        actions={
          <>
            <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Score my profile free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/login" state={BACK_HERE} className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              I have an account
            </Link>
          </>
        }
        note={
          <p>
            <strong className="font-medium text-zinc-900 dark:text-white">The score and the free fixes cost nothing.</strong> An AI fix uses a fifth of a
            resume credit. LinkedIn is part of Orbit and isn't made by or connected to LinkedIn.
          </p>
        }
        visual={<LinkedInHeroArt />}
      />

      <FactsBand
        label="LinkedIn in numbers"
        facts={[
          { value: 100, label: "points, scored section by section" },
          { value: 7, label: "sections scored from LinkedIn's PDF of your profile" },
          { value: `~${HEADLINE_SHOWN}`, label: "characters of your headline a search result shows on a phone" },
          { value: "1/5", label: "of a resume credit for an AI fix; the free fixes cost nothing" },
        ]}
      />

      <StepsWithUI
        id="steps-title"
        eyebrow="How it works"
        title="From your profile to the fixes, in a few minutes."
        steps={[
          { title: "Save your profile as a PDF", text: "On LinkedIn's desktop site: Resources (or More) under your name, then Save to PDF. Upload it, or paste the profile's text instead.", ui: <PdfStepArt /> },
          { title: "See the score and the fixes", text: "Each section's points, and the fixes that raise the score most, first. Pick the role you want so the keywords are that role's.", ui: <ScoreStepArt /> },
          { title: "Paste them into LinkedIn", text: "Copy a fix, paste it where the steps say, and tick Done on LinkedIn. Orbit never signs in to LinkedIn or changes it.", ui: <PasteStepArt /> },
        ]}
      />

      <ToolkitGrid
        id="toolkit-title"
        eyebrow="The toolkit"
        title="Every fix, ready to paste."
        lead="Each one says what it changes, what it adds to the score, and exactly where it goes on LinkedIn."
        band
        tools={[
          { title: "Fixes ready to paste", icon: Wand2, text: "Before and after with the changed words marked, LinkedIn's character limit, Copy, and Done on LinkedIn once it's in.", widget: <FixCardArt />, wide: true },
          { title: "Search keywords", icon: Search, text: "The skills job posts for your target role ask for most, and which of them your profile shows.", widget: <KeywordsArt /> },
          { title: "The About, rewritten", icon: PenLine, text: "Your role and best result first, where they show before “see more”, from your own profile and resume.", widget: <AboutArt /> },
          { title: "Free fixes", icon: ListChecks, text: "A clean custom URL and your skills in the order to list them, worked out without AI.", widget: <FreeFixesArt /> },
          {
            title: "Where the fixes take you",
            icon: Gauge,
            text: "The score as read from LinkedIn, Orbit's copy with the fixes you've applied, and with every fix.",
            widget: (
              <div aria-hidden="true" inert>
                <ScoreTrail read={47} now={73} projected={94} />
              </div>
            ),
          },
        ]}
      />

      <Section label="The recruiter-search preview">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow className="mb-4">The recruiter-search preview</Eyebrow>
            <p className="mk-h3 text-zinc-950 dark:text-white">What a search result shows of you, before and after.</p>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
              A search result shows about the first {HEADLINE_SHOWN} characters of your headline on a phone, then your place and your current role. Switch the
              preview between your profile as LinkedIn has it and Orbit's copy with the fixes.
            </p>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <SearchPreview profile={PROFILE_AFTER} read={PROFILE_BEFORE} query="Data Analyst Bengaluru" />
          </div>
        </div>
      </Section>

      <FaqBlock id="faq-title" items={LINKEDIN_AI_FAQ} />

      <CrossSell
        id="next-title"
        eyebrow="The same account"
        title="A profile that's found, a resume that's read."
        lead="LinkedIn writes from the same resume Resume scores, and the jobs Jobs finds are the roles it tunes your profile for."
        items={[
          { product: { id: "resume", name: "Resume", icon: FileText }, title: "The resume behind the profile", text: "An ATS score out of 100 and a copy tailored for every job, every change shown.", to: RESUME_AI_HOME, cta: "See Resume" },
          { product: { id: "jobs", name: "Jobs", icon: Briefcase }, title: "Jobs for the role you're aiming at", text: "New openings from companies' careers pages, matched to your resume, with a tracker.", to: JOBS_AI_HOME, cta: "See Jobs" },
          { product: { id: "practice", name: "Practice", icon: Target }, title: "Ready when a recruiter calls", text: "A mock interview with an AI interviewer, then a score for every answer.", to: PRACTICE_PAGE, cta: "See mock interviews" },
        ]}
      />

      <FinalCta
        id="cta-title"
        innerRef={finalCta}
        title={["See what your profile scores.", "Then paste in the fixes."]}
        text="Create a free Orbit account, upload LinkedIn's PDF of your profile, and see its score and its fixes in a few minutes."
        primary={{ to: "/register", label: "Score my profile free", state: BACK_HERE }}
        secondary={{ to: "/login", label: "I have an account", state: BACK_HERE }}
        footnote="Not made by or connected to LinkedIn. Orbit never signs in to it."
      />
      <StickyCta after={heroCtas} before={finalCta} line="Your LinkedIn profile's score, free." />
    </PublicLayout>
  );
}
