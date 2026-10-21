import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JobMission, JobTrackerEntry } from "@orbit/types";
import { Button, ErrorNote, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import type { MissionTool } from "./mission";
import { applicationPath } from "./paths";
import { packetGuidance } from "./autoapply/inbox";
import { OPPORTUNITY_STEPS, opportunityStep } from "./opportunity";

const Calendar = lazy(() => import("./CalendarIntake").then((m) => ({ default: m.CalendarIntake })));
const Message = lazy(() => import("./MessageUpdate").then((m) => ({ default: m.MessageUpdate })));
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);
interface Fact { id: string; label: string; text: string; path: string }
interface Source { version: string; facts: Fact[] }
interface Plan { version: string; source: string; tips: { fact_id: string; source_quote: string; suggestion: string; success_check: string; path: string; label: string }[] }

export function GuidedOpportunity({ entry, mission, tab, onSaved }: { entry: JobTrackerEntry; mission: JobMission; tab: MissionTool; onSaved: () => void }) {
  const index = opportunityStep(tab);
  const step = OPPORTUNITY_STEPS[index]!;
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(`${entry.id}:${tab}`);
  const [support, setSupport] = useState(false);
  const [supportKind, setSupportKind] = useState<"help" | "reply" | "invitation">("help");
  const [visitedSupport, setVisitedSupport] = useState<string[]>([]);
  const supportChoices: { id: "help" | "reply" | "invitation"; label: string }[] = [];
  if (tab !== "plan") supportChoices.push({ id: "help", label: "AI guidance" });
  supportChoices.push({ id: "reply", label: "Employer reply" });
  supportChoices.push({ id: "invitation", label: "Calendar invitation" });
  const activeSupport = supportChoices.find((choice) => choice.id === supportKind)?.id ?? supportChoices[0]?.id;
  useEffect(() => {
    const next = `${entry.id}:${tab}`;
    if (previous.current === next) return;
    previous.current = next;
    const frame = requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); });
    return () => cancelAnimationFrame(frame);
  }, [entry.id, tab]);
  const revision = JSON.stringify([entry.id, tab, entry.status, entry.next_at, mission.resume?.updated_at, mission.resume?.id,
    mission.fit?.checked_at, mission.snapshots.map((snapshot) => snapshot.id), mission.offer]);
  return <section aria-label="Opportunity context" className="min-w-0 space-y-4">
    <h2 ref={heading} tabIndex={-1} className="scroll-mt-28 rounded font-display text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{tab === "practice" ? "Practice for this role" : tab === "plan" ? "Your preparation" : step.label}</h2>
    <details onToggle={(event) => { const opened = event.currentTarget.open; setSupport(opened); if (opened && activeSupport) setVisitedSupport((old) => old.includes(activeSupport) ? old : [...old, activeSupport]); }} className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
      <summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-semibold", focusRing)}>Help and updates for this job<span className="mt-1 block text-xs font-normal text-zinc-600 dark:text-zinc-400">{supportChoices.map((choice) => choice.label).join(" · ")}</span></summary>
      <div hidden={!support} className="mt-3 space-y-3"><div role="group" aria-label="Choose help or update" className="flex flex-wrap gap-2">{supportChoices.map((choice) => <button key={choice.id} type="button" aria-pressed={activeSupport === choice.id} onClick={() => { setSupportKind(choice.id); setVisitedSupport((old) => old.includes(choice.id) ? old : [...old, choice.id]); }} className={cx("min-h-11 rounded-xl border px-3 py-2 text-sm motion-safe:transition-colors", activeSupport === choice.id ? "border-indigo-500 bg-indigo-500/5 font-semibold" : "border-zinc-200 dark:border-white/10", focusRing)}>{choice.label}</button>)}</div>
        {support && activeSupport === "help" && <OpportunityCoach key={revision} entryId={entry.id} focus={step.tool} />}
        <div hidden={activeSupport !== "reply"}>{visitedSupport.includes("reply") && <><p className="text-sm text-zinc-600 dark:text-zinc-400">Paste an employer reply, review the proposed stage or date, then confirm any change.</p><Suspense fallback={<p role="status">Opening reply review…</p>}><Message key={entry.id} entryId={entry.id} onSaved={onSaved} /></Suspense></>}</div>
        <div hidden={activeSupport !== "invitation"}>{visitedSupport.includes("invitation") && <><p className="text-sm text-zinc-600 dark:text-zinc-400">Review an interview calendar file before adding its date to this job.</p><Suspense fallback={<p role="status">Opening invitation review…</p>}><Calendar key={entry.id} entryId={entry.id} onSaved={onSaved} /></Suspense></>}</div>
      </div>
    </details>
    {(tab === "timeline" || tab === "resume") && <section aria-label="Application kit for this job" className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <h3 className="font-semibold">{mission.application ? packetGuidance(mission.application).label : "Your application materials"}</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{mission.application ? packetGuidance(mission.application).detail : "No prepared application is linked to this job. You can apply on the employer site or prepare eligible materials through your application agent."}</p>
      {mission.application && <Link className={link} to={applicationPath(mission.application.id)}>Open this job’s application kit</Link>}
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Your tracker stage and the application’s delivery status are separate records. Prepared materials do not mean an application was sent.</p>
      <details className="mt-2"><summary className={cx("min-h-11 cursor-pointer rounded py-2 text-sm font-medium", focusRing)}>Other application tools</summary><div className="flex flex-wrap gap-x-4"><Link className={link} to="/jobs/applications">All prepared applications</Link><Link className={link} to="/jobs/journey">Application agent and permissions</Link></div></details>
    </section>}
    {tab === "offer" && <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-white/10"><p>Your recorded stage: <strong>{entry.status}</strong>. Keep offer details only if useful; you can also record a different outcome.</p><Link className={link} to="/jobs/tracker">Update outcome in tracker</Link></div>}
  </section>;
}

export function OpportunityCoach({ entryId, focus, requirementKey, experimentKind = "project" }: { entryId: string; focus: string; requirementKey?: string; experimentKind?: "project" | "explanation" | "code" }) {
  const [source, setSource] = useState<Source | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);
  const busyRef = useRef(true);
  const base = `/v1/jobs/tracker/${encodeURIComponent(entryId)}/coach`;
  const tzOffset = -new Date().getTimezoneOffset();
  const practiceQuery = requirementKey ? `&requirement_key=${encodeURIComponent(requirementKey)}&experiment_kind=${experimentKind}` : "";
  const refresh = useCallback(async (quiet = false) => {
    const request = ++seq.current; busyRef.current = true; setBusy(true);
    if (!quiet) { setSource(null); setPlan(null); } setError(null);
    try { const next = await api.call<Source>(`${base}?tz_offset=${tzOffset}${practiceQuery}`); if (request === seq.current) { setSource(next); setPlan((old) => old?.version === next.version ? old : null); } }
    catch (e) { if (request === seq.current) { setSource(null); setPlan(null); setError(errorText(e)); } }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(false); } }
  }, [base, tzOffset, practiceQuery]);
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
      const next = await api.call<Plan>(`${base}/plan`, { method: "POST", timeoutMs: 70_000, body: JSON.stringify({ version: source.version, focus, tz_offset: tzOffset, ...(requirementKey ? { requirement_key: requirementKey, experiment_kind: experimentKind } : {}) }) });
      if (request === seq.current) setPlan(next);
    } catch (e) { if (request === seq.current) setError(errorText(e)); }
    finally { if (request === seq.current) { busyRef.current = false; setBusy(false); } }
  };
  return <div className="mt-3 space-y-3 text-sm">
    <p className="text-zinc-600 dark:text-zinc-400">Optional AI guidance from this job’s recorded resume links, prior fit-check requirements, cached source status, application stages and dates. Nothing is edited, enabled or submitted. Review every suggestion.</p>
    {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
    <Button disabled={busy || !source} loading={busy && Boolean(source)} onClick={() => void generate()}>{requirementKey ? "Suggest a small practice exercise" : "Help me with this step"}</Button>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">5 requests per UTC day, including failures. Opening this panel does not call AI.</p>
    {busy && !source && <p role="status">Reading this opportunity’s saved records…</p>}
    {plan && <div aria-live="polite" className="space-y-3"><p className="text-xs font-semibold">{plan.source === "mock" ? "Demo opportunity guidance" : "AI suggestions — review before acting"}</p>{plan.tips.map((tip) => <article key={tip.fact_id} className="rounded-xl bg-zinc-500/5 p-4 motion-safe:animate-menu-in">
      <h3 className="font-semibold">{tip.label}</h3><blockquote className="my-2 border-l-2 border-indigo-400 pl-3 text-xs">{tip.source_quote}</blockquote><p>{tip.suggestion}</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Check: {tip.success_check}</p><Link className={link} to={tip.path}>Open {tip.label.toLowerCase()}</Link>
    </article>)}</div>}
  </div>;
}
