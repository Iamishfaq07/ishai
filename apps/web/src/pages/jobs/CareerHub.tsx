import { lazy, Suspense, useEffect, useRef } from "react";
import { Link, useNavigationType, useSearchParams } from "react-router-dom";
import { ArrowRight, BookmarkCheck, FileText, Search, Sparkles, Users, cx, focusRing } from "@orbit/ui";
import { ErrorNote } from "../../components/ui";
import { useJobsAi } from "./JobsAi";

const Companion = lazy(() => import("./CareerCompanion").then((m) => ({ default: m.CareerCompanion })));
const Setup = lazy(() => import("./CareerLaunchpad").then((m) => ({ default: m.CareerLaunchpad })));
const link = cx("inline-flex min-h-11 items-center rounded py-2 text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);

/** A single front door, organized by the candidate's journey. Tools keep their existing routes and saved work. */
export function CareerHub() {
  const { profile, tracker } = useJobsAi();
  const [params, setParams] = useSearchParams();
  const work = params.get("work");
  const resumeId = params.get("resume_id") ?? undefined;
  const setup = params.get("start") === "1";
  const navigationType = useNavigationType();
  const stepsRef = useRef<HTMLElement>(null);
  const headingsRef = useRef<(HTMLHeadingElement | null)[]>([]);
  const jump = (target: HTMLElement | null) => {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  useEffect(() => { if (navigationType !== "POP") window.scrollTo(0, 0); }, [setup, work, navigationType]);
  const resumes = profile.data?.resumes.length;
  const entries = tracker.data;
  const active = entries?.filter((entry) => !["rejected", "withdrawn", "hired"].includes(entry.status)).length;
  const role = profile.data?.prefs.titles[0] ?? "";
  const practice = role ? `/mock?${new URLSearchParams({ role })}` : "/mock";
  const stages = [
    { title: "Resume & direction", icon: FileText, detail: "Turn your education, projects and experience into a clear starting point.",
      status: profile.error ? "Resume count unavailable" : resumes === undefined ? "Loading resumes…" : `${resumes} saved resume${resumes === 1 ? "" : "s"}`,
      to: "/jobs?work=resume", action: "Add or edit a resume", tools: [["/jobs?start=1", "Search setup"], ["/resume-ai", "All resumes"], ["/learn", "Build skills"]] },
    { title: "Find the right jobs", icon: Search, detail: "Explore matches, check requirements and save roles that interest you.",
      status: profile.data?.saved ? "Uses your saved search preferences" : "You can browse before completing setup",
      to: "/jobs/matches", action: "Find jobs", tools: [["/jobs/profile", "Search preferences"], ["/linkedin", "Professional profiles"]] },
    { title: "Apply & connect", icon: Users, detail: "Manage applications, review agent work and find people at the company.",
      status: tracker.error ? "Tracker count unavailable" : active === undefined ? "Loading tracker…" : `${active} active tracked application${active === 1 ? "" : "s"}`,
      to: "/jobs/tracker", action: "My applications", tools: [["/jobs/tracker?add=1", "Add a job or interview"], ["/jobs/journey", "Auto-apply agent"], ["/jobs/applications", "Review queue"], ["/jobs/outreach?network=1", "Contacts & outreach"]] },
    { title: "Prepare for interviews", icon: Sparkles, detail: "Practise with Saba, try a video interview and use each tracked job’s preparation tools.",
      status: role ? `Practice role: ${role}` : "Choose a role in practice setup",
      to: practice, action: "Practice with Saba", tools: [["/interview", "Video interview"], ["/jobs/tracker", "Prepare for a saved job"], ["/start", "Live interview copilot"]] },
    { title: "Review an offer", icon: BookmarkCheck, detail: "Compare the details, understand trade-offs and prepare your questions.",
      status: "Use when you have offer details to review",
      to: "/offers", action: "Compare offers", tools: [["/jobs/tracker", "Record an outcome"], ["/jobs/weekly", "Weekly plan & progress"]] },
  ];
  return <div className="min-w-0 space-y-5 break-words">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">Personal Orbit</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Career launchpad</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">From your first resume to your next role. Follow the steps or jump straight to the tool you need.</p></div>
    </header>
    {(profile.error || tracker.error) && <ErrorNote onRetry={() => { profile.reload(); tracker.reload(); }}>Some saved information could not load. You can still open your tools, or retry.</ErrorNote>}
    {work === "resume" || work === "plan" ? <>
      <Link to="/jobs" className={link}>← Back to all career steps</Link>
      <Suspense fallback={<p role="status">Opening your career companion…</p>}><Companion mode={work} resumeId={resumeId} onSelect={(id) => { const query = new URLSearchParams(params); query.set("resume_id", id); setParams(query); }} /></Suspense>
    </> : setup ? <>
      <Link to="/jobs" className={link}>← Back to all career steps</Link>
      <Suspense fallback={<p role="status">Opening search setup…</p>}><Setup /></Suspense>
    </> : <>
      <Suspense fallback={<p role="status">Finding your next step…</p>}><Companion mode="home" onSelect={() => undefined} /></Suspense>
      <nav ref={stepsRef} tabIndex={-1} aria-label="Jump to a career step" className="scroll-mt-24 rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
        <p className="mb-2 text-sm font-semibold">Choose your next career step</p>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">{["Resume", "Jobs", "Apply", "Interviews", "Offer"].map((label, index) => <li key={label}><button type="button" onClick={() => jump(headingsRef.current[index] ?? null)} className={cx("flex min-h-11 w-full items-center gap-2 rounded-xl bg-indigo-500/10 px-3 py-2 text-left text-sm font-medium hover:bg-indigo-500/20 motion-safe:transition-colors", focusRing)}><span aria-hidden className="text-indigo-700 dark:text-indigo-300">{index + 1}</span>{label}</button></li>)}</ol>
      </nav>
      <nav aria-label="Your career steps"><ol className="grid gap-4 lg:grid-cols-2">{stages.map((stage, index) => <li key={stage.title} className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-start gap-3"><span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"><stage.icon className="h-5 w-5" /></span>
          <div><p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Step {index + 1}</p><h2 tabIndex={-1} ref={(node) => { headingsRef.current[index] = node; }} className="mt-1 scroll-mt-28 rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">{stage.title}</h2></div></div>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{stage.detail}</p>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{stage.status}</p>
        <Link to={stage.to} className={cx("mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 motion-safe:transition-colors", focusRing)}>{stage.action}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
        <details className="mt-3"><summary className={cx("cursor-pointer rounded py-2 text-sm font-medium", focusRing)}>Tools for this step</summary>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-2">{stage.tools.map(([to, label]) => <li key={to}><Link className={link} to={to!}>{label}</Link></li>)}</ul>
        </details>
      </li>)}</ol></nav>
      <button type="button" className={link} onClick={() => jump(stepsRef.current)}>Back to career steps ↑</button>
    </>}
  </div>;
}
