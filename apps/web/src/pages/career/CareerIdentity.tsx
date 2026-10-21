import type { CandidateIdentity, CandidateIdentityUpdate } from "@orbit/types";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Skeleton, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

// Keep this purpose-specific typed client in the lazy career route, outside the every-page API bundle.
const identityPath = "/v1/jobs/launchpad/identity";
const readIdentity = () => api.call<CandidateIdentity>(identityPath);
const saveIdentity = (input: CandidateIdentityUpdate) => api.call<CandidateIdentity>(identityPath,
  { method: "PUT", body: JSON.stringify(input) });
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing);

/** Master selection is explicit; review binds the saved revision and never rewrites resume facts. */
export function CareerIdentity({ userId }: { userId: string }) {
  const identity = useAsync(() => readIdentity(), [userId], `candidate-identity:${userId}`);
  const [selected, setSelected] = useState("");
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null);
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = identity.data;
  const confirmed = Boolean(current && confirmedVersion === current.version);
  const reload = identity.reload;
  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [reload]);
  const choice = current?.resumes.find((resume) => resume.id === selected);
  const change = async (action: "select" | "approve" | "revoke") => {
    const resume = action === "select" ? choice : current?.master;
    if (!current || !resume || busy) return;
    setBusy(true); setError(null);
    try {
      const next = await saveIdentity({ version: current.version, action,
        resume_id: resume.id, resume_revision: resume.revision, independent_copy: action === "select" && copy });
      identity.setData(() => next); setConfirmedVersion(null); setSelected(""); setCopy(false);
    } catch (err) { setError(errorText(err)); setConfirmedVersion(null); }
    finally { setBusy(false); }
  };
  if (!current) return identity.error ? <ErrorNote onRetry={reload}>{errorText(identity.error)}</ErrorNote> : <Skeleton variant="card" count={2} label="Loading your career identity" />;
  const master = current.master;
  return <section aria-label="Your career identity" className="min-w-0 space-y-5">
    {identity.error && <ErrorNote onRetry={reload}>{errorText(identity.error)}</ErrorNote>}
    {error && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
    <section className="workspace-panel overflow-hidden">
      <header className="border-b border-zinc-200 p-5 sm:p-6 dark:border-white/10"><p className="workspace-eyebrow">Career identity</p>
        <h2 className="mt-3 font-display text-2xl font-semibold">{master ? current.name || master.title : "Start with your story."}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{master ? current.headline || "Your master resume is the reusable starting point for your career. Job copies stay separate." : "Bring a resume, build your first one, or explore opportunities while you decide. You can start anywhere."}</p>
        {!master && <div className="mt-4 flex flex-wrap gap-3"><Link className={link} to="/resume-ai?start=import&guide=1">Import my resume</Link><Link className={link} to="/resume-ai?start=new&guide=1">Build from scratch</Link><Link className={link} to="/jobs/matches">Explore jobs first</Link></div>}
      </header>
      <div className="grid min-w-0 gap-5 p-5 sm:p-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-3"><h3 className="text-sm font-semibold">My master resume</h3>
          {master ? <><p className="break-words font-display text-lg font-semibold">{master.title}</p><p className="text-xs text-zinc-600 dark:text-zinc-400">Revision {master.revision} · {current.review === "reviewed" ? `You reviewed this version ${formatDate(current.reviewed_at)}` : "Review this version before reusing its facts."}</p>
            <Link className={link} to={`/resume-ai/${encodeURIComponent(master.id)}?guide=1`}>Open Resume Studio</Link>
            {current.review !== "reviewed" && current.review !== "job_copy" && <div className="space-y-3 rounded-xl bg-indigo-500/5 p-3"><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmedVersion(event.target.checked ? current.version : null)} />I reviewed this version’s education, experience, projects and skills, and want to reuse these facts.</label><Button disabled={!confirmed || busy || Boolean(identity.error)} onClick={() => void change("approve")}>Confirm this version</Button></div>}
            {current.review === "job_copy" && <p className="text-sm text-amber-800 dark:text-amber-200">This resume is used by a job. Select it below with an independent master copy to keep future job edits separate.</p>}
            {current.review === "reviewed" && <Button variant="ghost" disabled={busy} onClick={() => void change("revoke")}>Mark for review again</Button>}
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Your confirmation records your review; Orbit does not independently verify employment or qualifications. Later edits require a fresh review.</p>
          </> : <p className="text-sm text-zinc-600 dark:text-zinc-400">{current.review === "missing" ? "Your previous master was deleted. Choose another saved resume." : "No master selected. A newer resume never becomes your master automatically."}</p>}
        </div>
        <div className="min-w-0 space-y-3"><h3 className="text-sm font-semibold">What this resume contains</h3>
          {master ? <><dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[[current.education_count, "Education"], [current.project_count, "Projects"], [current.experience_count, "Experience"]].map(([count, label]) => <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-500/5 p-3 sm:block"><dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt><dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{count}</dd></div>)}</dl><p className="break-words text-sm text-zinc-600 dark:text-zinc-400">{current.skills.length ? current.skills.join(" · ") : "Add only skills you can honestly explain or demonstrate."}</p><p className="text-xs text-zinc-600 dark:text-zinc-400">These are saved entries, not a readiness score. Work experience is optional for freshers.</p></> : <p className="text-sm text-zinc-600 dark:text-zinc-400">Your approved resume becomes the shared starting point. Real coursework and personal projects are valid first examples.</p>}
          <details className="border-t border-zinc-200 pt-3 dark:border-white/10" open={!master || undefined}><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>{master ? "Choose another master" : "Choose a saved resume"}</summary>
            {current.resumes.length ? <div className="mt-2 space-y-3"><label className="block text-sm">Saved resume<select aria-label="Saved resume for master" className={cx("mt-1 min-h-11 w-full rounded-lg border border-zinc-300 bg-white p-2 dark:border-white/10 dark:bg-zinc-900", focusRing)} value={selected} onChange={(event) => { setSelected(event.target.value); setCopy(false); setConfirmedVersion(null); }}><option value="">Choose a resume…</option>{current.resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.title}{resume.job_specific ? " · job copy" : ""}</option>)}</select></label>
              {choice?.job_specific && <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={copy} onChange={(event) => setCopy(event.target.checked)} />Create an independent master copy. Keep the original job resume unchanged.</label>}
              <Button variant="secondary" disabled={!choice || busy || Boolean(choice.job_specific && !copy)} onClick={() => void change("select")}>Use as my master</Button><p className="text-xs text-zinc-600 dark:text-zinc-400">This also selects the starting resume for Discover. It does not approve facts or overwrite an existing resume.</p></div> : <p className="text-sm text-zinc-600 dark:text-zinc-400">Create or import your first resume above. No repeat upload is needed after it is saved.</p>}
          </details>
        </div>
      </div>
    </section>
    <section aria-labelledby="career-direction" className="workspace-panel p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Your direction</p><h2 id="career-direction" className="mt-2 font-display text-xl font-semibold">{current.target_roles.length ? current.target_roles.join(" · ") : "What would you like to do next?"}</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{current.target_roles.length || current.locations.length ? [...current.locations, ...current.workplace].join(" · ") : "Choose your target roles, locations and work preferences when you are ready."}</p></div><Link className={link} to="/jobs/profile">Edit career goals</Link></div>
      <div className="mt-4 flex flex-wrap gap-x-5"><Link className={link} to="/jobs/matches">Discover opportunities</Link><Link className={link} to="/">Return to Today</Link></div>
      {master && !current.search_uses_master && <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">Discover currently uses a different resume. Review search preferences before continuing; your master has not changed.</p>}
    </section>
  </section>;
}
