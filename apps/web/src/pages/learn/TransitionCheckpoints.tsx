import { useState } from "react";
import { Button, Card, ErrorNote, Input } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText } from "../../lib/prepPack";
import { useAsync } from "../../lib/useAsync";
import type { Transition } from "./transition";
interface Checkpoint { id: string; revision: number; note: string; created_at: string; plan: Transition }
export function TransitionCheckpoints({ plan, revision, enabled }: { plan: Transition; revision: number; enabled: boolean }) {
  const history = useAsync(() => api.call<Checkpoint[]>("/v1/career/transition/checkpoints"), [revision], `transition-checkpoints:${revision}`);
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const act = async (id?: string) => {
    setBusy(true); setError("");
    try {
      await api.call(`/v1/career/transition/checkpoints${id ? `/${id}` : ""}`, { method: id ? "DELETE" : "POST", ...(id ? {} : { body: JSON.stringify({ revision, note }) }) });
      setNote(""); history.reload();
    } catch { setError("Could not update checkpoints. Refresh the history and check that your plan is saved."); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-3"><h3 className="font-semibold">Progress checkpoints</h3>
    <p className="text-sm">Keep a saved version with a short reflection, then compare it with your current plan. Up to 10 checkpoints. Comparisons show recorded changes, not verified skill improvement.</p>
    <Input aria-label="Checkpoint reflection" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What changed or what did you learn?" />
    <Button disabled={!enabled || busy || note.trim().length < 3} onClick={() => void act()}>Capture saved plan checkpoint</Button>
    {!enabled && <p className="text-xs text-zinc-500">Save your plan and resolve conflicts before capturing a checkpoint.</p>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {history.error && <ErrorNote onRetry={history.reload}>Could not load checkpoint history.</ErrorNote>}
    <ul className="space-y-3">{history.data?.map((item) => {
      const before = new Map(item.plan.requirements.map((r) => [r.id, r]));
      const current = new Map(plan.requirements.map((r) => [r.id, r]));
      const changes = plan.requirements.filter((r) => !before.has(r.id) || (["requirement", "evidence", "nextAction", "due", "state"] as const).some((key) => before.get(r.id)?.[key] !== r[key]));
      const removed = item.plan.requirements.filter((r) => !current.has(r.id));
      return <li key={item.id}><details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Revision {item.revision} · {item.note}</summary><p className="mt-2">Captured {new Date(item.created_at).toLocaleString()}</p>
        <p>Starting point: {item.plan.currentRole} → {plan.currentRole}</p><p>Target: {item.plan.targetRole} → {plan.targetRole}</p><p className="whitespace-pre-wrap">Motivation: {item.plan.motivation} → {plan.motivation}</p><p>{changes.length} added or changed requirements · {removed.length} removed. Compared with the plan currently shown, including unsaved edits.</p>
        {changes.map((r) => <details key={r.id} className="my-2"><summary className="cursor-pointer">{r.requirement}</summary><p className="font-medium">Checkpoint</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(before.get(r.id) ?? "Not present", null, 2)}</pre><p className="font-medium">Current plan</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(r, null, 2)}</pre></details>)}
        {removed.map((r) => <p key={r.id}>Removed: {r.requirement}</p>)}
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => downloadText("orbit-plan-checkpoint.json", JSON.stringify(item, null, 2), "application/json")}>Download checkpoint</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Delete this checkpoint? Download a copy first if you want to keep it.")) void act(item.id); }}>Delete checkpoint</Button></div>
      </details></li>;
    })}</ul>
    {history.data?.length === 0 && <p className="text-sm">No checkpoints captured yet.</p>}
  </Card>;
}
