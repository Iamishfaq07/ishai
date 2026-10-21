import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Field, Select, Skeleton, buttonClass, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

interface Check { id: string; label: string; present: boolean; path: string; text: string }
interface Fact { id: string; label: string; text: string; path: string }
interface Progress {
  version: string; resume_id: string | null; resumes: { id: string; title: string }[];
  checks: Check[]; facts: Fact[]; next_step: Fact & { action: string };
  activity: { count: number; truncated: boolean; next_at: string | null;
    items?: { id: string; title: string; path: string; due_at: string | null; action_label: string; priority_reason: string }[] };
}
interface Plan { version: string; source: string; tips: { fact_id: string; source_quote: string; suggestion: string; success_check: string; path: string; label: string }[] }
const link = cx("workspace-text-link", focusRing);

export function CareerCompanion({ mode, resumeId, onSelect }: { mode: "resume" | "plan" | "home"; resumeId?: string; onSelect: (id: string) => void }) {
  const [source, setSource] = useState<Progress | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"load" | "ai" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const refresh = useCallback(async (quiet = false) => {
    const id = ++seq.current; busyRef.current = "load"; setBusy("load");
    if (!quiet) { setSource(null); setPlan(null); }
    setError(null);
    try {
      const next = await api.call<Progress>(`/v1/jobs/launchpad/progress${resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ""}`);
      if (id === seq.current) { setSource(next); setPlan((old) => old?.version === next.version ? old : null); }
    } catch (e) { if (id === seq.current) { setSource(null); setError(errorText(e)); } }
    finally { if (id === seq.current) { busyRef.current = null; setBusy(null); } }
  }, [resumeId]);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => { void refresh(); return cancel; }, [refresh, cancel]);
  useEffect(() => {
    if (mode !== "home") return;
    const onReturn = () => { if (document.visibilityState === "visible" && !busyRef.current) void refresh(true); };
    const timer = window.setInterval(onReturn, 60_000);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [mode, refresh]);
  const generate = async () => {
    if (!source || busyRef.current) return;
    const id = ++seq.current; busyRef.current = "ai"; setBusy("ai"); setError(null); setPlan(null);
    try {
      const next = await api.call<Plan>("/v1/jobs/launchpad/plan", { method: "POST", timeoutMs: 70_000,
        body: JSON.stringify({ version: source.version, resume_id: resumeId ?? null }) });
      if (id === seq.current) setPlan(next);
    } catch (e) { if (id === seq.current) setError(errorText(e)); }
    finally { if (id === seq.current) { busyRef.current = null; setBusy(null); } }
  };
  const ActionHeading = mode === "home" ? "h2" : "h3";
  return <section aria-label={mode === "home" ? "Career guidance" : undefined} aria-labelledby={mode !== "home" ? "companion-title" : undefined} className="min-w-0 space-y-4 break-words">
    {mode !== "home" && <header className="workspace-panel p-5"><h2 id="companion-title" className="text-xl font-semibold">{mode === "resume" ? "Your resume, step by step" : "Your next-step companion"}</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{mode === "resume" ? "Start, import or edit a resume. Use your real education and projects; work experience is optional when you are starting out." : "Your resume, opportunities and application updates, connected in one place. Saved activity determines the next step."}</p></header>}
    {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
    {!source ? (busy ? <div className="workspace-panel p-6"><Skeleton variant="line" count={3} label="Opening your saved career information" /></div> : !error && <p>Refresh to load your saved information.</p>) : <>
      {mode !== "home" && <div className="space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
        <div className="flex flex-wrap gap-4"><Link className={link} to="/resume-ai?start=new&guide=1">Build a resume</Link><Link className={link} to="/resume-ai?start=import&guide=1">Import my resume</Link></div>
        {source.resumes.length > 0 ? <Field htmlFor="companion-resume" label="Resume to work on"><Select id="companion-resume" value={source.resume_id ?? ""} disabled={Boolean(busy)} onChange={(e) => onSelect(e.target.value)}>{source.resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select></Field> :
          <p className="text-sm">No saved resume yet. The builder offers blank and student / fresher layouts. You can still browse jobs without one.</p>}
        {source.resume_id && <div className="flex flex-wrap gap-4"><Link className={link} to={`/resume-ai/${source.resume_id}?guide=1`}>Edit step by step</Link><Link className={link} to={`/jobs?start=1&resume_id=${encodeURIComponent(source.resume_id)}`}>Use this resume for job search</Link></div>}
        {mode === "resume" && source.checks.length > 0 && <>
          <h3 className="font-semibold">Pick a section to add or edit</h3><p className="text-xs text-zinc-600 dark:text-zinc-400">Indicators show text in visible resume sections. They do not verify claims or score employability. Skip sections that do not apply.</p>
          <ul className="grid gap-2 sm:grid-cols-2">{source.checks.map((check) => <li key={check.id}><Link to={check.path} className={cx("flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-sm hover:border-indigo-400 dark:border-white/15", focusRing)}><span className="font-medium">{check.label}</span><span className="text-xs">{check.present ? "Review / edit" : "Add details"}</span></Link></li>)}</ul>
        </>}
      </div>}
      <section aria-label="Suggested next action" className={mode === "home" ? "workspace-panel workspace-next" : "workspace-panel p-4"}>
        {mode === "home" && <p className="workspace-eyebrow">Recommended next action</p>}
        <ActionHeading className={mode === "home" ? "mt-3 max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl" : "font-semibold"}>{source.next_step.action}</ActionHeading><p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{source.next_step.text}</p><Link className={mode === "home" ? buttonClass("primary", "md", "mt-5 min-h-11") : link} to={source.next_step.path}>Continue</Link>
        {mode === "home" && <><p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">Chosen from your saved records. No AI request is made to choose this action.</p>
          {source.activity.next_at && <p className="mt-1 text-xs">Saved date: {new Date(source.activity.next_at).toLocaleString()}</p>}
          {!source.resumes.length && <div className="mt-2 flex flex-wrap gap-x-4"><Link className={link} to="/jobs/matches">Explore jobs first</Link><Link className={link} to="/jobs/profile">Choose a career goal</Link></div>}</>}
      </section>
      {mode === "home" && (source.activity.items?.length ?? 0) > 1 && <section aria-label="Your priority queue" className="workspace-panel p-5 sm:p-6"><h3 className="text-sm font-semibold">Also needs your attention</h3><ul className="mt-3 divide-y divide-zinc-200 dark:divide-white/10">{source.activity.items?.slice(1).map((item) => <li key={item.id} className="py-3"><Link className={link} to={item.path}>{item.title} · {item.action_label}</Link><p className="text-xs text-zinc-600 dark:text-zinc-400">{item.priority_reason}{item.due_at ? ` · ${new Date(item.due_at).toLocaleString()}` : ""}</p></li>)}</ul>{source.activity.count === 1 && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Your next action above is the only item needing attention in this seven-day queue.</p>}</section>}
      {mode !== "home" && <><details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10" open={mode === "plan" || undefined}>
        <summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>AI next-step plan</summary>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Optional AI suggestions from saved field indicators and recorded activity. Nothing is edited, submitted or enabled automatically. Saved dates and your reminder rules determine the suggested action; AI helps explain a plan.</p>
        <Button className="mt-3" loading={busy === "ai"} disabled={Boolean(busy)} onClick={() => void generate()}>Build my next-step plan</Button>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Up to 5 requests per UTC day, including failed requests. Review suggestions against your own situation.</p>
        {plan && <div aria-live="polite" className="mt-4 space-y-3"><p className="text-xs font-medium">{plan.source === "mock" ? "Demo AI plan" : "AI suggestions — review before acting"}</p>{plan.tips.map((tip) => <article key={tip.fact_id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/15">
          <h4 className="font-semibold">{tip.label}</h4><blockquote className="my-2 border-l-2 border-indigo-400 pl-3 text-sm">{tip.source_quote}</blockquote><p className="text-sm">{tip.suggestion}</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Check: {tip.success_check}</p><Link className={link} to={tip.path}>Open {tip.label.toLowerCase()}</Link>
        </article>)}</div>}
      </details>
      <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh saved progress</Button></>}
    </>}
  </section>;
}
