import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Callout, Sparkles, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";

export interface WorkflowFact { id: string; label: string; text: string; path: string }
interface Advice { version: string; source: "ai" | "mock"; tips: { fact_id: string; source_quote: string; suggestion: string; success_check: string }[] }

export function WorkspaceHero({ title, description, labels }: {
  title: string; description: string; labels: [string, string, string];
}) {
  const gradient = `flow-${title.replace(/\W/g, "")}`;
  return <section className="grid items-center gap-5 rounded-2xl bg-zinc-950 p-6 text-white md:grid-cols-2">
    <div><h2 className="font-display text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 text-sm text-zinc-300">{description}</p></div>
    <svg viewBox="0 0 360 160" className="w-full" role="img" aria-label={labels.join(" connects to ")}>
      <defs><linearGradient id={gradient}><stop stopColor="#818cf8" /><stop offset="1" stopColor="#c4b5fd" /></linearGradient></defs>
      <circle cx="180" cy="80" r="70" fill="none" stroke="#818cf8" opacity=".16" />
      <circle cx="180" cy="80" r="45" fill="none" stroke="#818cf8" opacity=".24" />
      <path d="M80 42Q180 5 280 42M80 118Q180 155 280 118M80 80H280" stroke={`url(#${gradient})`} fill="none" opacity=".4" />
      {[44, 80, 116].map((y, i) => <g key={y}>
        <rect x="15" y={y - 13} width="115" height="26" rx="8" fill="#27272a" stroke="#6366f1" />
        <text x="72" y={y + 4} textAnchor="middle" fill="#e4e4e7" fontSize="11">{labels[i]}</text>
        <circle cx="180" cy={y} r="4" fill="#a5b4fc" className="motion-safe:animate-pulse" />
      </g>)}
      <rect x="230" y="52" width="110" height="56" rx="14" fill="#4f46e5" />
      <path d="m269 78 9 9 16-18" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  </section>;
}

export function WorkflowAdvice({ endpoint, version, facts, allowance, onRefresh, disabled = false }: {
  endpoint: string; version: string; facts: WorkflowFact[]; allowance: string; onRefresh: () => Promise<string>;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(version);
  current.current = version;
  const generate = async () => {
    setBusy(true); setError(null); setResult(null);
    const captured = version;
    try {
      const next = await api.call<Advice>(endpoint, { method: "POST", body: JSON.stringify({ version: captured }) });
      const latest = await onRefresh();
      if (latest !== next.version || current.current !== captured) setError("Your records changed. Request fresh advice from the updated workspace.");
      else setResult(next);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <section aria-label="AI workspace advice" className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Turn signals into a useful experiment</h3>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{allowance} · suggestions for your review, with a way to check the result.</p></div>
      <Button disabled={disabled} loading={busy} onClick={() => void generate()}><Sparkles className="h-4 w-4" /> Ask AI for next steps</Button></div>
    <div aria-live="polite">{busy && <p className="text-sm">Reading your saved signals and preparing practical suggestions…</p>}</div>
    {error && <Callout tone="error">{error}</Callout>}
    {result?.version === version && <div className="space-y-3"><h4 className="text-sm font-medium">{result.source === "mock" ? "Demo AI advice" : "AI advice"}</h4>
      <ul className="grid gap-3 md:grid-cols-2">{result.tips.map((tip) => {
        const fact = facts.find((f) => f.id === tip.fact_id);
        return fact && <li key={tip.fact_id} className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-white/10 dark:bg-white/5">
          <Link to={fact.path} className={cx("rounded text-sm font-semibold hover:underline", focusRing)}>{fact.label}</Link>
          <p className="mt-2 text-sm">{tip.suggestion}</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Check: {tip.success_check}</p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Source: “{tip.source_quote}”</p>
        </li>;
      })}</ul></div>}
  </section>;
}
