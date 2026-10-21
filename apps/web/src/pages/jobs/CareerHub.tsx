import { lazy, Suspense, useEffect } from "react";
import { Link, useNavigationType, useSearchParams } from "react-router-dom";
import { cx, focusRing } from "@orbit/ui";
import { ErrorNote } from "../../components/ui";
import { useJobsAi } from "./JobsAi";

const Messages = lazy(() => import("./MessageUpdate").then((m) => ({ default: m.MessageInbox })));
const Companion = lazy(() => import("./CareerCompanion").then((m) => ({ default: m.CareerCompanion })));
const Setup = lazy(() => import("./CareerLaunchpad").then((m) => ({ default: m.CareerLaunchpad })));
const link = cx("inline-flex min-h-11 items-center rounded py-2 text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);

const TITLES = {
  updates: ["Record an employer reply", "Paste a reply, review what it means, then confirm any stage or date change."],
  resume: ["Guided resume", "Add, import or edit your resume one section at a time."],
  plan: ["Next-step guidance", "An optional plan grounded in your saved career activity."],
  start: ["Search setup", "Choose the resume, roles and places your job search starts from."],
} as const;

/** Focused career panels opened from Today and search (/jobs?work=updates|resume|plan, /jobs?start=1). The old
 *  launchpad overview is Today itself (JobsTodayPage redirects there). */
export function CareerHub() {
  const { profile, tracker } = useJobsAi();
  const [params, setParams] = useSearchParams();
  const raw = params.get("work");
  const work = raw === "updates" || raw === "resume" || raw === "plan" ? raw : "start";
  const resumeId = params.get("resume_id") ?? undefined;
  const navigationType = useNavigationType();
  useEffect(() => { if (navigationType !== "POP") window.scrollTo(0, 0); }, [work, navigationType]);
  const [title, description] = TITLES[work];
  return <div className="min-w-0 space-y-5 break-words">
    <Link to="/" className={link}>← Back to Today</Link>
    <header><h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{description}</p></header>
    {(profile.error || tracker.error) && <ErrorNote onRetry={() => { profile.reload(); tracker.reload(); }}>Some saved information could not load. You can still continue, or retry.</ErrorNote>}
    {work === "updates" ? <Suspense fallback={<p role="status">Opening employer updates…</p>}><Messages /></Suspense>
      : work === "start" ? <Suspense fallback={<p role="status">Opening search setup…</p>}><Setup /></Suspense>
      : <Suspense fallback={<p role="status">Opening your career companion…</p>}><Companion mode={work} resumeId={resumeId} onSelect={(id) => { const query = new URLSearchParams(params); query.set("resume_id", id); setParams(query); }} /></Suspense>}
  </div>;
}
