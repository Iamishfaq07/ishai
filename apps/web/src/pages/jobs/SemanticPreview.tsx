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
    catch { setError("This isn't available right now. Your regular matches still work."); }
    finally { setBusy(false); }
  };
  return <details className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-sm font-medium">Rank your matches by what you want to do (preview)</summary>
    <p className="my-2 text-xs text-zinc-500">Describe the work you want to do, and Orbit reorders your matches by it. It uses your saved search, not the filters on this page.</p>
    <Input aria-label="Responsibilities you want" value={goal} maxLength={1000} onChange={(e) => setGoal(e.target.value)} placeholder="Investigate incidents and improve service reliability" />
    <Button className="mt-2" variant="secondary" disabled={goal.trim().length < 10 || busy} onClick={() => void compare()}>Reorder my matches</Button>
    {error && <ErrorNote>{error}</ErrorNote>}
    {result && <><p className="my-2 text-xs">Reordered {result.candidate_count} of your matches.</p><ol className="space-y-2">{result.results.map((r, i) => <li key={r.id} className="text-sm"><Link className="underline" to={jobPath(r.id)}>{i + 1}. {r.title} · {r.company}</Link><span className="text-xs"> · was #{r.baseline_rank}</span></li>)}</ol></>}
  </details>;
}
