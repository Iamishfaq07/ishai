import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Field, Select, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

interface Check { id: string; label: string; present: boolean; path: string; text: string }
interface Fact { id: string; label: string; text: string; path: string }
interface Progress {
  version: string; resume_id: string | null; resumes: { id: string; title: string }[];
  checks: Check[]; facts: Fact[]; next_step: Fact & { action: string };
}
interface Plan { source: string; tips: { fact_id: string; source_quote: string; suggestion: string; success_check: string; path: string; label: string }[] }
const link = cx("inline-flex min-h-11 items-center rounded text-sm font-semibold text-indigo-700 underline underline-offset-4 dark:text-indigo-300", focusRing);

export function CareerCompanion({ mode, resumeId, onSelect }: { mode: "resume" | "plan"; resumeId?: string; onSelect: (id: string) => void }) {
  const [source, setSource] = useState<Progress | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"load" | "ai" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++seq.current; setBusy("load"); setSource(null); setPlan(null); setError(null);
    try {
      const next = await api.call<Progress>(`/v1/jobs/launchpad/progress${resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ""}`);
      if (id === seq.current) setSource(next);
    } catch (e) { if (id === seq.current) { setSource(null); setError(errorText(e)); } }
    finally { if (id === seq.current) setBusy(null); }
  }, [resumeId]);
  const cancel = useCallback(() => { seq.current++; }, []);
  useEffect(() => { void refresh(); return cancel; }, [refresh, cancel]);
  const generate = async () => {
    if (!source) return;
    const id = ++seq.current; setBusy("ai"); setError(null); setPlan(null);
    try {
      const next = await api.call<Plan>("/v1/jobs/launchpad/plan", { method: "POST", timeoutMs: 70_000,
        body: JSON.stringify({ version: source.version, resume_id: source.resume_id }) });
      if (id === seq.current) setPlan(next);
    } catch (e) { if (id === seq.current) setError(errorText(e)); }
    finally { if (id === seq.current) setBusy(null); }
  };
  return <section aria-labelledby="companion-title" className="min-w-0 space-y-4 break-words">
    <header className="rounded-2xl bg-indigo-950 p-5 text-white"><h2 id="companion-title" className="text-xl font-semibold">{mode === "resume" ? "Your resume, step by step" : "Your next-step companion"}</h2>
      <p className="mt-2 text-sm text-indigo-100">{mode === "resume" ? "Start, import or edit a resume. Use your real education and projects; work experience is optional when you are starting out." : "Review your saved resume and application signals, then ask AI for a small plan you can act on."}</p></header>
    {error && <ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote>}
    {!source ? <p role="status">{busy ? "Opening your saved career information…" : "Refresh to load your saved information."}</p> : <>
      <div className="space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
        <div className="flex flex-wrap gap-4"><Link className={link} to="/resume-ai?start=new&guide=1">Build a resume</Link><Link className={link} to="/resume-ai?start=import&guide=1">Import my resume</Link></div>
        {source.resumes.length > 0 ? <Field htmlFor="companion-resume" label="Resume to work on"><Select id="companion-resume" value={source.resume_id ?? ""} disabled={Boolean(busy)} onChange={(e) => onSelect(e.target.value)}>{source.resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select></Field> :
          <p className="text-sm">No saved resume yet. The builder offers blank and student / fresher layouts. You can still browse jobs without one.</p>}
        {source.resume_id && <div className="flex flex-wrap gap-4"><Link className={link} to={`/resume-ai/${source.resume_id}?guide=1`}>Edit step by step</Link><Link className={link} to={`/jobs?start=1&resume_id=${encodeURIComponent(source.resume_id)}`}>Use this resume for job search</Link></div>}
        {mode === "resume" && source.checks.length > 0 && <>
          <h3 className="font-semibold">Pick a section to add or edit</h3><p className="text-xs text-zinc-600 dark:text-zinc-400">Indicators show text in visible resume sections. They do not verify claims or score employability. Skip sections that do not apply.</p>
          <ul className="grid gap-2 sm:grid-cols-2">{source.checks.map((check) => <li key={check.id}><Link to={check.path} className={cx("flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-sm hover:border-indigo-400 dark:border-white/15", focusRing)}><span className="font-medium">{check.label}</span><span className="text-xs">{check.present ? "Review / edit" : "Add details"}</span></Link></li>)}</ul>
        </>}
      </div>
      <section aria-label="Suggested next action" className="rounded-2xl bg-indigo-500/10 p-4"><h3 className="font-semibold">{source.next_step.action}</h3><p className="mt-2 text-sm">{source.next_step.text}</p><Link className={link} to={source.next_step.path}>Open next step</Link></section>
      <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10" open={mode === "plan"}>
        <summary className={cx("min-h-11 cursor-pointer rounded py-2 font-semibold", focusRing)}>AI next-step plan</summary>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Optional AI suggestions from saved field indicators and recorded activity. Nothing is edited, submitted or enabled automatically.</p>
        <Button className="mt-3" loading={busy === "ai"} disabled={Boolean(busy)} onClick={() => void generate()}>Build my next-step plan</Button>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Up to 5 requests per UTC day, including failed requests. Review suggestions against your own situation.</p>
        {plan && <div aria-live="polite" className="mt-4 space-y-3"><p className="text-xs font-medium">{plan.source === "mock" ? "Demo AI plan" : "AI suggestions — review before acting"}</p>{plan.tips.map((tip) => <article key={tip.fact_id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/15">
          <h4 className="font-semibold">{tip.label}</h4><blockquote className="my-2 border-l-2 border-indigo-400 pl-3 text-sm">{tip.source_quote}</blockquote><p className="text-sm">{tip.suggestion}</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Check: {tip.success_check}</p><Link className={link} to={tip.path}>Open {tip.label.toLowerCase()}</Link>
        </article>)}</div>}
      </details>
      <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh saved progress</Button>
    </>}
  </section>;
}
