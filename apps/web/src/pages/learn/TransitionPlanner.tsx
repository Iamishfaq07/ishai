import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Input, Select } from "../../components/ui";
import { WorkspaceSync } from "../../components/WorkspaceSync";
import { useCareerWorkspace } from "../../lib/useCareerWorkspace";
import { downloadText } from "../../lib/prepPack";
import { EMPTY_TRANSITION, ROLE_STARTERS, transitionPlanText, validTransition, weeklyActions, type Requirement } from "./transition";

export function TransitionPlanner() {
  const sync = useCareerWorkspace("transition", EMPTY_TRANSITION, validTransition, "orbit.transition.legacy");
  const plan = sync.value;
  const [requirement, setRequirement] = useState("");
  const add = (text: string) => ({ id: crypto.randomUUID(), requirement: text, evidence: "", nextAction: "", due: "", state: "missing" as const });
  const change = (id: string, patch: Partial<Requirement>) => sync.change({ ...plan, requirements: plan.requirements.map((r) => r.id === id ? { ...r, ...patch } : r) });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const actions = weeklyActions(plan, today);
  return <section aria-labelledby="transition-planner" className="mt-8 space-y-4">
    <h2 id="transition-planner" className="font-display text-xl font-semibold">Plan a career transition</h2>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Connect what a target role asks for to your own evidence and a practical next step. Copy requirements from real job descriptions and label practice work accurately.</p>
    <WorkspaceSync {...sync} />
    <fieldset disabled={!sync.loaded || sync.saving || sync.conflict} className="min-w-0 space-y-4">
      <Card className="space-y-3">
        <label className="block text-sm">Current role or starting point<Input value={plan.currentRole} maxLength={160} onChange={(e) => sync.change({ ...plan, currentRole: e.target.value })} /></label>
        <label className="block text-sm">Target role<Input value={plan.targetRole} maxLength={160} onChange={(e) => sync.change({ ...plan, targetRole: e.target.value })} /></label>
        <label className="block text-sm">Why this transition matters<textarea className="mt-2 min-h-20 w-full rounded-lg border bg-transparent p-3" maxLength={1000} value={plan.motivation} onChange={(e) => sync.change({ ...plan, motivation: e.target.value })} /></label>
        <p className="text-xs text-zinc-500">Optional starting checklists. Review them against actual job requirements.</p>
        <div className="flex flex-wrap gap-2">{Object.entries(ROLE_STARTERS).map(([key, role]) => <Button key={key} variant="secondary" onClick={() => {
          if (plan.requirements.length && !window.confirm("Replace this plan’s requirements with the starting checklist? Download your plan first to keep it.")) return;
          sync.change({ ...plan, targetRole: role.title, requirements: role.requirements.map(add) });
        }}>{role.title} starter</Button>)}</div>
      </Card>
      <Card className="space-y-3"><h3 className="font-semibold">Requirement → evidence → next action</h3>
        <div className="flex gap-2"><Input aria-label="New target-role requirement" maxLength={300} value={requirement} onChange={(e) => setRequirement(e.target.value)} /><Button disabled={!requirement.trim() || plan.requirements.length >= 50} onClick={() => { sync.change({ ...plan, requirements: [...plan.requirements, add(requirement.trim())] }); setRequirement(""); }}>Add requirement</Button></div>
        {plan.requirements.map((r) => <article key={r.id} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-white/10"><h4 className="font-medium">{r.requirement}</h4>
          <label className="block text-sm">Your supporting evidence<textarea className="mt-1 min-h-20 w-full rounded-lg border bg-transparent p-2" maxLength={2000} value={r.evidence} onChange={(e) => change(r.id, { evidence: e.target.value, ...(e.target.value.trim() ? {} : { state: "missing" as const }) })} /></label>
          <label className="block text-sm">Your assessment<Select value={r.state} onChange={(e) => change(r.id, { state: e.target.value as Requirement["state"] })}><option value="missing">Evidence missing</option><option value="practising">Practising</option><option value="demonstrated" disabled={!r.evidence.trim()}>Evidence recorded · self-assessed</option></Select></label>
          <label className="block text-sm">Next concrete action<Input maxLength={500} value={r.nextAction} onChange={(e) => change(r.id, { nextAction: e.target.value })} /></label>
          <label className="block text-sm">Action due date<Input type="date" value={r.due} onChange={(e) => change(r.id, { due: e.target.value })} /></label>
          <Button variant="ghost" onClick={() => { if (window.confirm("Remove this requirement and its notes from your draft?")) sync.change({ ...plan, requirements: plan.requirements.filter((item) => item.id !== r.id) }); }}>Remove requirement</Button>
        </article>)}
      </Card>
    </fieldset>
    <Card className="space-y-3"><h3 className="font-semibold">Next actions to schedule</h3>
      {actions.length ? <ol className="list-decimal space-y-2 pl-5">{actions.map((r) => <li key={r.id} className="text-sm"><strong>{r.nextAction}</strong><p>{r.requirement} · {r.due || "Choose a due date"}{r.due && r.due < today ? " · overdue" : ""}</p></li>)}</ol> : <p className="text-sm">Add an action to an unfinished requirement to build your plan.</p>}
      <p className="text-sm"><Link to="/jobs/profile" className="underline">Review job-search targets</Link> · <Link to="/readiness" className="underline">Track skill readiness</Link></p>
      <Button variant="secondary" onClick={() => downloadText("orbit-career-transition.txt", transitionPlanText(plan), "text/plain")}>Download transition plan</Button>
      <p className="text-xs text-zinc-500">This plan does not change job-search preferences or certify readiness. Save changes to continue on another device.</p>
    </Card>
  </section>;
}
