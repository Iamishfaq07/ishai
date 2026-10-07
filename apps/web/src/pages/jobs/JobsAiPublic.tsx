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
  OrbitWordmark,
  Search,
  Sparkles,
  cx,
  focusRing,
} from "@orbit/ui";
import { AiPill } from "../../components/products";
import { Footer } from "../../components/Footer";
import { api } from "../../lib/api";
import { RESUME_AI_HOME } from "../resume/paths";
import { linkButton, textLink } from "./links";
import { postedAgo } from "./model";
import { JOBS_AI_HOME } from "./paths";
import { JOBS_AI_FEATURES } from "./product";

/** Sign-up and sign-in from here come back to Jobs AI. */
const BACK_HERE = { from: JOBS_AI_HOME };

/** The big job sites Orbit links to (their own search, filled in), never reads. */
const PORTALS = ["LinkedIn", "Naukri", "Indeed", "Foundit", "Instahyre", "Cutshort", "Hirist", "Wellfound", "Internshala", "Google Jobs"];

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

/** An example match, drawn with the real card's parts: a job, its match, the skills, and a fit check beside it. */
function SampleMatch() {
  // Solid, not glass: the page's glow would show through.
  const solid = "rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10";
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[30rem] lg:mr-0">
      <span aria-hidden="true" className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-indigo-500/25 via-aurora-400/10 to-transparent blur-3xl" />
      <div role="img" aria-label="An example job match in Jobs AI" className="relative pb-24 sm:pb-28">
        <div aria-hidden="true" className={cx(solid, "relative p-5")}>
          <span className="absolute right-3 top-3 rounded-full bg-zinc-500/10 px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-zinc-500">
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
                  <MapPin className="h-3.5 w-3.5 text-zinc-400" /> Bengaluru · Hybrid
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
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 px-3.5 py-1.5 text-white shadow-glow-sm">
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
        An example backend engineer job in Bengaluru, an 88 percent match, with the skills the resume shows and the one it doesn't, and an AI fit
        check saying it's a strong fit.
      </figcaption>
    </figure>
  );
}

/**
 * Jobs AI for signed-out visitors (at /jobs, where a signed-in person gets their overview): what it does, an example
 * match, where the jobs come from, and "Start free", which signs up and comes back here. The only call is the public
 * numbers (GET /v1/jobs/stats): nothing here needs a session or calls the AI.
 */
export function JobsAiPublicPage() {
  const stats = useJobStats();
  const counts = stats && stats.jobs >= SHOW_COUNTS_FROM ? stats : null;
  const feeds = stats?.feeds.length ? stats.feeds : ["Himalayas", "Remote OK", "Jobicy"];
  return (
    <div className="min-h-full overflow-x-clip">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit home">
          <OrbitWordmark size={26} />
        </Link>
        <span className="hidden h-5 w-px bg-zinc-300 sm:block dark:bg-white/15" aria-hidden="true" />
        <span className="hidden items-center gap-1 font-display text-sm font-semibold sm:inline-flex">
          Jobs <AiPill />
        </span>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <Link to="/login" state={BACK_HERE} className={cx(linkButton("secondary"), "px-3.5")}>
            Sign in
          </Link>
          <Link to="/register" state={BACK_HERE} className={cx(linkButton("primary"), "px-3.5")}>
            Start free
          </Link>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <section aria-labelledby="hero-title" className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 pb-12 pt-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pb-20 lg:pt-12">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
              Orbit Jobs AI
            </p>
            <h1 id="hero-title" className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              Find jobs that <span className="text-gradient">fit your resume.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
              The latest openings from companies' own career pages and remote job boards, ranked by how well they match you, with a free AI fit
              check for each one.
            </p>
            <p className="mt-3 max-w-xl text-sm text-zinc-500 dark:text-zinc-400">
              Orbit reads your resume once, works out the roles, skills and cities to look for, and scores every new post against it. You apply on
              the company's own site.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" state={BACK_HERE} className={linkButton("primary", "lg")}>
                Start free <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/login" state={BACK_HERE} className={linkButton("secondary", "lg")}>
                I have an account
              </Link>
            </div>
            <FreeNote stats={stats} className="mt-5 max-w-xl" />
          </div>
          <SampleMatch />
        </section>

        {counts && (
          <section aria-label="Jobs AI today" className="mb-12 grid grid-cols-3 gap-2 sm:gap-3">
            <Stat value={counts.jobs.toLocaleString("en-IN")} label={`jobs posted in the last ${counts.days} days`} />
            <Stat value={counts.companies.toLocaleString("en-IN")} label="companies hiring in India or remotely" />
            <Stat
              value={String(counts.fit_daily)}
              label="free AI fit checks a day"
              note={counts.updated_at ? `Jobs updated ${postedAgo(counts.updated_at).toLowerCase()}` : undefined}
            />
          </section>
        )}

        <section aria-labelledby="features-title" className="border-t border-zinc-200/70 pt-12 dark:border-white/5">
          <h2 id="features-title" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            What Jobs AI does
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            You stay in charge: you apply on the original site, and nothing is sent to an employer for you.
          </p>
          <ul className="stagger mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {JOBS_AI_FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="glass-panel rounded-2xl p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-aurora-400/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:text-indigo-300">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-title" className="mt-14 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-10">
          <div>
            <h2 id="how-title" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-6 space-y-4">
              {[
                { icon: FileUp, title: "Add your resume", text: "Import the one you have (PDF, Word or LinkedIn's PDF), or make one in Resume AI." },
                { icon: Sparkles, title: "See your matches", text: "The AI reads it into a search profile you can change, and every new job is scored against it." },
                { icon: BookmarkCheck, title: "Apply and keep track", text: "Check your fit, ask for a referral, apply on the company's site, and move each application along your tracker." },
              ].map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-aurora-500 text-white shadow-glow-sm">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display font-semibold">
                      <span className="sr-only">Step {i + 1}: </span>
                      {title}
                    </span>
                    <span className="block text-sm text-zinc-500 dark:text-zinc-400">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="glass-panel rounded-3xl p-6 sm:p-8">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Building2 className="h-5 w-5 text-indigo-500" aria-hidden /> Where the jobs come from
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Companies' own career pages (their Greenhouse, Lever, Ashby and SmartRecruiters job boards), so Apply goes straight to the employer,
              and remote job boards that allow it: {feeds.join(", ")}. Every job says where it came from and links to the original post.
            </p>
            <h3 className="mt-5 flex items-center gap-2 font-display text-base font-semibold">
              <Search className="h-4 w-4 text-indigo-500" aria-hidden /> And the big sites
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              LinkedIn, Naukri and the other large sites don't allow their listings to be copied, so Orbit doesn't. It opens their own search
              instead, filled in from your profile:
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Sites Jobs AI searches for you">
              {PORTALS.map((p) => (
                <li key={p} className="rounded-full border border-zinc-200 bg-white/70 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="glass-panel gradient-border relative mt-14 overflow-hidden rounded-3xl p-6 text-center sm:p-10">
          <span aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
          <h2 className="relative font-display text-2xl font-semibold tracking-tight sm:text-3xl">See the jobs that fit you</h2>
          <p className="relative mx-auto mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-300">
            Create a free Orbit account and add your resume: your matches are ready in a minute or two. The same account has Resume AI and Orbit's
            interview copilot for when the interviews come.
          </p>
          <Link to="/register" state={BACK_HERE} className={cx(linkButton("primary", "lg"), "relative mt-6")}>
            Start free <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="relative mt-5 text-xs text-zinc-500 dark:text-zinc-400">
            Resume not ready yet?{" "}
            <Link to={RESUME_AI_HOME} className={textLink}>
              Resume AI
            </Link>{" "}
            scores it the way screening software reads it, and helps you fix it.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="glass-panel min-w-0 rounded-2xl px-3 py-3 sm:px-5 sm:py-4">
      <p className="font-display text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-600 sm:text-sm dark:text-zinc-300">{label}</p>
      {note && <p className="mt-1 hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">{note}</p>}
    </div>
  );
}
