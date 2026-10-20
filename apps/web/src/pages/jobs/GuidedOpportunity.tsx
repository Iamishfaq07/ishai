import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JobMission, JobTrackerEntry } from "@orbit/types";
import { ArrowRight, Button, ErrorNote, FileText, Search, Send, Sparkles, BookmarkCheck, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import type { MissionTool } from "./mission";
import { applicationPath } from "./paths";
import { packetGuidance } from "./autoapply/inbox";
import { OPPORTUNITY_STEPS, opportunityStep } from "./opportunity";

const Calendar = lazy(() => import("./CalendarIntake").then((m) => ({ default: m.CalendarIntake })));
const Message = lazy(() => import("./MessageUpdate").then((m) => ({ default: m.MessageUpdate })));
const icons = [FileText, Search, Send, Sparkles, BookmarkCheck];
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);
interface Fact { id: string; label: string; text: string; path: string }
interface Source { version: string; facts: Fact[] }
interface Plan { version: string; source: string; tips: { fact_id: string; source_quote: string; suggestion: string; success_check: string; path: string; label: string }[] }

export function GuidedOpportunity({ entry, mission, tab, onSelect, onSaved }: { entry: JobTrackerEntry; mission: JobMission; tab: MissionTool; onSelect: (tool: MissionTool) => void; onSaved: () => void }) {
  const index = opportunityStep(tab);
  const step = OPPORTUNITY_STEPS[index]!;
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(`${entry.id}:${tab}`);
  const [coach, setCoach] = useState(false);
  const [messages, setMessages] = useState(false);
  const [invitation, setInvitation] = useState(false);
  useEffect(() => {
    const next = `${entry.id}:${tab}`;
    if (previous.current === next) return;
    previous.current = next;
    const frame = requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); });
    return () => cancelAnimationFrame(frame);
  }, [entry.id, tab]);
  const signals = [mission.resume ? "Resume linked" : "Choose a resume", mission.fit ? "Prior check saved" : "Check evidence",
    `${mission.snapshots.length} resume copies saved`, entry.next_at ? "Date recorded" : "Add date when confirmed", `Recorded: ${entry.status}`];
  const revision = JSON.stringify([entry.id, tab, entry.status, entry.next_at, mission.resume?.updated_at, mission.resume?.id,
    mission.fit?.checked_at, mission.snapshots.map((snapshot) => snapshot.id), mission.offer]);
  return <section aria-label="Guided opportunity" className="min-w-0 space-y-4">
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 sm:p-5 dark:border-indigo-400/25 dark:bg-indigo-500/10">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">One opportunity · Step {index + 1} of 5</p>
      <h2 key={step.tool} ref={heading} tabIndex={-1} className="mt-2 scroll-mt-28 rounded motion-safe:animate-menu-in font-display text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{step.label}, one step at a time</h2>
      <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">{step.hint}</p>
      <nav aria-label="Opportunity steps" className="mt-4"><ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">{OPPORTUNITY_STEPS.map((item, n) => {
        const Icon = icons[n]!;
        return <li key={item.tool}><button type="button" aria-current={index === n ? "step" : undefined} onClick={() => onSelect(item.tool)}
          className={cx("flex min-h-16 w-full flex-col items-start gap-1 rounded-xl border p-3 text-left motion-safe:transition-colors", index === n ? "border-indigo-500 bg-white dark:bg-zinc-900" : "border-transparent hover:border-indigo-300", focusRing)}>
          <span className="flex items-center gap-2 text-sm font-semibold"><Icon aria-hidden className="h-4 w-4" />{n + 1}. {item.label}</span><span className="text-xs text-zinc-600 dark:text-zinc-400">{signals[n]}</span></button></li>;
      })}</ol></nav>
      <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">Choose any step. Indicators describe saved records, not readiness or required completion.</p>
    </div>
    {tab !== "plan" && <details onToggle={(event) => setCoach(event.currentTarget.open)} className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
      <summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>Get help with this step</summary>
      {coach && <OpportunityCoach key={revision} entryId={entry.id} focus={step.tool} />}
    </details>}
    {index >= 2 && <details onToggle={(event) => setMessages(event.currentTarget.open)} className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10"><summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>Record an employer reply</summary><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Turn a pasted message into a reviewed stage or interview-date update.</p>{messages && <Suspense fallback={<p role="status">Opening message review…</p>}><Message key={entry.id} entryId={entry.id} onSaved={onSaved} /></Suspense>}</details>}
    {index === 3 && <details className="rounded-xl border border-zinc-200 p-4 dark:border-white/10" onToggle={(e) => setInvitation(e.currentTarget.open)}><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Import interview invitation</summary>{invitation && <Suspense fallback={<p role="status">Opening invitation review…</p>}><Calendar key={entry.id} entryId={entry.id} onSaved={onSaved} /></Suspense>}</details>}
    {tab === "resume" && mission.resume && <Link className={link} to={`/resume-ai/${mission.resume.id}?guide=1&job=${entry.id}`}>Edit this resume and return to this job <ArrowRight aria-hidden className="ml-2 h-4 w-4" /></Link>}
    {tab === "timeline" && <section aria-label="Application kit for this job" className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <h3 className="font-semibold">{mission.application ? packetGuidance(mission.application).label : "Your application materials"}</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{mission.application ? packetGuidance(mission.application).detail : "No prepared application is linked to this job. You can apply on the employer site or prepare eligible materials through your application agent."}</p>
      {mission.application && <Link className={link} to={applicationPath(mission.application.id)}>Open this job’s application kit</Link>}
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Your tracker stage and the application’s delivery status are separate records. Prepared materials do not mean an application was sent.</p>
      <details className="mt-2"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-medium", focusRing)}>Other application tools</summary><div className="flex flex-wrap gap-x-4"><Link className={link} to="/jobs/applications">All prepared applications</Link><Link className={link} to="/jobs/journey">Application agent and permissions</Link></div></details>
    </section>}
    {tab === "offer" && <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-white/10"><p>Your recorded stage: <strong>{entry.status}</strong>. Keep offer details only if useful; you can also record a different outcome.</p><Link className={link} to="/jobs/tracker">Update outcome in tracker</Link></div>}
  </section>;
}

export function OpportunityNext({ tab, onSelect }: { tab: MissionTool; onSelect: (tool: MissionTool) => void }) {
  const index = opportunityStep(tab);
  return <nav aria-label="Continue opportunity" className="mt-5 flex flex-wrap justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-white/10">
    <Button variant="secondary" disabled={index === 0} onClick={() => onSelect(OPPORTUNITY_STEPS[index - 1]!.tool)}>Previous step</Button>
    {index < 4 ? <Button onClick={() => onSelect(OPPORTUNITY_STEPS[index + 1]!.tool)}>Next: {OPPORTUNITY_STEPS[index + 1]!.label}<ArrowRight className="h-4 w-4" aria-hidden /></Button> : <Link className={link} to="/jobs">Back to career launchpad</Link>}
  </nav>;
}

export function OpportunityCoach({ entryId, focus }: { entryId: string; focus: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);
  const busyRef = useRef(true);
  const base = `/v1/jobs/tracker/${encodeURIComponent(entryId)}/coach`;
  const tzOffset = -new Date().getTimezoneOffset();
  const refresh = useCallback(async (quiet = false) => {
    const request = ++seq.current; busyRef.current = true; setBusy(true);
    if (!quiet) { setSource(null); setPlan(null); } setError(null);
    try { const next = await api.call<Source>(`${base}?tz_offset=${tzOffset}`); if (request === seq.current) { setSource(next); setPlan((old) => old?.version === next.version ? old : null); } }
    catch (e) { if (request === seq.current) { setSource(null); setPlan(null); setError(errorText(e)); } }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(false); } }
  }, [base, tzOffset]);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => { void refresh(); return cancel; }, [refresh, cancel]);
  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === "visible" && !busyRef.current) void refresh(true); };
    window.addEventListener("focus", onReturn); document.addEventListener("visibilitychange", onReturn);
    const timer = window.setInterval(onReturn, 60_000);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); window.clearInterval(timer); };
  }, [refresh]);
  const generate = async () => {
    if (!source || busyRef.current) return;
    const request = ++seq.current; busyRef.current = true; setBusy(true); setPlan(null); setError(null);
    try {
      const next = await api.call<Plan>(`${base}/plan`, { method: "POST", timeoutMs: 70_000, body: JSON.stringify({ version: source.version, focus, tz_offset: tzOffset }) });
      if (request === seq.current) setPlan(next);
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(false); } }
  };
  return <div className="mt-3 space-y-3 text-sm">
    <p className="text-zinc-600 dark:text-zinc-400">Optional AI guidance from this job’s recorded resume links, prior fit-check requirements, application stages and dates. Nothing is edited, enabled or submitted. Review every suggestion.</p>
    {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
    <Button disabled={busy || !source} loading={busy && Boolean(source)} onClick={() => void generate()}>Help me with this step</Button>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">5 requests per UTC day, including failures. Opening this panel does not call AI.</p>
    {busy && !source && <p role="status">Reading this opportunity’s saved records…</p>}
    {plan && <div aria-live="polite" className="space-y-3"><p className="text-xs font-semibold">{plan.source === "mock" ? "Demo opportunity guidance" : "AI suggestions — review before acting"}</p>{plan.tips.map((tip) => <article key={tip.fact_id} className="rounded-xl bg-zinc-500/5 p-4 motion-safe:animate-menu-in">
      <h3 className="font-semibold">{tip.label}</h3><blockquote className="my-2 border-l-2 border-indigo-400 pl-3 text-xs">{tip.source_quote}</blockquote><p>{tip.suggestion}</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Check: {tip.success_check}</p><Link className={link} to={tip.path}>Open {tip.label.toLowerCase()}</Link>
    </article>)}</div>}
  </div>;
}
