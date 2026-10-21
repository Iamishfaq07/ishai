import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Skeleton, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { CareerCompanion } from "./jobs/CareerCompanion";
import { missionPath } from "./jobs/paths";
import { STATUS_LABEL } from "./jobs/model";
const SecurityNotice = lazy(() => import("./SecurityActivity").then((m) => ({ default: m.SecurityNotice })));
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing);
const stages = [["/career", "01", "My resume"], ["/jobs/matches", "02", "Discover"], ["/jobs/tracker", "03", "Apply"], ["/prepare", "04", "Prepare"], ["/jobs/tracker", "05", "Interview"], ["/offers", "06", "Offer"]];

/** Today is the operational launchpad; source records and the existing planner determine urgency. */
export function HomePage() {
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const [focused, setFocused] = useState("");
  const reload = tracker.reload;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [reload]);
  const active = tracker.data?.filter((job) => !["hired", "withdrawn", "rejected"].includes(job.status)) ?? [];
  const validFocus = active.some((job) => job.id === focused) ? focused : "";
  const visible = (validFocus ? active.filter((job) => job.id === validFocus) : active).slice().sort((a, b) => {
    const date = (value: string | null) => value ? Date.parse(value) : Number.POSITIVE_INFINITY;
    return date(a.next_at) - date(b.next_at) || a.id.localeCompare(b.id);
  }).slice(0, 5);
  return <div className="min-w-0 space-y-6 break-words">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">Your career, in motion</p><h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Today</h1><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">A clear next move. Your whole search in view.</p></div><Link className={link} to="/career">My career identity</Link></header>
    <Suspense fallback={null}><SecurityNotice /></Suspense>
    <CareerCompanion mode="home" onSelect={() => undefined} />
    <nav aria-label="Your career journey" className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-900"><ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">{stages.map(([to, number, label]) => <li key={number}><Link to={to!} className={cx("block min-h-16 rounded-xl px-2 py-3 text-sm sm:p-3 hover:bg-zinc-500/5 motion-safe:transition-colors", focusRing)}><span className="block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{number}</span><span className="mt-1 block font-semibold">{label}</span></Link></li>)}</ol><p className="px-3 pb-2 text-xs text-zinc-600 dark:text-zinc-400">Choose any step. Every opportunity has its own pace.</p></nav>
    <section aria-labelledby="active-opportunities" className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="active-opportunities" className="font-display text-xl font-semibold">Your opportunities</h2><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Keep each role’s materials, practice and next round together.</p></div><Link className={link} to="/jobs/tracker">All applications</Link></div>
      {active.length > 1 && <label className="mt-4 block max-w-sm text-sm">Focus an opportunity<select className={cx("mt-1 min-h-11 w-full rounded-lg border border-zinc-300 bg-white p-2 dark:border-white/10 dark:bg-zinc-900", focusRing)} value={active.some((job) => job.id === focused) ? focused : ""} onChange={(event) => setFocused(event.target.value)}><option value="">All active opportunities</option>{active.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.company}</option>)}</select></label>}
      {tracker.error ? <ErrorNote onRetry={reload}>Saved opportunities could not load.</ErrorNote> : tracker.loading && !tracker.data ? <Skeleton variant="line" count={2} label="Loading opportunities" /> : visible.length ? <ul className="mt-4 divide-y divide-zinc-200 dark:divide-white/10">{visible.map((job) => <li key={job.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{job.title}</h3><p className="mt-1 break-words text-xs text-zinc-600 dark:text-zinc-400">{job.company} · {STATUS_LABEL[job.status]}{job.next_at ? ` · ${new Date(job.next_at).toLocaleString()}` : ""}</p></div><Link className={link} to={`${missionPath(job.id)}?guide=1`}>Open opportunity</Link></li>)}</ul> : <div className="mt-5 rounded-xl bg-zinc-500/5 p-5"><p className="text-sm">Your next opportunity starts with a saved job.</p><Link className={link} to="/jobs/matches">Discover opportunities</Link><span className="mx-3 text-xs text-zinc-500">or</span><Link className={link} to="/jobs/tracker?add=1">Add a job you found elsewhere</Link></div>}
    </section>
    <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Activity, planning and automation controls</summary><div className="mt-3 flex flex-wrap gap-x-5"><Link to="/jobs/actions" className={link}>Full action history & reminders</Link><Link to="/jobs?work=updates" className={link}>Record an employer reply</Link><Link to="/jobs/journey" className={link}>Application permissions</Link><Link to="/jobs/weekly" className={link}>Weekly progress</Link><Link to="/jobs?work=plan" className={link}>Optional next-step guidance</Link></div><Button variant="secondary" className="mt-3" onClick={reload}>Refresh opportunities</Button></details>
  </div>;
}