import { Link } from "react-router-dom";
import { ArrowRight, BookmarkCheck, Search, Users, cx, focusRing } from "@orbit/ui";
import { useJobsAi } from "./JobsAi";
import { JobActionDeskPage } from "./ActionDesk";
import { JOBS_MATCHES, JOBS_OUTREACH, JOBS_PROFILE, JOBS_TRACKER } from "./paths";

const GOALS = [
  { to: JOBS_MATCHES, label: "Find my next role", detail: "Matches, fit checks and a shortlist", icon: Search },
  { to: JOBS_TRACKER, label: "Move applications forward", detail: "Track, automate and prepare for interviews", icon: BookmarkCheck },
  { to: JOBS_OUTREACH, label: "Connect with people", detail: "Contacts, introductions and follow-ups", icon: Users },
];

/** Overview and daily actions share one home. Counts and reminders come from saved records. */
export function JobsTodayPage() {
  const { profile, tracker } = useJobsAi();
  return <div className="space-y-6">
    <header>
      <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Jobs AI</p>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Today</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Your job search, one step at a time. Pick a goal or start with what needs your attention.</p>
    </header>
    {tracker.data?.length === 0 && <nav aria-label="Choose your next step" className="grid grid-cols-3 gap-2 sm:gap-3">
      {GOALS.map(({ to, label, detail, icon: Icon }) => <Link key={to} to={to}
        className={cx("group flex flex-col items-start gap-2 rounded-2xl border border-zinc-200 bg-white p-3 transition-colors hover:border-indigo-400 motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-900 sm:flex-row sm:items-center sm:gap-3 sm:p-4", focusRing)}>
        <Icon className="h-5 w-5 shrink-0 text-indigo-700 dark:text-indigo-300" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold sm:text-sm">{label}</span><span className="mt-1 hidden text-xs text-zinc-600 sm:block dark:text-zinc-400">{detail}</span></span>
        <ArrowRight className="hidden h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1 sm:block" aria-hidden />
      </Link>)}
    </nav>}
    <JobActionDeskPage />
    {profile.data && !profile.data.resume && <p className="rounded-xl bg-sky-500/10 p-4 text-sm">
      For more relevant matches, <Link to={JOBS_PROFILE} className={cx("rounded font-semibold underline underline-offset-4", focusRing)}>set your search preferences and choose a resume</Link>. You can browse jobs at any time.
    </p>}
  </div>;
}
