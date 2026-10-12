import { Link } from "react-router-dom";
import type { JobListing, JobProfile, JobTrackerEntry } from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  BookmarkCheck,
  Briefcase,
  Building2,
  CalendarIcon,
  SlidersHorizontal,
  Sparkles,
  LoadGate,
  cx,
  focusRing,
} from "@orbit/ui";
import { Card, ErrorNote, Spinner } from "../../components/ui";
import { errorText } from "../../lib/format";
import { ADD_JOB_PATH, FollowUps } from "./FollowUps";
import { useJobFeed, useJobsAi } from "./JobsAi";
import { JobWhen, MatchBadge, TrustBadges } from "./JobCard";
import { linkButton, textLink } from "./links";
import { Busy, FirstFetch, NoResume, PortalCard, ProfileCard, firstFetch } from "./Matches";
import { POSTED_WITHIN, STATUSES, STATUS_LABEL, STATUS_TONE, byStatus, matchBasis, nextUp, shortDate, withTracked } from "./model";
import { JOBS_MATCHES, JOBS_PROFILE, JOBS_TRACKER, jobPath } from "./paths";
import { JOBS_AI_FEATURES } from "./product";
import { JobMock } from "../../components/productArt";

const TOP = 4;

/**
 * Orbit Jobs AI's home, signed in: what it does, your best matches right now, what the feed looks for, and where your
 * applications stand. Signed out, the same address shows the public product page (JobsAiPublic.tsx) instead.
 */
export function JobsAiHomePage() {
  const { profile } = useJobsAi();
  return (
    <>
      <section aria-labelledby="jobs-ai-title" className="glass-panel gradient-border relative mb-6 overflow-hidden rounded-3xl p-5 sm:p-8">
        <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-aurora-400/15 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
              Orbit Jobs AI
            </p>
            <h1 id="jobs-ai-title" className="mt-4 max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Find jobs that <span className="text-gradient">fit your resume.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">
              The latest openings from companies' own career pages and remote job boards, ranked by how well they match you.
            </p>
            <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
              <Link to={JOBS_MATCHES} className={linkButton("primary", "lg")}>
                <Sparkles className="h-4 w-4" aria-hidden /> See your matches
              </Link>
              <Link to={JOBS_PROFILE} className={linkButton("secondary", "lg")}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden /> Edit what you're looking for
              </Link>
            </div>
            <ul aria-label="What Jobs AI does" className="mt-6 flex flex-wrap gap-1.5 sm:mt-7 sm:gap-2">
              {JOBS_AI_FEATURES.map(({ icon: Icon, short }) => (
                <li
                  key={short}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-500/15 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
                >
                  <Icon className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" aria-hidden />
                  {short}
                </li>
              ))}
            </ul>
          </div>
          <div className="hidden lg:block">
            <JobMock />
          </div>
        </div>
      </section>

      <LoadGate loading={profile.loading && !profile.data} variant="job-card" count={2} label="Getting your job profile">
      {profile.error && !profile.data ? (
        <ErrorNote onRetry={profile.reload}>{errorText(profile.error)}</ErrorNote>
      ) : profile.data ? (
        <Overview profile={profile.data} />
      ) : null}
      </LoadGate>
    </>
  );
}

function Overview({ profile }: { profile: JobProfile }) {
  const { tracker, suggesting } = useJobsAi();
  // Nothing to match against yet: the newest jobs, with no match % (model.ts `matchBasis`).
  const basis = matchBasis(profile);
  const { feed, refreshing } = useJobFeed(profile, "", basis ? "best" : "newest");
  const data = feed.data;
  const top = withTracked(data?.items.slice(0, TOP) ?? [], {}, tracker.data);
  const days = POSTED_WITHIN.find((p) => p.days === profile.prefs.posted_within) ?? POSTED_WITHIN[2]!;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="top-matches" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="top-matches" className="font-display text-lg font-semibold tracking-tight">
            {basis ? "Your best matches" : "The newest jobs"}
            {data && data.total > 0 && (
              <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                <span className="tabular-nums">{data.total}</span> in the {days.label.toLowerCase()}
              </span>
            )}
          </h2>
          <Busy refreshing={refreshing} suggesting={suggesting} />
        </div>

        {!basis && <NoResume blank={Boolean(profile.resume)} />}

        {feed.loading && !data ? (
          <Spinner big label={suggesting ? "Reading your resume" : "Finding jobs that match your resume"} state="searching" />
        ) : feed.error && !data ? (
          <ErrorNote onRetry={feed.reload}>{errorText(feed.error)}</ErrorNote>
        ) : data && data.total === 0 ? (
          firstFetch(data) ? (
            <FirstFetch />
          ) : (
            <Card className="text-sm text-zinc-600 dark:text-zinc-300">
              <p>
                <strong className="font-medium text-zinc-900 dark:text-white">No matches posted in the {days.label.toLowerCase()}.</strong> Try a longer time
                range, more job titles or cities, or turn on remote.
              </p>
              <Link to={JOBS_PROFILE} className={cx(linkButton("secondary", "sm"), "mt-3")}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden /> Change what you're looking for
              </Link>
            </Card>
          )
        ) : (
          <>
            <ul className="space-y-2.5">
              {top.map((job) => (
                <li key={job.id}>
                  <TopMatch job={job} showMatch={basis !== null} />
                </li>
              ))}
            </ul>
            {data && data.total > top.length && (
              <Link to={JOBS_MATCHES} className={cx(linkButton("secondary"), "w-full")}>
                See all {data.total} {basis ? "matches" : "jobs"} <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </>
        )}
      </section>

      <aside className="min-w-0 space-y-4" aria-label="Your job search">
        <FollowUps tracker={tracker} hideWhenEmpty />
        <ProfileCard profile={profile} suggesting={suggesting} />
        <TrackerSummary entries={tracker.data} loading={tracker.loading} />
        <PortalCard portals={data?.portals ?? null} days={days.short} />
      </aside>
    </div>
  );
}

/** One of the best matches, in a line: the whole row opens the job's own page. */
function TopMatch({ job, showMatch }: { job: JobListing; showMatch: boolean }) {
  return (
    <Link
      to={jobPath(job.id)}
      className={cx("glass-panel lift group flex items-center gap-3 rounded-2xl p-3.5 hover:border-indigo-400/40 sm:gap-4 sm:p-4 dark:hover:border-indigo-400/30", focusRing)}
    >
      {showMatch && job.match ? (
        <MatchBadge match={job.match} />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-500/10 text-zinc-500">
          <Briefcase className="h-5 w-5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-semibold group-hover:text-indigo-600 dark:group-hover:text-indigo-300">{job.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-zinc-600 dark:text-zinc-300">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          <span className="truncate">
            {job.company}
            {job.place ? ` · ${job.place}` : ""}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <JobWhen job={job} facts={false} />
          <TrustBadges job={job} only={["early"]} />
        </span>
      </span>
      {job.tracked && (
        <span className={cx("hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 sm:inline", STATUS_TONE[job.tracked.status])}>
          {STATUS_LABEL[job.tracked.status]}
        </span>
      )}
      <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-indigo-500" aria-hidden />
    </Link>
  );
}

/** Where the applications stand: a count per step, and what's coming up next. */
function TrackerSummary({ entries, loading }: { entries: JobTrackerEntry[] | null; loading: boolean }) {
  const columns = byStatus(entries ?? []);
  const next = entries ? nextUp(entries) : null;
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-display text-sm font-semibold">
          <BookmarkCheck className="h-4 w-4 text-indigo-500" aria-hidden /> Your applications
        </h2>
        {entries && entries.length > 0 && (
          <Link to={JOBS_TRACKER} className={cx(textLink, "text-xs")}>
            Open tracker
          </Link>
        )}
      </div>
      <LoadGate loading={loading && !entries} variant="line" count={3} label="Loading your tracker">
      {!entries?.length ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Nothing tracked yet. Save jobs from your matches, say "Yes, I applied" after you apply, or{" "}
          <Link to={ADD_JOB_PATH} className={textLink}>
            add one you found elsewhere
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {STATUSES.filter((s) => s !== "rejected").map((s) => (
              <li key={s}>
                <Link to={JOBS_TRACKER} className={cx("block rounded-xl px-3 py-2 ring-1", STATUS_TONE[s], focusRing)}>
                  <span className="block font-display text-xl font-semibold tabular-nums leading-tight">{columns[s].length}</span>
                  <span className="block text-xs">{STATUS_LABEL[s]}</span>
                </Link>
              </li>
            ))}
          </ul>
          {next && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <CalendarIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden />
              <span>
                <span className="font-medium">Next: {shortDate(next.next_at)}</span>, {next.title} at {next.company}
              </span>
            </p>
          )}
        </>
      )}
      </LoadGate>
    </Card>
  );
}
