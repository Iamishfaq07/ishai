import { lazy, Suspense, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CompanyLogo, FileText, Headphones, IdCard, Plus, Rocket, Skeleton, buttonClass, cx, focusRing } from "@orbit/ui";
import type { JobStatus } from "@orbit/types";
import { RouteLine, nextStop, routeIndex } from "../components/RouteLine";
import { RouteMapArt } from "../components/RouteMapArt";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { missionPath } from "./jobs/paths";
import { summaryLine } from "./home/dashboard";
import { SetupChecklist } from "./home/SetupChecklist";
import { activeJobs, dayLabel, pickNextStop, weekStops, type Queue } from "./home/today";
const SecurityNotice = lazy(() => import("./SecurityActivity").then((m) => ({ default: m.SecurityNotice })));
// The full seven-day action queue, folded under the week; /jobs/actions redirects here.
const Overview = lazy(() => import("./home/CareerOverview").then((m) => ({ default: m.CareerOverview })));
const Actions = lazy(() => import("./jobs/ActionDesk").then((m) => ({ default: m.JobActionDeskPage })));

/** Conversion so far, from the tracker's own records: of everything past "saved", how much reached an interview, and
 *  of that, how much reached an offer. Null until there's something to divide by. */
export function conversion(statuses: JobStatus[]): { interview: number | null; offer: number | null } {
  const applied = statuses.filter((s) => s !== "saved").length;
  const interviewed = statuses.filter((s) => s === "interviewing" || s === "offer" || s === "hired").length;
  const offered = statuses.filter((s) => s === "offer" || s === "hired").length;
  return { interview: applied ? Math.round((interviewed / applied) * 100) : null,
           offer: interviewed ? Math.round((offered / interviewed) * 100) : null };
}

/** "Good morning" by the viewer's own clock. */
export function greeting(hour: number): string {
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const quiet = "text-sm text-zinc-600 dark:text-zinc-400";
const textLink = cx("rounded font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300", focusRing);

/**
 * Today (Route map direction): the next stop first, in the title face, with its reason and one action; this week's
 * stops across every job on one line; then each job's route. A part that fails to load says so in its own place,
 * quietly, and the rest of the page still works.
 */
export function HomePage() {
  const { user } = useAuth();
  const now = new Date();
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const queue = useAsync(() => api.call<Queue>("/v1/jobs/actions"), [], "job-actions-today");
  const reloadTracker = tracker.reload, reloadQueue = queue.reload;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") { reloadTracker(); reloadQueue(); } };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [reloadTracker, reloadQueue]);

  const loading = (!tracker.data && !tracker.error) || (!queue.data && !queue.error);
  const stop = loading ? null : pickNextStop(queue.data ?? null, tracker.data ?? null);
  const week = weekStops(queue.data ?? null, tracker.data ?? null);
  const weekCount = week.reduce((n, d) => n + d.stops.length, 0);
  const jobs = activeJobs(tracker.data ?? []);

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-title text-[1.75rem] font-semibold leading-tight tracking-[-0.01em]">{greeting(now.getHours())}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p className={cx("mt-1", quiet)}>{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}{tracker.data ? ` · ${summaryLine(tracker.data)}` : ""}</p>
      </div>
      <Link className={buttonClass("secondary")} to="/jobs/tracker?add=1"><Plus className="h-4 w-4" aria-hidden /> Add a job</Link>
    </header>

    <Suspense fallback={null}><SecurityNotice /></Suspense>
    <Suspense fallback={<Skeleton variant="card" count={1} label="Loading career overview" />}><Overview /></Suspense>

    {/* A new account's few setup steps, until they're all done. */}
    <SetupChecklist jobsSaved={tracker.data ? tracker.data.length : null} />

    <section aria-labelledby="next-stop" className="route-rise relative overflow-hidden rounded-2xl bg-white px-6 py-7 ring-1 ring-zinc-200 sm:px-8 dark:bg-zinc-900 dark:ring-white/10">
      <h2 id="next-stop" className="sr-only">Your next stop</h2>
      {/* The route picture: it lights as many stops as the furthest job has reached (one on a first visit). */}
      {stop && <RouteMapArt stops={Math.max(1, ...jobs.map((j) => routeIndex(j.status) + 1)) + (stop.first ? 0 : 1)}
        className="pointer-events-none absolute -right-6 bottom-0 hidden h-full max-h-56 w-auto md:block" />}
      {!stop ? <div className="mt-4"><Skeleton variant="line" count={2} label="Finding your next stop" /></div> : <div className="relative md:pr-72">
        {stop.when && <p className="mb-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">{stop.when}</p>}
        <p className="max-w-3xl font-title text-[2rem] font-semibold leading-[1.15] tracking-[-0.015em] sm:text-[2.375rem]">{stop.title}</p>
        <p className="mt-3 max-w-2xl text-base text-zinc-700 dark:text-zinc-300">{stop.detail}</p>
        {stop.reason && <p className={cx("mt-1 max-w-2xl", quiet)}>{stop.reason}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link className={buttonClass("primary", "lg")} to={stop.to}>{stop.action} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          {stop.first && <Link className={textLink} to="/jobs/tracker?add=1">Or add a job you found elsewhere</Link>}
        </div>
      </div>}
    </section>

    <section aria-labelledby="this-week">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="this-week" className="text-lg font-semibold">This week</h2>
        {queue.error && !queue.data ? <button type="button" onClick={reloadQueue} className={cx(quiet, "rounded underline underline-offset-4", focusRing)}>Reminders didn't load · Retry</button>
          : <span className={quiet}>{weekCount ? `${weekCount} ${weekCount === 1 ? "stop" : "stops"} on your routes` : "Nothing dated this week"}</span>}
      </div>
      <div className="mt-4 overflow-x-auto pb-2" role="region" aria-label="This week's stops (scrolls sideways on small screens)" tabIndex={0}>
        <ol className="relative grid min-w-[44rem] auto-cols-fr grid-flow-col">
          {week.map((day, i) => <li key={day.key} className="route-rise relative" style={{ ["--i" as string]: i + 2 }}>
            <div className="pr-2">
              <p className={cx("text-[13px] font-medium", day.key === "d0" ? "text-zinc-900 dark:text-zinc-100" : day.key === "past" ? "text-rose-700 dark:text-rose-300" : "text-zinc-600 dark:text-zinc-400")}>{day.label}</p>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{day.date ?? "\u00a0"}</p>
            </div>
            <div aria-hidden className="relative mt-2 h-3">
              <span className={cx("absolute inset-x-0 top-[5px] h-0.5", day.key === "past" ? "bg-rose-300 dark:bg-rose-800" : "bg-zinc-300 dark:bg-zinc-700")} />
              {day.stops.length > 0 ? <span className={cx("absolute left-0 top-0 h-3 w-3 rounded-full", day.key === "past" ? "bg-rose-600" : "bg-indigo-600 dark:bg-indigo-400")} />
                : day.key === "d0" && <span className="absolute left-0 top-0 h-3 w-3 rounded-full bg-white ring-2 ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-500" />}
            </div>
            <ul className="mt-2 space-y-2">{day.stops.slice(0, 3).map((s) => <li key={s.id}>
              <Link to={s.to} className={cx("block rounded-md py-0.5 pr-1 text-[13px] leading-snug hover:bg-zinc-100 dark:hover:bg-white/5", focusRing)}>
                <span className="block font-medium text-zinc-900 dark:text-zinc-100">{s.label}</span>
                <span className="block text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-400">{s.title}</span>
              </Link></li>)}
              {day.stops.length > 3 && <li className="text-[13px] text-zinc-600 dark:text-zinc-400">+{day.stops.length - 3} more</li>}
            </ul>
          </li>)}
        </ol>
      </div>
    </section>

    <section aria-labelledby="your-routes">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="your-routes" className="text-lg font-semibold">Your routes</h2>
        {jobs.length > 0 && <Link className={textLink} to="/jobs/tracker">All jobs</Link>}
      </div>
      {tracker.error && !tracker.data ? <p className={cx("mt-4", quiet)}>Your jobs didn't load. <button type="button" onClick={reloadTracker} className={cx("rounded underline underline-offset-4", focusRing)}>Try again</button></p>
        : !tracker.data ? <div className="mt-4"><Skeleton variant="line" count={3} label="Loading your jobs" /></div>
        : jobs.length === 0 ? <div className="mt-4 flex flex-wrap items-center gap-6 rounded-2xl border border-dashed border-zinc-300 p-6 dark:border-white/15">
            <RouteMapArt stops={1} className="h-24 w-auto" />
            <p className={cx("max-w-md", quiet)}>Routes appear here as you save jobs: each one gets its own line from saved to offer. <Link className={textLink} to="/jobs/matches">Find jobs</Link> or <Link className={textLink} to="/jobs/tracker?add=1">add one you found elsewhere</Link>.</p>
          </div>
        : <ul className="mt-3 divide-y divide-zinc-200 dark:divide-white/10">{jobs.slice(0, 6).map((job, i) => {
          const upcoming = job.next_at && Date.parse(job.next_at) >= new Date().setHours(0, 0, 0, 0);
          const next = nextStop(job.status);
          return <li key={job.id} className="route-rise" style={{ ["--i" as string]: i + 4 }}>
            <Link to={missionPath(job.id)} className={cx("grid gap-x-6 gap-y-2 rounded-lg py-4 hover:bg-zinc-100/70 sm:grid-cols-[minmax(0,1fr)_17rem_8rem] sm:items-center sm:px-2 dark:hover:bg-white/[0.04]", focusRing)}>
              <span className="flex min-w-0 items-center gap-3"><CompanyLogo company={job.company} size="sm" />
                <span className="min-w-0"><span className="block text-[13px] text-zinc-600 dark:text-zinc-400">{job.company}</span>
                <span className="block font-semibold [overflow-wrap:anywhere]">{job.title}</span></span></span>
              <RouteLine status={job.status} className="w-full max-w-[12rem] sm:hidden" />
              <RouteLine status={job.status} labels className="hidden w-full sm:flex" />
              <span className="text-[13px] sm:text-right">{upcoming
                ? <><span className="font-medium text-zinc-900 dark:text-zinc-100">{dayLabel(job.next_at!)}</span> <span className="text-zinc-600 dark:text-zinc-400">{job.status === "interviewing" ? "interview" : "next date"}</span></>
                : <span className="text-zinc-600 dark:text-zinc-400">{next ? `Next: ${next}` : "At the last stop"}</span>}</span>
            </Link></li>;
        })}</ul>}
    </section>

    {/* The tools people reach for most, by name, and the way to every other one. */}
    <section aria-labelledby="quick-tools" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="quick-tools" className="font-semibold">Your AI tools</h2>
        <Link to="/toolkit" className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">See all tools</Link></div>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">{QUICK_TOOLS.map(({ to, label, line, icon: Icon }, i) => <li key={to} className="route-rise" style={{ ["--i" as string]: i + 1 }}>
        <Link to={to} className={cx("workspace-panel route-card flex h-full flex-col gap-2 p-4", focusRing)}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"><Icon className="h-4 w-4" aria-hidden /></span>
          <span className="font-semibold">{label}</span>
          <span className="text-[13px] text-zinc-600 dark:text-zinc-400">{line}</span>
        </Link></li>)}</ul>
    </section>

    <details className="group rounded-2xl ring-1 ring-zinc-200 dark:ring-white/10">
      <summary className={cx("flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 font-medium", focusRing)}>
        <span>Your action queue{queue.data ? ` (${queue.data.items.length})` : ""}</span>
        <ArrowRight className="h-4 w-4 text-zinc-500 motion-safe:transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <div className="border-t border-zinc-200 p-5 dark:border-white/10"><Suspense fallback={<Skeleton variant="line" count={3} label="Loading your actions" />}><Actions embedded /></Suspense></div>
    </details>
  </div>;
}

const QUICK_TOOLS = [
  { to: "/jobs/journey", label: "Auto Apply", line: "Each saved job prepared with a resume tailored to it.", icon: Rocket },
  { to: "/resume-ai", label: "Resume Builder", line: "Build, import and check your resume for ATS.", icon: FileText },
  { to: "/mock", label: "AI Mock Interview", line: "Practise out loud and read your feedback.", icon: Headphones },
  { to: "/linkedin", label: "LinkedIn Optimizer", line: "Headline and About fixes, ready to paste.", icon: IdCard },
];
