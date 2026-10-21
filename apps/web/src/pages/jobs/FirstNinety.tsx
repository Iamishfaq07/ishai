import { useState } from "react";
import { Copy, Download, Sparkles, useCopy } from "@orbit/ui";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";

interface Plan { phases: { name: string; goals: string[] }[]; people: string[]; questions: string[]; early_win: string }

function asText(plan: Plan, role: string): string {
  return [`First 90 days · ${role}`, "",
    ...plan.phases.flatMap((p) => [p.name, ...p.goals.map((g) => `- ${g}`), ""]),
    "People to meet", ...plan.people.map((p) => `- ${p}`), "",
    "Questions for your manager", ...plan.questions.map((q) => `- ${q}`), "",
    "An early win", plan.early_win].join("\n");
}

/**
 * Your first 90 days (POST /v1/jobs/tracker/{id}/first-90): once an offer or a hire is recorded, a plan from the job
 * post and the resume. Nothing is saved; copy it or download it.
 */
export function FirstNinety({ entryId, role }: { entryId: string; role: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [copied, copy] = useCopy();
  const run = async () => {
    setBusy(true); setError(null);
    try { setPlan(await api.call<Plan>(`/v1/jobs/tracker/${encodeURIComponent(entryId)}/first-90`, { method: "POST" })); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Your first 90 days" className="workspace-panel space-y-4 p-4 sm:p-5">
    <div><h3 className="font-semibold">Your first 90 days</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">A plan for starting well: what to learn first, goals by day 30, 60 and 90 from this job’s responsibilities, who to meet and what to ask your manager.</p></div>
    <Button loading={busy} variant={plan ? "secondary" : "primary"} onClick={() => void run()}><Sparkles className="h-4 w-4" aria-hidden /> {plan ? "Make a new plan" : "Plan my first 90 days"}</Button>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
    {plan && <div className="space-y-4 text-sm">
      <ol className="grid gap-3 md:grid-cols-2">{plan.phases.map((p) => <li key={p.name} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"><h4 className="font-semibold">{p.name}</h4><ul className="mt-2 list-disc space-y-1 pl-5">{p.goals.map((g, i) => <li key={i}>{g}</li>)}</ul></li>)}</ol>
      {plan.people.length > 0 && <div><h4 className="font-semibold">People to meet early</h4><ul className="mt-1 list-disc space-y-1 pl-5">{plan.people.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      {plan.questions.length > 0 && <div><h4 className="font-semibold">Questions for your manager</h4><ul className="mt-1 list-disc space-y-1 pl-5">{plan.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
      {plan.early_win && <p><span className="font-semibold">An early win: </span>{plan.early_win}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy(asText(plan, role))}><Copy className="h-4 w-4" aria-hidden /> {copied === "copied" ? "Copied" : "Copy plan"}</Button>
        <Button variant="ghost" onClick={() => downloadText("first-90-days.txt", asText(plan, role), "text/plain;charset=utf-8")}><Download className="h-4 w-4" aria-hidden /> Download</Button>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Built from the job post and your resume. Check it against what your manager tells you in week one.</p>
    </div>}
  </section>;
}
