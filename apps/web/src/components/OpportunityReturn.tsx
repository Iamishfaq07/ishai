import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { OpportunityContext } from "@orbit/types";
import { Button, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { careerToolHref, opportunityReturnHref, opportunityTrail, type OpportunityTrail } from "../lib/opportunityTrail";

/** No request without explicit job context. Account/job changes remount private metadata without a shared cache. */
export function OpportunityReturn() {
  const [params] = useSearchParams();
  const trail = opportunityTrail(params);
  return trail ? <AuthenticatedReturn trail={trail} /> : null;
}

function AuthenticatedReturn({ trail }: { trail: OpportunityTrail }) {
  const { user } = useAuth();
  return user && trail ? <OwnedReturn key={`${user.id}:${trail.jobId}`} trail={trail} /> : null;
}

function OwnedReturn({ trail }: { trail: OpportunityTrail }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const [context, setContext] = useState<OpportunityContext | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);
  const busyRef = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++seq.current; busyRef.current = true; setBusy(true); setError(false);
    try { const next = await api.opportunityContext(trail.jobId); if (request === seq.current) setContext(next); }
    catch { if (request === seq.current) { setContext(null); setError(true); } }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(false); } }
  }, [trail.jobId]);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => { void refresh(); return cancel; }, [refresh, cancel]);
  useEffect(() => {
    const onReturn = () => { if (!busyRef.current && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [refresh]);
  const leaveContext = () => {
    const next = new URLSearchParams(params);
    for (const key of ["job", "career_from", "requirement", "practice_kind", "practice_step", "workshop"]) next.delete(key);
    setParams(next, { replace: true });
  };
  const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing);
  const inLibrary = pathname.startsWith("/documents/");
  return <aside aria-label="Continue the selected job" className="mb-5 min-w-0 rounded-2xl border border-indigo-200 bg-indigo-500/5 p-4 dark:border-indigo-400/25">
    {busy && !context && <p role="status" className="text-sm">Opening your job context…</p>}
    {error && <div className="space-y-2"><p role="status" className="text-sm">Job context could not load. Retry or choose a job in your tracker.</p><div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Retry</Button><Link className={link} to="/jobs/tracker">Open tracker</Link><Button variant="ghost" onClick={leaveContext}>Use this tool on its own</Button></div></div>}
    {context && <>
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Working toward this opportunity</p>
      <p className="mt-1 break-words text-sm font-semibold">{context.title} · {context.company}</p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Keep this job in view as you learn, record real examples and practise. Saved examples stay in your personal library.</p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <Link className={link} to={opportunityReturnHref(trail)}>{trail.from === "fit" && (trail.workshop || trail.requirement) ? "Back to your practice plan" : "Back to this job"}</Link>
        {!inLibrary ? <Link className={link} to={careerToolHref("/documents/stories", params)}>Record a real example</Link> : pathname === "/documents/stories" && context.evidence_enabled ? <Link className={link} to={careerToolHref("/documents/evidence", params)}>Review evidence</Link> : <Link className={link} to={opportunityReturnHref(trail, "practice")}>Practise for this job</Link>}
      </div>
      <details className="mt-2"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-xs font-semibold", focusRing)}>Related tools for this job</summary><div className="flex flex-wrap gap-x-5">
        {pathname !== "/learn" && <Link className={link} to={careerToolHref("/learn", params)}>Learning</Link>}
        {pathname !== "/code" && <Link className={link} to={careerToolHref("/code", params)}>Coding</Link>}
        {pathname !== "/documents/stories" && <Link className={link} to={careerToolHref("/documents/stories", params)}>Story bank</Link>}
        {context.evidence_enabled && pathname !== "/documents/evidence" && <Link className={link} to={careerToolHref("/documents/evidence", params)}>Evidence</Link>}
        <Link className={link} to={opportunityReturnHref(trail, "resume")}>Review linked resume</Link>
      </div><Button variant="ghost" onClick={leaveContext}>Use this tool on its own</Button></details>
    </>}
  </aside>;
}
