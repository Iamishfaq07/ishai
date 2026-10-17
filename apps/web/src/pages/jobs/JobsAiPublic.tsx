import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { JobStats } from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  BookmarkCheck,
  Briefcase,
  Building2,
  Check,
  CircleAlert,
  Clock,
  FileUp,
  MapPin,
  Search,
  Sparkles,
  cx,
  formatNumber,
  isIndia,
  sampleCity,
  focusRing,
  buttonClass,
} from "@orbit/ui";
import { CtaBand, FeatureGrid, ProductHero, inkButton } from "../../marketing/ProductPage";
import { PublicLayout } from "../../marketing/PublicLayout";
import { Container, IconTile, Section, SectionIntro } from "../../marketing/primitives";
import { api } from "../../lib/api";
import { useCountry } from "../../lib/country";
import { RESUME_AI_HOME } from "../resume/paths";
import { linkButton } from "./links";
import { postedAgo } from "./model";
import { JOBS_AI_HOME } from "./paths";
import { jobsAiFeatures } from "./product";

/** Sign-up and sign-in from here come back to Jobs AI. */
const BACK_HERE = { from: JOBS_AI_HOME };

/** The big job sites Orbit links to (their own search, filled in), never reads. */
const PORTALS = ["LinkedIn", "Naukri", "Indeed", "Foundit", "Instahyre", "Cutshort", "Hirist", "Wellfound", "Internshala", "Google Jobs"];
// Outside India: the ones there are links to there (job_portal/portals.py).
const WORLD_PORTALS = ["LinkedIn", "Indeed", "Wellfound", "Google Jobs"];

/** Below this, the live count isn't worth a headline (a new server still fetching its first jobs). */
const SHOW_COUNTS_FROM = 50;

/** The public numbers (counts and the free allowances), or null until the server answers or if it can't. */
function useJobStats(): JobStats | null {
  const [stats, setStats] = useState<JobStats | null>(null);
  useEffect(() => {
    api.jobStats().then(setStats).catch(() => undefined);
  }, []);
  return stats;
}

/** What's free, said plainly, with the server's own daily allowances once it answers. */
function FreeNote({ stats, className }: { stats: JobStats | null; className?: string }) {
  return (
    <p className={cx("text-sm text-zinc-600 dark:text-zinc-400", className)}>
      <strong className="font-medium text-zinc-900 dark:text-white">Free with an Orbit account.</strong> Browsing, matching and the tracker never use
      credits,{" "}
      {stats
        ? `and each day you get ${stats.fit_daily} AI fit checks and ${stats.profile_daily} AI reads of your resume, free.`
        : "and a few AI fit checks a day are free."}{" "}
      Outreach uses resume credits, and so do AI rewrites when you tailor a resume in Resume AI.
    </p>
  );
}

/** An example match, drawn with the real card's parts: a job, its match, the skills, and a fit check beside it. The job is
 *  in a city where the visitor applies (remote where there's no example city). */
function SampleMatch() {
  const city = sampleCity(useCountry());
  // Solid surfaces that float: the card and the fit check beside it.
  const solid = "mk-float rounded-2xl mk-surface";
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[30rem] lg:mr-0">
      <div role="img" aria-label="An example job match in Jobs AI" className="relative pb-24 sm:pb-28">
        <div aria-hidden="true" className={cx(solid, "relative p-5")}>
          <span className="absolute right-3 top-3 rounded-full bg-zinc-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-zinc-600 dark:text-zinc-300">
            Example
          </span>
          <div className="flex items-start gap-3 pr-14">
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-semibold leading-snug">Backend Engineer</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-300">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5 text-zinc-400" /> Kestrel Pay
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-zinc-400" /> {city ? `${city} · Hybrid` : "Remote"}
                </span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> 3h ago
                </span>
                <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">New</span>
                <span>· Full-time · 3-5 years</span>
              </p>
            </div>
          </div>
          <span className="absolute right-5 top-12 flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
            <span className="font-display text-xl font-semibold leading-none tabular-nums">88%</span>
            <span className="text-[0.625rem] leading-none opacity-80">match</span>
          </span>
          <ul className="mt-4 flex flex-wrap gap-1.5 text-xs">
            {["Python", "Go", "Kubernetes", "PostgreSQL"].map((s) => (
              <li key={s} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
                <Check className="h-3 w-3" /> {s}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Not on your resume:</span> Kafka
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">From Kestrel Pay's careers page</p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm font-medium">
            <span className={linkButton("primary", "sm")}>
              Apply <ArrowUpRight className="h-4 w-4" />
            </span>
            <span className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs leading-5 dark:border-white/10">Save</span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs leading-5 dark:border-white/10">
              <Sparkles className="h-3.5 w-3.5" /> Check my fit
            </span>
          </div>
        </div>
        <div aria-hidden="true" className={cx(solid, "absolute inset-x-3 bottom-0 p-3.5 sm:inset-x-auto sm:-left-10 sm:w-80")}>
          <p className="flex items-center gap-2 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            <span className="font-medium text-indigo-700 dark:text-indigo-300">Fit check</span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">Strong fit</span>
          </p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-700 dark:text-zinc-200">
            <li className="flex gap-1.5">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> Three years of Go and Python services, as the post asks.
            </li>
            <li className="flex gap-1.5">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" /> It wants Kafka, which your resume doesn't show.
            </li>
          </ul>
        </div>
      </div>
      <figcaption className="sr-only">
        An example backend engineer job {city ? `in ${city}` : "that's remote"}, an 88 percent match, with the skills the resume shows and the one it doesn't, and an AI fit
        check saying it's a strong fit.
      </figcaption>
    </figure>
  );
}

/**
 * Jobs AI for signed-out visitors (at /jobs, where a signed-in person gets their overview): what it does, an example
 * match, where the jobs come from, and "Start free", which signs up and comes back here. The only call is the public
 * numbers (GET /v1/jobs/stats): nothing here needs a session or calls the AI. The public site's product page template
 * (marketing/ProductPage.tsx) inside the shared layout.
 */
export function JobsAiPublicPage() {
  const country = useCountry();
  const india = isIndia(country);
  const stats = useJobStats();
  const counts = stats && stats.jobs >= SHOW_COUNTS_FROM ? stats : null;
  const feeds = stats?.feeds.length ? stats.feeds : ["Himalayas", "Remote OK", "Jobicy"];
  const steps = [
    { icon: FileUp, title: "Add your resume", text: "Import the one you have (PDF, Word or LinkedIn's PDF), or make one in Resume AI." },
    { icon: Sparkles, title: "See your matches", text: "The AI reads it into a search profile you can change, and every new job is scored against it." },
    { icon: BookmarkCheck, title: "Apply and keep track", text: "Check your fit, ask for a referral, apply on the company's site, and move each application along your tracker." },
  ];
  return (
    <PublicLayout authState={BACK_HERE} context="Jobs AI">
      <ProductHero
        product={{ id: "jobs", name: "Jobs AI", icon: Briefcase }}
        title="Find jobs that fit your resume."
        lead="The latest openings from companies' own career pages and remote job boards, ranked by how well they match you, with a free AI fit check for each one."
        detail="Orbit reads your resume once, works out the roles, skills and cities to look for, and scores every new post against it. You apply on the company's own site."
        actions={
          <>
            <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/login" state={BACK_HERE} className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              I have an account
            </Link>
          </>
        }
        note={<FreeNote stats={stats} />}
        visual={<SampleMatch />}
      />

      {counts && (
        <section aria-label="Jobs AI today" className="border-t mk-line">
          <Container className="grid grid-cols-3 divide-x mk-line">
            <Stat value={formatNumber(counts.jobs, country)} label={`jobs posted in the last ${counts.days} days`} />
            <Stat value={formatNumber(counts.companies, country)} label={india ? "companies hiring in India or remotely" : "companies hiring"} />
            <Stat
              value={String(counts.fit_daily)}
              label="free AI fit checks a day"
              note={counts.updated_at ? `Jobs updated ${postedAgo(counts.updated_at).toLowerCase()}` : undefined}
            />
          </Container>
        </section>
      )}

      <FeatureGrid
        id="features-title"
        eyebrow="What Jobs AI does"
        title="You stay in charge of every application."
        lead="You apply on the original site, and nothing is sent to an employer for you."
        features={jobsAiFeatures(country).map(({ icon, title, text }) => ({ icon, title, text }))}
        band
      />

      <Section labelledBy="how-title">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionIntro id="how-title" eyebrow="How it works" title="From resume to matches in a minute or two." />
            <ol className="mt-10 space-y-8">
              {steps.map(({ icon, title, text }, i) => (
                <li key={title} className="flex gap-4">
                  <IconTile icon={icon} />
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-zinc-950 dark:text-white">
                      <span className="sr-only">Step {i + 1}: </span>
                      {title}
                    </span>
                    <span className="mt-1 block text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border mk-line mk-surface p-6 sm:p-8 lg:col-span-7">
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-950 dark:text-white">
              <IconTile icon={Building2} size="sm" /> Where the jobs come from
            </h2>
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

      <CtaBand
        id="cta-title"
        title="See the jobs that fit you."
        text="Create a free Orbit account and add your resume: your matches are ready in a minute or two. The same account has Resume AI and Orbit's interview copilot for when the interviews come."
        actions={
          <Link to="/register" state={BACK_HERE} className={inkButton.primary}>
            Start free <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
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
    </PublicLayout>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="min-w-0 px-3 py-8 first:pl-0 sm:px-8 sm:py-10">
      <p className="stat-value text-2xl font-semibold tabular-nums tracking-tight text-zinc-950 sm:text-4xl dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-600 sm:text-sm dark:text-zinc-400">{label}</p>
      {note && <p className="mt-1 hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">{note}</p>}
    </div>
  );
}
