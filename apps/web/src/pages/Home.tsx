import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Button, ErrorNote, Skeleton, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { CareerCompanion } from "./jobs/CareerCompanion";
import { missionPath } from "./jobs/paths";
import { STATUS_LABEL } from "./jobs/model";
const SecurityNotice = lazy(() => import("./SecurityActivity").then((m) => ({ default: m.SecurityNotice })));
const link = cx("workspace-text-link", focusRing);
const stages = [
  { to: "/career", label: "Resume & experience", detail: "Keep your reviewed career identity current." },
  { to: "/jobs/matches", label: "Find an opportunity", detail: "Discover a role or add one you found." },
  { to: "/jobs/tracker", tab: "resume", label: "Prepare an application", detail: "Review the resume and materials for this job." },
  { to: "/prepare", tab: "practice", label: "Practice with Saba", detail: "Rehearse with the right job and resume context." },
  { to: "/jobs/tracker", tab: "interview", label: "Manage interview rounds", detail: "Keep recorded dates, notes and next steps together." },
  { to: "/offers", tab: "offer", label: "Review an offer", detail: "Work with the terms you actually record." },
];
function savedDate(value: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/** Today prioritizes source records, with contextual shortcuts rather than a second tool catalogue. */
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
  const selected = !tracker.error ? active.find((job) => job.id === validFocus) ?? (active.length === 1 ? active[0] : undefined) : undefined;
  const visible = (validFocus ? active.filter((job) => job.id === validFocus) : active).slice().sort((a, b) => {
    const first = savedDate(a.next_at), second = savedDate(b.next_at);
    return (first === second ? 0 : first - second) || a.id.localeCompare(b.id);
  }).slice(0, 5);
  return <div className="workspace-page">
    <header className="workspace-heading"><div className="min-w-0"><p className="workspace-eyebrow">Personal workspace</p><h1>Today</h1><p className="workspace-description">Your next move, with the whole search in view.</p></div><Link className={link} to="/career">My career identity <ArrowRight aria-hidden className="h-4 w-4" /></Link></header>
    <Suspense fallback={null}><SecurityNotice /></Suspense>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <CareerCompanion mode="home" onSelect={() => undefined} />
        <section aria-labelledby="active-opportunities" className="workspace-panel overflow-hidden">
          <div className="workspace-section-heading"><div><p className="workspace-eyebrow">Applications</p><h2 id="active-opportunities" className="mt-1 text-xl font-semibold">Opportunities in motion</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Materials, practice and interview rounds stay with each role.</p></div><Link className={link} to="/jobs/tracker">View all</Link></div>
          {active.length > 1 && <label className="mx-5 mb-4 block max-w-sm text-sm sm:mx-6">Show in this list<select className={cx("mt-2 min-h-11 w-full rounded-lg border border-zinc-300 bg-white p-2 dark:border-white/15 dark:bg-zinc-900", focusRing)} value={validFocus} onChange={(event) => setFocused(event.target.value)}><option value="">All active opportunities</option>{active.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.company}</option>)}</select></label>}
          {tracker.error ? <div className="p-5"><ErrorNote onRetry={reload}>Saved opportunities could not load.</ErrorNote></div> : tracker.loading && !tracker.data ? <div className="p-5"><Skeleton variant="line" count={2} label="Loading opportunities" /></div> : visible.length ? <ul className="divide-y divide-zinc-200 dark:divide-white/10">{visible.map((job) => <li key={job.id} className="workspace-opportunity-row"><div className="min-w-0 flex-1"><p className="mb-1 text-xs text-zinc-600 dark:text-zinc-400">{job.company}</p><h3 className="break-words text-base font-semibold"><Link className={cx("rounded hover:underline underline-offset-4", focusRing)} to={missionPath(job.id)}>{job.title}</Link></h3>{Number.isFinite(savedDate(job.next_at)) && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Recorded next date · {new Date(job.next_at!).toLocaleString()}</p>}</div><span className="workspace-status">{STATUS_LABEL[job.status]}</span><Link className={link} aria-label={`Open ${job.title} at ${job.company}`} to={missionPath(job.id)}>Open <ArrowRight aria-hidden className="h-4 w-4" /></Link></li>)}</ul> : <div className="mx-5 mb-5 rounded-lg border border-dashed border-zinc-300 p-5 sm:mx-6 sm:mb-6 dark:border-white/20"><h3 className="text-base font-semibold">A place for your next opportunity</h3><p className="mt-2 max-w-lg text-sm text-zinc-600 dark:text-zinc-400">Save a job to keep its resume, application and preparation together.</p><div className="mt-3 flex flex-wrap gap-x-5"><Link className={link} to="/jobs/matches">Discover opportunities</Link><Link className={link} to="/jobs/tracker?add=1">Add a job link or description</Link></div></div>}
        </section>
      </div>
      <aside className="min-w-0 space-y-4" aria-label="Career journey shortcuts">
        <nav aria-labelledby="journey-shortcuts" className="workspace-panel p-5 sm:p-6"><p className="workspace-eyebrow">Your journey</p><h2 id="journey-shortcuts" className="mt-2 text-lg font-semibold">Move between steps</h2><p className="mt-2 break-words text-sm text-zinc-600 dark:text-zinc-400">{selected ? `${selected.title} · ${selected.company}` : "Start wherever you are. Each opportunity moves at its own pace."}</p><ol className="mt-5">{stages.map((stage, index) => <li key={stage.label} className="workspace-journey-step"><span aria-hidden className="workspace-step-number">{String(index + 1).padStart(2, "0")}</span><Link className={cx("min-w-0 flex-1 rounded py-1", focusRing)} to={selected && stage.tab ? `${missionPath(selected.id)}?tab=${stage.tab}` : stage.to}><span className="block text-sm font-semibold">{stage.label}</span><span className="mt-1 block text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{stage.detail}</span></Link></li>)}</ol><p className="mt-4 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-600 dark:border-white/10 dark:text-zinc-400">Shortcuts are not completion markers. {selected ? "They follow the opportunity shown here. Your next action still considers your full search." : "Open a saved opportunity for its own progress and next steps."}</p></nav>
        <details className="workspace-panel p-5"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Activity & controls</summary><div className="mt-3 flex flex-col items-start"><Link to="/jobs/actions" className={link}>Action history & reminders</Link><Link to="/jobs?work=updates" className={link}>Record an employer reply</Link><Link to="/jobs/journey" className={link}>Application permissions</Link><Link to="/jobs/weekly" className={link}>Weekly progress</Link><Link to="/jobs?work=plan" className={link}>Optional next-step guidance</Link></div><Button variant="secondary" className="mt-3" onClick={reload}>Refresh opportunities</Button></details>
      </aside>
    </div>
  </div>;
}
