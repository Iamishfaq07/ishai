import { useState } from "react";
import { Button, Card, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import type { Transition } from "./transition";
interface Review { summary: string; provider: string; reviewed_requirements: number; suggestions: { requirement_id: string; source_quote: string; gap: string; next_action: string }[] }
export function TransitionReview({ plan, revision, enabled, onAction }: { plan: Transition; revision: number; enabled: boolean; onAction: (id: string, action: string) => void }) {
  const [result, setResult] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const review = async () => {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.call<Review>("/v1/career/transition/review", { method: "POST", body: JSON.stringify({ revision }), timeoutMs: 70000 })); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-3"><h3 className="font-semibold">Review your transition plan with AI</h3>
    <p className="text-sm">Orbit's AI reads your saved goals and your first 10 requirements with their evidence, then suggests next steps. Up to 5 a day. Each suggestion quotes your own plan, so you can check it.</p>
    <Button disabled={!enabled || busy || !plan.targetRole.trim() || !plan.requirements.length} onClick={() => void review()}>{busy ? "Reviewing…" : "Review my plan with AI"}</Button>
    {!enabled && <p className="text-xs text-zinc-500">Save your changes first.</p>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {result && <><p className="text-xs">AI suggestions · {result.reviewed_requirements} requirements reviewed</p><p className="text-sm">{result.summary}</p>
      <ul className="space-y-4">{result.suggestions.map((s) => <li key={s.requirement_id} className="rounded-lg border p-3 text-sm"><h4 className="font-medium">{plan.requirements.find((r) => r.id === s.requirement_id)?.requirement}</h4><blockquote className="my-2 border-l-2 border-indigo-400 pl-3 whitespace-pre-wrap">{s.source_quote}</blockquote><p>{s.gap}</p><p className="mt-2">Suggested action: {s.next_action}</p><Button className="mt-2" variant="secondary" disabled={!enabled} onClick={() => { if (window.confirm("Replace this requirement’s next action with the suggestion? Review it and save the plan separately.")) onAction(s.requirement_id, s.next_action); }}>Use as my draft action</Button></li>)}</ul>
      <p className="text-xs text-zinc-500">Check each suggestion before you use it, then save your plan.</p></>}
  </Card>;
}
