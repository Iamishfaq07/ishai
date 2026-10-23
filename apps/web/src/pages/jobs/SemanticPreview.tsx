import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNote, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { jobPath } from "./paths";
interface Result { model: string; scope: string; candidate_count: number; results: { id: string; title: string; company: string; baseline_rank: number }[] }
export function SemanticPreview() {
  const availability = useAsync(() => api.call<{ available: boolean }>("/v1/jobs/semantic-preview"), [], "semantic-availability");
  const [goal, setGoal] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!availability.data?.available) return null;
  const compare = async () => {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.call<Result>("/v1/jobs/semantic-preview", { method: "POST", body: JSON.stringify({ goal }) })); }
    catch { setError("Comparison unavailable. Your regular matches are still available."); }
    finally { setBusy(false); }
  };
  return <details className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-sm font-medium">Compare semantic recommendations · experiment</summary>
    <p className="my-2 text-xs text-zinc-500">Describe responsibilities you want. Compares ordering within your saved profile’s eligible matches; it does not use this page’s temporary search filters.</p>
    <Input aria-label="Responsibilities you want" value={goal} maxLength={1000} onChange={(e) => setGoal(e.target.value)} placeholder="Investigate incidents and improve service reliability" />
    <Button className="mt-2" variant="secondary" disabled={goal.trim().length < 10 || busy} onClick={() => void compare()}>Compare ordering</Button>
    {error && <ErrorNote>{error}</ErrorNote>}
    {result && <><p className="my-2 text-xs">{result.scope} Model: {result.model}. Compared {result.candidate_count} jobs.</p><ol className="space-y-2">{result.results.map((r, i) => <li key={r.id} className="text-sm"><Link className="underline" to={jobPath(r.id)}>{i + 1}. {r.title} · {r.company}</Link><span className="text-xs"> · regular rank {r.baseline_rank}</span></li>)}</ol></>}
  </details>;
}
