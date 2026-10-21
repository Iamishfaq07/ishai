import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RequirementPractice } from "@orbit/types";
import { Button, ErrorNote, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { careerToolHref } from "../../lib/opportunityTrail";

const Coach = lazy(() => import("./GuidedOpportunity").then((module) => ({ default: module.OpportunityCoach })));
const steps = ["Understand", "Try", "Review", "Rehearse"];
const formats = {
  project: { label: "A small project", task: "Choose one narrow problem. Build a small demonstration with public or synthetic data, then keep the artifact and a short README.", artifact: "A working example, diagram or project file with setup notes and limitations." },
  explanation: { label: "An explanation", task: "Explain one concept in your own words. Work through a small example, compare an alternative and say where the explanation stops being useful.", artifact: "Your explanation, worked example, one alternative and known limitations." },
  code: { label: "A coding exercise", task: "Write a small solution yourself. Keep the code, the input/output you actually observed, and an explanation of edge cases and trade-offs.", artifact: "Your code, observed checks, setup instructions and a short trade-off explanation." },
};
type Kind = keyof typeof formats;
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing);

/** Planning and navigation only. No automatic story/evidence write, completion assertion or resume change. */
export function RequirementWorkshop({ entryId, onRehearse }: { entryId: string; onRehearse: () => void }) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.has("requirement") || params.get("workshop") === "1");
  const [view, setView] = useState<RequirementPractice | null>(null);
  const [defaultKey, setDefaultKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = useCallback(async (quiet = false) => {
    const request = ++seq.current; busyRef.current = true; setBusy(true); setError(null);
    if (!quiet) setView(null);
    try {
      const next = await api.requirementPractice(entryId);
      if (request !== seq.current) return;
      setView(next); setDefaultKey((old) => old ?? (next.requirements.find((item) => item.status !== "met") ?? next.requirements[0])?.key ?? null);
    } catch (err) { if (request === seq.current) { setView(null); setError(errorText(err)); } }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(false); } }
  }, [entryId]);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => {
    if (open) void refresh();
    return cancel;
  }, [refresh, open, cancel]);
  useEffect(() => { if (params.has("requirement") || params.get("workshop") === "1") setOpen(true); }, [params]);
  useEffect(() => {
    const onReturn = () => { if (open && !busyRef.current && document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    const timer = open ? window.setInterval(onReturn, 60_000) : undefined;
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); window.clearInterval(timer); };
  }, [open, refresh]);
  const selected = view?.requirements.find((item) => item.key === (params.get("requirement") ?? defaultKey));
  const rawKind = params.get("practice_kind");
  const kind: Kind = rawKind === "explanation" || rawKind === "code" ? rawKind : "project";
  const format = formats[kind];
  const rawStep = params.get("practice_step") ?? "0";
  const step = /^[0-3]$/.test(rawStep) ? Number(rawStep) : 0;
  const toolContext = new URLSearchParams(params);
  toolContext.set("job", entryId); toolContext.set("career_from", "fit"); toolContext.set("workshop", "1");
  toolContext.set("practice_kind", kind); toolContext.set("practice_step", String(step));
  if (selected) toolContext.set("requirement", selected.key);
  const choose = (name: string, value: string) => {
    const next = new URLSearchParams(params); next.set(name, value);
    if (name !== "practice_step") { next.set("practice_step", "0"); setCoachOpen(false); }
    setCopied(false); setParams(next);
    requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); });
  };
  const copyBrief = async () => {
    if (!selected) return;
    setError(null); setCopied(false);
    try {
      await navigator.clipboard.writeText(`Practice brief — not a completed achievement\nRequirement from a prior check: ${selected.title}\nCheck date: ${formatDate(view?.checked_at ?? null)}\nFormat: ${format.label}\nTask: ${format.task}\nArtifact: ${format.artifact}\nReview: compare the actual output with the original requirement; record limitations and only observed results.\nRehearse: explain what you actually did, the trade-offs and what you would improve.\nNothing here proves a skill or belongs on a resume before the work is done and reviewed.`);
      setCopied(true);
    } catch { setError("Could not copy the brief. You can select and copy the visible task text instead."); }
  };
  return <section aria-label="Requirement practice workshop" className="mt-4 min-w-0 rounded-2xl border border-indigo-200 p-4 dark:border-indigo-400/25">
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary id="requirement-practice-heading" className={cx("min-h-11 scroll-mt-28 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Turn one requirement into a practice plan<span className="mt-1 block text-xs font-normal text-zinc-600 dark:text-zinc-400">Learn → try → review → rehearse. Suitable for freshers and experienced candidates.</span></summary>
      <div className="mt-3 min-w-0 space-y-4">
        {busy && <p role="status" className="text-sm">{view ? "Refreshing the source check…" : "Reading this job’s prior fit check…"}</p>}
        {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
        {view && <>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Source: prior fit check {formatDate(view.checked_at)}. Its wording and quoted evidence may be outdated. Long requirements and quotes are excerpts; review the complete original job. Practice does not verify a skill or change the fit result.</p>
          {view.requirements.length === 0 ? <p className="text-sm">No requirement-level check is available. Use the fit check above, then return here to choose one specific requirement.</p> : <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-sm font-medium">Choose one requirement<select className={cx("mt-1 min-h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white p-2 text-sm dark:border-white/15 dark:bg-zinc-900", focusRing)} value={selected?.key ?? ""} onChange={(event) => choose("requirement", event.target.value)}>
                {!selected && <option value="" disabled>Source changed — choose a current requirement</option>}
                {view.requirements.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
              </select></label>
              <label className="min-w-0 text-sm font-medium">Choose a practice format<select className={cx("mt-1 min-h-11 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm dark:border-white/15 dark:bg-zinc-900", focusRing)} value={kind} onChange={(event) => choose("practice_kind", event.target.value)}>{Object.entries(formats).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
            </div>
            {selected && <div key={`${selected.key}:${kind}`} className="space-y-4">
              <nav aria-label="Practice project steps"><ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">{steps.map((label, index) => <li key={label}><button type="button" aria-current={step === index ? "step" : undefined} onClick={() => choose("practice_step", String(index))} className={cx("min-h-11 w-full rounded-xl border p-3 text-left text-sm motion-safe:transition-colors", step === index ? "border-indigo-500 bg-indigo-500/5 font-semibold" : "border-zinc-200 dark:border-white/10", focusRing)}>{index + 1}. {label}</button></li>)}</ol></nav>
              <div className="rounded-xl bg-zinc-500/5 p-4">
                <h3 ref={heading} tabIndex={-1} className="scroll-mt-28 rounded text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{step + 1}. {steps[step]}</h3>
                <p className="mt-2 break-words text-sm font-medium">{selected.title}</p>
                {step === 0 && <div className="mt-3 space-y-3 text-sm"><p>Check the original job. Pick one part you can demonstrate in a small example; ask for clarification if the requirement is ambiguous.</p>{selected.job_quote && <blockquote className="whitespace-pre-wrap break-words border-l-2 border-indigo-400 pl-3 text-xs">Job quoted in the prior check: “{selected.job_quote}”</blockquote>}{selected.candidate_quote && <blockquote className="whitespace-pre-wrap break-words border-l-2 border-zinc-400 pl-3 text-xs">Candidate material quoted in that check: “{selected.candidate_quote}”</blockquote>}<p className="text-xs text-zinc-600 dark:text-zinc-400">Prior check label: {selected.status}. This is historical model output, not an independently verified skill assessment.</p></div>}
                {step === 1 && <div className="mt-3 space-y-3 text-sm"><p>{format.task}</p><p><strong>Keep:</strong> {format.artifact}</p><p className="text-xs text-zinc-600 dark:text-zinc-400">Use public or synthetic inputs. Start with a smaller example if needed. A diagram or worked explanation is useful when coding does not match the requirement.</p><div className="flex flex-wrap gap-x-4"><Link className={link} to={careerToolHref("/learn", toolContext)}>Open learning tools</Link>{kind === "code" && <Link className={link} to={careerToolHref("/code", toolContext)}>Open coding practice</Link>}</div></div>}
                {step === 2 && <div className="mt-3 space-y-3 text-sm"><p>Compare the actual artifact with the original requirement. Record what worked, what failed, the inputs you used and the limits of your example.</p><p>Keep the date, artifact location and your own contribution. Use a number only if you measured it; a practice result does not establish professional experience.</p><p className="text-xs text-zinc-600 dark:text-zinc-400">There is no automatic completion or claim approval here. Existing fit results remain unchanged.</p></div>}
                {step === 3 && <div className="mt-3 space-y-3 text-sm"><p>Explain what you actually built or tried, why you chose that approach, the outcome you observed and what you would improve. Be clear that it was a practice project.</p><Button variant="secondary" onClick={onRehearse}>Open this job’s practice tools</Button><p>After doing and reviewing the work, record only your real experience:</p><div className="flex flex-wrap gap-x-4"><Link className={link} to={careerToolHref("/documents/stories", toolContext)}>Open your story bank</Link>{view.evidence_enabled && <Link className={link} to={careerToolHref("/documents/evidence", toolContext)}>Review your evidence vault</Link>}</div><p className="text-xs text-zinc-600 dark:text-zinc-400">These open existing tools; no draft, evidence or resume claim is created. Review anything you choose to save there.</p></div>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="secondary" disabled={step === 0} onClick={() => choose("practice_step", String(step - 1))}>Previous</Button>{step < 3 && <Button onClick={() => choose("practice_step", String(step + 1))}>Next: {steps[step + 1]}</Button>}</div>
              <details onToggle={(event) => setCoachOpen(event.currentTarget.open)}><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Ask AI to tailor this exercise</summary>{coachOpen && <Suspense fallback={<p role="status">Opening optional guidance…</p>}><Coach key={`${view.version}:${selected.key}:${kind}`} entryId={entryId} focus="fit" requirementKey={selected.key} experimentKind={kind} /></Suspense>}</details>
              <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={() => void copyBrief()}>Copy practice brief</Button>{copied && <p role="status" className="text-xs">Copied a plan, not a completed achievement. AI suggestions are not included.</p>}</div>
            </div>}
          </>}
        </>}
        <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh requirement source</Button>
      </div>
    </details>
  </section>;
}
