import { lazy, Suspense, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Skeleton, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { CareerCompanion } from "./jobs/CareerCompanion";
import { Pipeline, Upcoming } from "./home/Mission";
const SecurityNotice = lazy(() => import("./SecurityActivity").then((m) => ({ default: m.SecurityNotice })));
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);

/** Operational home: the existing grounded next-step projection, not another recommendation engine. */
export function HomePage() {
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const reload = tracker.reload;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [reload]);
  return <div className="min-w-0 space-y-6 break-words">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">Personal Orbit</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Today</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">One next step from your saved work. Pick up where your search needs you.</p></header>
    <Suspense fallback={null}><SecurityNotice /></Suspense>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0"><CareerCompanion mode="home" onSelect={() => undefined} /></div>
      <aside aria-label="Your search" className="min-w-0 space-y-4">
        {tracker.error ? <ErrorNote onRetry={reload}>Saved dates and application counts could not load.</ErrorNote> : tracker.loading && !tracker.data ? <Skeleton variant="card" label="Loading your search" /> : <><Upcoming tracker={tracker} /><Pipeline tracker={tracker} compact /></>}
        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10"><h2 className="font-semibold">A clear path, at your pace</h2>
          <svg aria-hidden="true" viewBox="0 0 240 60" className="my-3 h-14 w-full text-indigo-500"><path d="M20 40Q80 -10 130 30T220 20" fill="none" stroke="currentColor" strokeWidth="2" />{[20,70,120,170,220].map((x,i) => <circle key={x} cx={x} cy={[40,15,25,35,20][i]} r="5" fill="currentColor" />)}</svg>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Resume → Discover → Apply → Prepare → Decide. Start anywhere; each opportunity can take a different path.</p>
          <Link to="/jobs?start=1" className={link}>Set up my search</Link><br /><Link to="/jobs" className={link}>See all career steps</Link>
        </section>
      </aside>
    </div>
    <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10"><summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>More actions and automation</summary>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Review the full queue, record an employer response or manage your application agent and its permissions.</p>
      <div className="mt-3 flex flex-wrap gap-3"><Link to="/jobs/actions" className={link}>All daily actions</Link><Link to="/jobs?work=updates" className={link}>Record a reply</Link><Link to="/jobs/journey" className={link}>Application agent</Link><Link to="/jobs/weekly" className={link}>Weekly plan</Link></div>
      <Button variant="secondary" className="mt-3" onClick={reload}>Refresh saved dates</Button>
    </details>
  </div>;
}
