import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Button, CalendarPlus, ErrorNote, Gauge, MessageSquareQuote, Plus, Reveal, Search, Skeleton, Sparkles, Zap, buttonClass,
  cx, focusRing,
} from "@orbit/ui";
import type { JobStatus } from "@orbit/types";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { CareerCompanion } from "./jobs/CareerCompanion";
import { missionPath } from "./jobs/paths";
import { WeekStrip } from "./WeekStrip";
import { StagePill } from "./jobs/StagePill";
import { Stat } from "./prepare/parts";
const SecurityNotice = lazy(() => import("./SecurityActivity").then((m) => ({ default: m.SecurityNotice })));
// The seven-day action queue (interviews, follow-ups, applications to review) lives here; /jobs/actions redirects.
const Actions = lazy(() => import("./jobs/ActionDesk").then((m) => ({ default: m.JobActionDeskPage })));
const link = cx("workspace-text-link", focusRing);
const stages = [
  { to: "/career", label: "Resume & experience", detail: "Keep your reviewed career identity current." },
  { to: "/jobs/matches", label: "Find an opportunity", detail: "Discover a role or add one you found." },
  { to: "/jobs/tracker", tab: "resume", label: "Prepare an application", detail: "Review the resume and materials for this job." },
  { to: "/prepare", tab: "practice", label: "Practice with Saba", detail: "Rehearse with the right job and resume context." },
  { to: "/jobs/tracker", tab: "interview", label: "Manage interview rounds", detail: "Keep recorded dates, notes and next steps together." },
  { to: "/offers", tab: "offer", label: "Review an offer", detail: "Work with the terms you actually record." },
];
const PIPELINE: { status: JobStatus; label: string; hint: string }[] = [
  { status: "saved", label: "Saved", hint: "Shortlisted, not applied yet" },
  { status: "applied", label: "Applied", hint: "Waiting to hear back" },
  { status: "interviewing", label: "Interviewing", hint: "In an interview process" },
  { status: "offer", label: "Offers", hint: "To decide on" },
];
const QUICK = [
  { to: "/jobs?work=updates", label: "Record an employer reply", icon: MessageSquareQuote },
  { to: "/jobs?work=updates&input=calendar", label: "Import an interview invitation", icon: CalendarPlus },
  { to: "/jobs/journey", label: "Auto-apply", icon: Zap },
  { to: "/jobs/weekly", label: "Weekly progress", icon: Gauge },
  { to: "/jobs?work=plan", label: "Next-step guidance", icon: Sparkles },
];
/** "Good morning" by the viewer's own clock. */
export function greeting(hour: number): string {
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
function savedDate(value: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/** Today prioritizes source records, with contextual shortcuts rather than a second tool catalogue. */
export function HomePage() {
  const { user } = useAuth();
  const now = new Date();
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
    <header className="workspace-heading"><div className="min-w-0">
      <p className="workspace-eyebrow">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1>{greeting(now.getHours())}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
      <p className="workspace-description">Your next move, with the whole search in view.</p></div>
      <div className="flex flex-wrap gap-2">
        <Link className={buttonClass("secondary")} to="/jobs/tracker?add=1"><Plus className="h-4 w-4" aria-hidden /> Add a job</Link>
        <Link className={buttonClass("primary")} to="/jobs/matches"><Search className="h-4 w-4" aria-hidden /> Find jobs</Link>
      </div>
    </header>
    <Reveal stagger as="nav" aria-label="Your pipeline" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {PIPELINE.map((p) => <Link key={p.status} to={`/jobs/tracker?status=${p.status}`} className={cx("block rounded-xl motion-safe:transition-transform motion-safe:hover:-translate-y-0.5", focusRing)}>
        <Stat label={p.label} value={tracker.data ? tracker.data.filter((j) => j.status === p.status).length : null} hint={p.hint} /></Link>)}
    </Reveal>
    <Suspense fallback={null}><SecurityNotice /></Suspense>
    <WeekStrip />
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <CareerCompanion mode="home" onSelect={() => undefined} />
        <section aria-labelledby="active-opportunities" className="workspace-panel overflow-hidden">
          <div className="workspace-section-heading"><div><h2 id="active-opportunities" className="text-xl font-semibold">Opportunities in motion</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Materials, practice and interview rounds stay with each role.</p></div><Link className={link} to="/jobs/tracker">View all</Link></div>
          {active.length > 1 && <label className="mx-5 mb-4 block max-w-sm text-sm sm:mx-6">Show in this list<select className={cx("mt-2 min-h-11 w-full rounded-lg border border-zinc-300 bg-white p-2 dark:border-white/15 dark:bg-zinc-900", focusRing)} value={validFocus} onChange={(event) => setFocused(event.target.value)}><option value="">All active opportunities</option>{active.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.company}</option>)}</select></label>}
          {tracker.error ? <div className="p-5"><ErrorNote onRetry={reload}>Saved opportunities could not load.</ErrorNote></div> : tracker.loading && !tracker.data ? <div className="p-5"><Skeleton variant="line" count={2} label="Loading opportunities" /></div> : visible.length ? <Reveal as="ul" stagger className="divide-y divide-zinc-200 dark:divide-white/10">{visible.map((job) => <li key={job.id} className="workspace-opportunity-row motion-safe:transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"><div className="min-w-0 flex-1"><p className="mb-1 text-xs text-zinc-600 dark:text-zinc-400">{job.company}</p><h3 className="break-words text-base font-semibold"><Link className={cx("rounded hover:underline underline-offset-4", focusRing)} to={missionPath(job.id)}>{job.title}</Link></h3>{Number.isFinite(savedDate(job.next_at)) && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Recorded next date · {new Date(job.next_at!).toLocaleString()}</p>}</div><StagePill status={job.status} /><Link className={link} aria-label={`Open ${job.title} at ${job.company}`} to={missionPath(job.id)}>Open <ArrowRight aria-hidden className="h-4 w-4" /></Link></li>)}</Reveal> : <div className="mx-5 mb-5 rounded-lg border border-dashed border-zinc-300 p-5 sm:mx-6 sm:mb-6 dark:border-white/20"><h3 className="text-base font-semibold">A place for your next opportunity</h3><p className="mt-2 max-w-lg text-sm text-zinc-600 dark:text-zinc-400">Save a job to keep its resume, application and preparation together.</p><div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2"><Link className={buttonClass("secondary")} to="/jobs/matches">Discover opportunities</Link><Link className={link} to="/jobs/tracker?add=1">Add a job link or description</Link></div></div>}
        </section>
        <section aria-labelledby="needs-attention" className="workspace-panel p-5 sm:p-6"><Suspense fallback={<Skeleton variant="line" count={3} label="Loading your actions" />}><Actions embedded /></Suspense></section>
      </div>
      <aside className="min-w-0 space-y-4" aria-label="Career journey shortcuts">
        <nav aria-labelledby="journey-shortcuts" className="workspace-panel p-5 sm:p-6"><h2 id="journey-shortcuts" className="text-lg font-semibold">Move between steps</h2><p className="mt-2 break-words text-sm text-zinc-600 dark:text-zinc-400">{selected ? `${selected.title} · ${selected.company}` : "Start wherever you are. Each opportunity moves at its own pace."}</p><ol className="mt-5">{stages.map((stage, index) => <li key={stage.label} className="workspace-journey-step"><span aria-hidden className="workspace-step-number">{String(index + 1).padStart(2, "0")}</span><Link className={cx("min-w-0 flex-1 rounded py-1", focusRing)} to={selected && stage.tab ? `${missionPath(selected.id)}?tab=${stage.tab}` : stage.to}><span className="block text-sm font-semibold">{stage.label}</span><span className="mt-1 block text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{stage.detail}</span></Link></li>)}</ol><p className="mt-4 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-600 dark:border-white/10 dark:text-zinc-400">Shortcuts are not completion markers. {selected ? "They follow the opportunity shown here. Your next action still considers your full search." : "Open a saved opportunity for its own progress and next steps."}</p></nav>
        <section aria-labelledby="quick-actions" className="workspace-panel p-5"><h2 id="quick-actions" className="text-lg font-semibold">Quick actions</h2>
          <ul className="mt-3 space-y-1">{QUICK.map((q) => <li key={q.to}><Link to={q.to} className={cx("group flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-zinc-50 dark:hover:bg-white/5", focusRing)}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700 motion-safe:transition-colors group-hover:bg-indigo-600 group-hover:text-white dark:bg-indigo-500/10 dark:text-indigo-300"><q.icon className="h-4 w-4" aria-hidden /></span>
            <span className="flex-1">{q.label}</span><ArrowRight className="h-3.5 w-3.5 text-zinc-400 motion-safe:transition-transform group-hover:translate-x-0.5" aria-hidden /></Link></li>)}</ul>
          <Button variant="ghost" size="sm" className="mt-2" onClick={reload}>Refresh opportunities</Button></section>
      </aside>
    </div>
  </div>;
}
