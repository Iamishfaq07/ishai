import { useRef } from "react";
import { Link } from "react-router-dom";
import type { JobStats } from "@orbit/types";
import { ArrowRight, AudioLines, BookmarkCheck, Briefcase, Building2, CalendarCheck, FileText, Route, Search, Send, Target, buttonClass, cx, focusRing, formatNumber, isIndia } from "@orbit/ui";
import { JOBS_AI_FAQ } from "../../../worker/faqs/jobs.js";
import { COPILOT_PAGE, PRACTICE_PAGE } from "../../marketing/catalog";
import { CrossSell, FactsBand, FaqBlock, FinalCta, HeroShowcase, StepsWithUI, ToolkitGrid, usePublicData, type Fact } from "../../marketing/kit";
import { PublicLayout } from "../../marketing/PublicLayout";
import { IconTile, Section, SectionIntro } from "../../marketing/primitives";
import { SameBox } from "../../marketing/SameBox";
import { StickyCta } from "../../marketing/StickyCta";
import { useCountry } from "../../lib/country";
import { RESUME_AI_HOME } from "../resume/paths";
import { JOBS_AI_HOME } from "./paths";
import { InterviewDayArt, JobsHeroArt, MatchesStepArt, MissionArt, OutreachArt, ProfileStepArt, SourcesArt, TrackStepArt, TrackerArt } from "./publicArt";

/** Sign-up and sign-in from here come back to Jobs AI. */
const BACK_HERE = { from: JOBS_AI_HOME };

/** The big job sites Orbit links to (their own search, filled in), never reads. */
const PORTALS = ["LinkedIn", "Naukri", "Indeed", "Foundit", "Instahyre", "Cutshort", "Hirist", "Wellfound", "Internshala", "Google Jobs"];
// Outside India: the ones there are links to there (job_portal/portals.py).
const WORLD_PORTALS = ["LinkedIn", "Indeed", "Wellfound", "Google Jobs"];

/** Below this, the live count isn't worth a headline (a new server still fetching its first jobs). */
const SHOW_COUNTS_FROM = 50;

type Daily = Pick<JobStats, "fit_daily" | "profile_daily">;

/** The daily allowances as the server gives them today (orbit_api/config.py, production on 18 Oct 2026), only to
 *  size the hero's line until it answers (SameBox): never shown. */
const DAILY_LIKE: Daily = { fit_daily: 15, profile_daily: 5 };

/** What's free, said plainly, with the server's own daily allowances once it answers. */
function freeNote(stats: Daily | null) {
  return (
    <p>
      <strong className="font-medium text-zinc-900 dark:text-white">Free with an Orbit account.</strong> Browsing, matching and the tracker never use
      credits,{" "}
      {stats
        ? `and each day you get ${stats.fit_daily} AI fit checks and ${stats.profile_daily} AI reads of your resume, free.`
        : "and a few AI fit checks a day are free."}{" "}
      Outreach uses resume credits, and so do AI rewrites when you tailor a resume in Resume AI.
    </p>
  );
}

/**
 * The facts: the server's live counts once there are enough to say (GET /v1/jobs/stats), else what the code fixes:
 * the four applicant-tracking systems the feed reads (job_portal/companies.py) and the 30 days a post is kept
 * (job_portal/postings.py MAX_AGE); the free fit checks a day are the server's own number.
 */
function jobFacts(stats: JobStats | null, country: string): Fact[] {
  const counts = stats && stats.jobs >= SHOW_COUNTS_FROM ? stats : null;
  const facts: Fact[] = counts
    ? [
        { value: formatNumber(counts.jobs, country), label: `jobs posted in the last ${counts.days} days` },
        { value: formatNumber(counts.companies, country), label: isIndia(country) ? "companies hiring in India or remotely" : "companies hiring" },
      ]
    : [{ value: 30, label: "days at most: older posts are dropped" }];
  facts.push({ value: 4, label: "applicant-tracking systems read, straight from companies' careers pages" });
  facts.push(stats ? { value: stats.fit_daily, label: "free AI fit checks a day" } : { value: "Free", label: "matches and the application tracker" });
  return facts;
}

/**
 * Jobs AI for signed-out visitors (at /jobs, where a signed-in person gets their overview), built with the product
 * pages' section kit (DECISIONS D79): an example match being scored and checked, the facts, three steps, the toolkit
 * as working pieces of the product, where the jobs come from, the questions, what comes next and one last action.
 * The only calls are the public numbers (GET /v1/jobs/stats) and the free allowance; nothing here calls the AI.
 */
export function JobsAiPublicPage() {
  const country = useCountry();
  const india = isIndia(country);
  const { stats } = usePublicData({ prices: false });
  const feeds = stats?.feeds.length ? stats.feeds : ["Himalayas", "Remote OK", "Jobicy"];
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  return (
    <PublicLayout authState={BACK_HERE} context="Jobs AI">
      <HeroShowcase
        product={{ id: "jobs", name: "Jobs AI", icon: Briefcase }}
        title={["Find jobs that", "fit your resume."]}
        lead="The latest openings from companies' own careers pages and remote job boards, ranked by how well they match you, with a free AI fit check for each one. You apply on the company's own site."
        ctas={heroCtas}
        actions={
          <>
            <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              See my matches free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/login" state={BACK_HERE} className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              I have an account
            </Link>
          </>
        }
        note={<SameBox like={freeNote(stats ?? DAILY_LIKE)} answered={stats && [stats.fit_daily, stats.profile_daily]}>{freeNote(stats)}</SameBox>}
        visual={<JobsHeroArt />}
      />

      <FactsBand label="Jobs AI in numbers" facts={jobFacts(stats, country)} />

      <StepsWithUI
        id="steps-title"
        eyebrow="How it works"
        title="From resume to matches in a minute or two."
        steps={[
          { title: "Add your resume", text: "Import the one you have (PDF, Word or LinkedIn's PDF), or make one in Resume AI. The AI reads it into a search profile you can change.", ui: <ProfileStepArt /> },
          { title: "See your matches", text: "Every new job is scored against your profile, best first, with the skills you have and the ones it asks for that you don't show.", ui: <MatchesStepArt /> },
          { title: "Apply and keep track", text: "Check your fit, ask for a referral, apply on the company's site, and move each application along your tracker.", ui: <TrackStepArt /> },
        ]}
      />

      <ToolkitGrid
        id="toolkit-title"
        eyebrow="The toolkit"
        title="Every application, from the post to the offer."
        lead="You stay in charge: you apply on the original site, and nothing is sent to an employer for you."
        band
        tools={[
          { title: "The tracker", icon: BookmarkCheck, text: "Saved, applied, interviewing, offer: a board with notes and dates, so no application slips. A card that changes stage is marked where it lands.", widget: <TrackerArt />, wide: true },
          { title: "Straight from the source", icon: Building2, text: "Companies' own careers pages and remote job boards that allow it. Every job says where it came from.", widget: <SourcesArt feeds={feeds} /> },
          { title: "The Mission room", icon: Route, text: "Each application gets a room of its own: its stage, the next step and the prep for it.", widget: <MissionArt /> },
          { title: "Outreach", icon: Send, text: "Referral requests and emails to HR, written from your resume for the job. You send them.", widget: <OutreachArt /> },
          { title: "Interview day", icon: CalendarCheck, text: "When an interview is booked, a plan for the days before it, with practice built from the job post.", widget: <InterviewDayArt /> },
        ]}
      />

      <Section labelledBy="sources-title">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionIntro id="sources-title" eyebrow="Where the jobs come from" title="The original post, every time." lead="Jobs AI reads only what's published to be read, and links you to the employer to apply." />
          </div>
          <div className="rounded-2xl border mk-line mk-surface p-6 sm:p-8 lg:col-span-7">
            <h3 className="flex items-center gap-3 text-lg font-semibold text-zinc-950 dark:text-white">
              <IconTile icon={Building2} size="sm" /> Careers pages and open job boards
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-300">
              Companies' own career pages (their Greenhouse, Lever, Ashby and SmartRecruiters job boards), so Apply goes straight to the employer,
              and remote job boards that allow it: {feeds.join(", ")}. Every job says where it came from and links to the original post.
            </p>
            <h3 className="mt-8 flex items-center gap-3 text-base font-semibold text-zinc-950 dark:text-white">
              <IconTile icon={Search} size="sm" /> And the big sites
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-300">
              {india ? "LinkedIn, Naukri" : "LinkedIn, Indeed"} and the other large sites don't allow their listings to be copied, so Orbit doesn't. It opens their own search
              instead, filled in from your profile:
            </p>
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Sites Jobs AI searches for you">
              {(india ? PORTALS : WORLD_PORTALS).map((p) => (
                <li key={p} className="rounded-full border mk-line px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <FaqBlock id="faq-title" items={JOBS_AI_FAQ} />

      <CrossSell
        id="next-title"
        eyebrow="The same account"
        title="Then, the interview."
        lead="The resume Jobs AI matches is the one Resume AI scores, Practice asks about and the copilot answers from."
        items={[
          { product: { id: "resume", name: "Resume AI", icon: FileText }, title: "A resume tailored for the job", text: "An ATS score out of 100, the job post's keywords and a copy aimed at each job, every change shown.", to: RESUME_AI_HOME, cta: "See Resume AI" },
          { product: { id: "practice", name: "Practice", icon: Target }, title: "Practise for that interview", text: "A mock interview on the job post, in the company's style, then a score for every answer.", to: PRACTICE_PAGE, cta: "See mock interviews" },
          { product: { id: "copilot", name: "Interview copilot", icon: AudioLines }, title: "Live answers from your resume", text: "In calls where AI help is allowed, a suggested answer as the question is asked.", to: COPILOT_PAGE, cta: "See the copilot" },
        ]}
      />

      <FinalCta
        id="cta-title"
        innerRef={finalCta}
        title={["See the jobs that fit you.", "Ready in a minute or two."]}
        text="Create a free Orbit account and add your resume: your matches are ready in a minute or two, and the tracker keeps every application in one place."
        primary={{ to: "/register", label: "See my matches free", state: BACK_HERE }}
        footnote={
          <>
            Resume not ready yet?{" "}
            <Link to={RESUME_AI_HOME} className={cx("rounded font-medium text-white underline underline-offset-2", focusRing)}>
              Resume AI
            </Link>{" "}
            scores it the way screening software reads it, and helps you fix it.
          </>
        }
      />
      <StickyCta after={heroCtas} before={finalCta} line="Jobs that fit your resume, free." />
    </PublicLayout>
  );
}
