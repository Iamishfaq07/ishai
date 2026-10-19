import { useRef, useState } from "react";
import type { BizHiringPlan } from "@orbit/types";
import { Button, Callout, Sparkles } from "@orbit/ui";
import { api } from "../lib/api";
import { errorText, Panel } from "./ui";

interface Draft {
  plan: BizHiringPlan; sources: { criterion_id: string; requirement_quote: string }[];
  base_revision: number; source_version: string; source: "ai" | "mock";
}

export function PlanAssist({ cid, jid, revision, plan, disabled, onApply }: {
  cid: string; jid: string; revision: number; plan: BizHiringPlan; disabled: boolean;
  onApply: (plan: BizHiringPlan, sourceVersion: string) => void;
}) {
  const [draft, setDraft] = useState<{ result: Draft; snapshot: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshot = JSON.stringify([cid, jid, revision, plan]);
  const current = useRef(snapshot);
  current.current = snapshot;
  const generate = async () => {
    setBusy(true); setError(null); setDraft(null);
    const captured = snapshot;
    try {
      const result = await api.call<Draft>(`/v1/business/companies/${encodeURIComponent(cid)}/jobs/${encodeURIComponent(jid)}/hiring-plan/assist`,
        { method: "POST", body: JSON.stringify({ base_revision: revision }) });
      if (captured !== current.current) setError("Your editor changed while AI was drafting. Generate a fresh preview to keep those edits safe.");
      else setDraft({ result, snapshot: captured });
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const visible = draft?.snapshot === snapshot ? draft.result : null;
  return <Panel title="From job requirements to an interview" hint="AI drafts job-related questions, follow-up probes and evidence anchors from the saved job. Preview first, edit, then save your plan. 10 previews per company each day (UTC).">
    <div className="space-y-4">
      <Button type="button" variant="secondary" disabled={disabled} loading={busy} onClick={() => void generate()}><Sparkles className="h-4 w-4" /> Draft interview plan with AI</Button>
      <div aria-live="polite">{busy && <p className="text-sm">Mapping saved requirements to interview questions and evidence…</p>}</div>
      {error && <Callout tone="error">{error}</Callout>}
      {draft && !visible && <Callout>Your plan changed after this preview. Generate again before applying a draft.</Callout>}
      {visible && <div className="space-y-4">
        <h3 className="text-sm font-semibold">{visible.source === "mock" ? "Demo AI preview" : "AI preview"} · {visible.plan.criteria.reduce((sum, c) => sum + c.minutes, 0)} minutes of discussion</h3>
        <ul className="space-y-3">{visible.plan.criteria.map((criterion) => <li key={criterion.id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <p className="text-sm font-medium">{criterion.name} · {criterion.minutes} minutes</p>
          <p className="mt-2 text-sm">{criterion.question}</p>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Probe: {criterion.probe || "Use the core question."}</p>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Strong evidence: {criterion.strong}</p>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Needs more evidence: {criterion.weak}</p>
          <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-300">Job requirement: “{visible.sources.find((s) => s.criterion_id === criterion.id)?.requirement_quote}”</p>
        </li>)}</ul>
        {visible.plan.work_sample && <p className="text-sm">Includes a practical challenge: {visible.plan.work_sample.title}. Review the full scenario in the editor after applying.</p>}
        <Button type="button" disabled={disabled || busy} onClick={() => {
          if (current.current !== draft?.snapshot) return;
          onApply(structuredClone(visible.plan), visible.source_version); setDraft(null);
        }}>Use this draft in the editor</Button>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">This replaces the local editor draft. It is saved only when you choose Save interview plan.</p>
      </div>}
    </div>
  </Panel>;
}
