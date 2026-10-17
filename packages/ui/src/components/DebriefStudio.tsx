import { useEffect, useState } from "react";
import type { Debrief, DebriefAttempt } from "@orbit/types";
import { aggregateDepth, ConceptDepthRadar } from "./ConceptDepthRadar";
import { Button, ErrorNote, Textarea } from "./ui";
import { cx, focusRing } from "./cx";

interface Client {
  debrief(id: string): Promise<Debrief>;
  retryDebrief(id: string, questionId: string, answer: string): Promise<DebriefAttempt>;
}
const stamp = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function DebriefStudio({ api, sessionId, refreshOn }: { api: Client; sessionId: string; refreshOn?: unknown }) {
  const [data, setData] = useState<Debrief | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.debrief(sessionId).then((loaded) => {
      if (cancelled) return;
      setData(loaded);
      setSelected((previous) => loaded.items.some((item) => item.question_id === previous) ? previous : loaded.items[0]?.question_id ?? null);
    }).catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the debrief."); });
    return () => { cancelled = true; };
  }, [api, sessionId, refreshOn]);
  useEffect(() => { setAnswer(""); }, [selected]);
  const item = data?.items.find((q) => q.question_id === selected);
  const retry = async () => {
    if (!item) return;
    const qid = item.question_id;
    setBusy(true); setError(null);
    try {
      const attempt = await api.retryDebrief(sessionId, qid, answer);
      setData((old) => old ? { ...old, items: old.items.map((q) => q.question_id === qid ? { ...q, attempts: [...q.attempts, attempt] } : q) } : old);
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't score that retry."); }
    finally { setBusy(false); }
  };
  if (!data?.items.length && !error) return null;
  const latest = item?.attempts.at(-1);
  return <section aria-labelledby="debrief-studio-title" className="space-y-4">
    <div><h2 id="debrief-studio-title" className="font-display text-xl font-semibold">Debrief Studio</h2>
      <p className="mt-1 text-xs text-zinc-500">{data?.score_basis}</p></div>
    {data && <ConceptDepthRadar scores={aggregateDepth(data.items)} />}
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <ol className="space-y-2" aria-label="Question timeline">{data?.items.map((q) => <li key={q.question_id}>
        <button type="button" onClick={() => setSelected(q.question_id)} aria-pressed={selected === q.question_id}
          className={cx("w-full rounded-xl border p-3 text-left text-sm", selected === q.question_id ? "border-cyan-500/40 bg-cyan-500/5" : "border-zinc-500/15", focusRing)}>
          <span className="telemetry block text-xs text-zinc-500">{stamp(q.time_ms)} · Q{q.index} · {q.attempts.at(-1)?.score ?? q.score ?? "—"}/5</span>
          <span className="mt-1 line-clamp-2 block">{q.question}</span>
        </button>
      </li>)}</ol>
      {item && <div className="glass-panel space-y-5 rounded-2xl p-5">
        <h3 className="font-semibold">{item.question}</h3>
        <div><h4 className="telemetry text-xs text-zinc-500">Your transcript / submitted answer</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.transcript || "No candidate answer was recorded for this question."}</p></div>
        {item.ideal_answer && <div><h4 className="telemetry text-xs text-cyan-700 dark:text-cyan-300">Orbit ideal answer</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.ideal_answer}</p>
          {item.ideal_code && <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-zinc-500/5 p-3 text-xs"><code>{item.ideal_code}</code></pre>}
        </div>}
        {item.feedback && <p className="text-sm text-zinc-500">{item.feedback}</p>}
        {item.missing_points.length > 0 && <div><h4 className="text-sm font-medium">Missing key points</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{item.missing_points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
        <div className="telemetry flex flex-wrap gap-3 text-xs"><span>Delivery: {item.delivery_score ?? "—"}/5</span><span>Clarity: {item.clarity_score ?? "—"}/5</span></div>
        <form onSubmit={(e) => { e.preventDefault(); void retry(); }} className="space-y-3 border-t border-zinc-500/15 pt-4">
          <label htmlFor={`retry-${item.question_id}`} className="block text-sm font-medium">Retry this question</label>
          <Textarea id={`retry-${item.question_id}`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} maxLength={20_000}
            placeholder="Answer in your own words, or paste your revised code." />
          <Button type="submit" disabled={busy || answer.trim().length < 10}>{busy ? "Assessing…" : "Score my retry"}</Button>
        </form>
        {latest && <div role="status" className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="telemetry text-sm">Latest retry: {latest.score}/5{item.score !== null ? ` · ${latest.score - item.score > 0 ? "+" : ""}${latest.score - item.score} from the original` : ""}</p>
          <p className="text-sm">{latest.feedback}</p>
          {latest.missing_points.length > 0 && <ul className="list-disc pl-5 text-sm">{latest.missing_points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        </div>}
      </div>}
    </div>
    {error && <ErrorNote>{error}</ErrorNote>}
  </section>;
}
