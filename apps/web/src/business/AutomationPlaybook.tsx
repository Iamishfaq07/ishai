import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { BizAutomationJob, BizAutomationPreview, BizAutomationRecord } from "@orbit/types";
import { Button, Callout, Download, Field, Input, Layers, Select } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { useCompany } from "./BusinessApp";
import { automationApi } from "./automationApi";
import { AUTOMATION_PRESETS, AUTOMATION_RULES, playbookDraft, playbookIssues, playbookKey, playbookRecipe, presetDraft, type PlaybookDraft } from "./automationPlaybooks";
import { Panel, errorText } from "./ui";

export function AutomationPlaybook({ job, cid, onSaved }: { job: BizAutomationJob; cid: string; onSaved: () => void }) {
  const { company } = useCompany(); const id = useId();
  const [draft, setDraft] = useState(() => playbookDraft(job.recipe));
  const [source, setSource] = useState<BizAutomationRecord>(() => job);
  const [preview, setPreview] = useState<BizAutomationPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null); const [message, setMessage] = useState("");
  const live = useRef(true); const locked = useRef(false); const currentKey = useRef("");
  const key = playbookKey(draft); currentKey.current = key;
  const dirty = key !== playbookKey(playbookDraft(source.recipe));
  const changed = job.revision > source.revision;
  const savedRecord = job.revision >= source.revision ? job : source;
  const issues = playbookIssues(draft);
  const ownerUnavailable = Boolean(draft.owner && !job.owners.some(owner => owner.id === draft.owner));
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const edit = (next: PlaybookDraft) => { setDraft(next); setPreview(null); setMessage(""); setError(null); };
  const perform = async (action: "save" | "preview" | "run") => {
    const recipe = playbookRecipe(draft);
    if (locked.current || !recipe || changed || (action === "save" && ownerUnavailable) || (action === "run" && dirty)) return;
    locked.current = true; setBusy(true); setError(null); setMessage("");
    try {
      if (action === "preview") { const next = await automationApi.preview(cid, job.job_id, recipe); if (live.current && currentKey.current === key) setPreview(next); }
      else {
        const saved = action === "save" ? await automationApi.save(cid, job.job_id, recipe, source.revision) : await automationApi.run(cid, job.job_id);
        if (live.current) { setSource(saved); setDraft(playbookDraft(saved.recipe)); setPreview(null); setMessage(action === "save" ? "Automation settings saved and queue reconciled." : "Queue reconciled using saved settings."); onSaved(); }
      }
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const disabled = busy || company.status !== "active";
  return <Panel title="Role playbook" hint="Elapsed calendar time in UTC; weekends are included. Every recipe is optional.">
    <section aria-labelledby={`${id}-templates`} className="mb-6"><div className="flex items-center gap-2"><Layers className="h-5 w-5 text-indigo-700 dark:text-indigo-300" aria-hidden="true" /><h3 id={`${id}-templates`} className="font-semibold">Start from a workflow template</h3></div><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Templates replace the rule choices in this draft, preserve its task owner and start disabled. Review and save explicitly.</p><ul className="mt-4 grid gap-3 xl:grid-cols-3">{AUTOMATION_PRESETS.map(preset => <li key={preset.id} className="flex flex-col rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-400/20 dark:bg-indigo-400/5"><h4 className="font-semibold">{preset.title}</h4><p className="mb-4 mt-2 flex-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{preset.detail}</p><Button size="sm" variant="secondary" disabled={disabled} onClick={() => { if (!dirty || window.confirm("Replace the unsaved rule choices with this disabled template draft? The selected task owner stays.")) edit(presetDraft(preset, draft)); }}>Use {preset.title} draft</Button></li>)}</ul></section>
    {dirty && <Callout className="mb-4" title="Unsaved playbook draft">Background checks still use the saved settings. Preview and save this draft to change them; save or discard it before a manual run. Download the draft to keep edits when leaving this role.</Callout>}
    {changed && <Callout tone="warning" className="mb-4" title="Saved playbook changed">Your local draft is preserved. Download it before reloading the current saved settings; review them before saving again.<Button className="mt-3" variant="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm("Reload the current saved settings and discard the local draft? Download your draft first if you want to keep it.")) { setSource(job); edit(playbookDraft(job.recipe)); } }}>Reload saved settings</Button></Callout>}
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void perform("save"); }} className="space-y-4">
      <label className="flex min-h-11 items-start gap-3 text-sm font-medium"><input type="checkbox" checked={draft.enabled} disabled={disabled || (job.status !== "open" && !draft.enabled)} onChange={event => edit({ ...draft, enabled: event.target.checked })} className="mt-1" />Run these automations for {job.title}</label>
      {job.status !== "open" && <p className="text-sm text-zinc-600 dark:text-zinc-400">Open this job before enabling automation. You can disable an existing playbook while the role is paused or closed.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{AUTOMATION_RULES.map(rule => <div key={rule.key} role="group" aria-label={`${rule.name} settings`} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10"><label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.thresholds[rule.key] !== null} disabled={disabled} onChange={event => edit({ ...draft, thresholds: { ...draft.thresholds, [rule.key]: event.target.checked ? String(rule.initial) : null } })} />{rule.name}</label><p className="mb-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{rule.help}</p><Field label={`${rule.key === "offer_hours" ? "Review before expiry" : rule.key === "prep_hours" ? "Prepare before" : "Follow up after"} (${rule.unit})`} htmlFor={`${id}-${rule.key}`}><Input id={`${id}-${rule.key}`} type="number" min={1} max={rule.max} required={draft.thresholds[rule.key] !== null} disabled={disabled || draft.thresholds[rule.key] === null} value={draft.thresholds[rule.key] ?? ""} onChange={event => edit({ ...draft, thresholds: { ...draft.thresholds, [rule.key]: event.target.value } })} /></Field></div>)}</div>
      <Field label="Default task owner" htmlFor={`${id}-owner`} hint="Unassigned tasks remain in the shared queue. Changing the default applies to new tasks."><Select id={`${id}-owner`} value={draft.owner ?? ""} disabled={disabled} onChange={event => edit({ ...draft, owner: event.target.value || null })}><option value="">Unassigned</option>{ownerUnavailable && <option value={draft.owner!}>Saved owner is no longer available</option>}{job.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</Select></Field>
      {issues.length > 0 && <Callout tone="warning" title="Review the draft thresholds"><ul className="list-inside list-disc">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></Callout>}{ownerUnavailable && <Callout tone="warning">Choose a current coordinator or Unassigned before saving.</Callout>}
      <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy} disabled={disabled || issues.length > 0 || ownerUnavailable || changed}>Save playbook</Button><Button type="button" variant="secondary" disabled={busy || issues.length > 0 || changed} onClick={() => void perform("preview")}>Preview conditions</Button><Button type="button" variant="ghost" disabled={disabled || dirty || changed} onClick={() => void perform("run")}>Run saved playbook now</Button><Button variant="ghost" disabled={busy || !dirty || changed} onClick={() => { if (window.confirm("Discard this unsaved playbook draft and restore the saved settings?")) edit(playbookDraft(source.recipe)); }}>Discard playbook draft</Button><Button variant="ghost" onClick={() => downloadText("orbit-automation-playbook-draft.json", JSON.stringify({ job_id: job.job_id, base_revision: source.revision, latest_saved_revision: job.revision, working_draft: draft, validation_issues: issues, owner_unavailable: ownerUnavailable }, null, 2), "application/json")}><Download className="h-4 w-4" aria-hidden="true" />Download playbook draft</Button></div>
      {preview && !changed && <Callout title={`${preview.total} current follow-up conditions`}><p>{preview.description}</p><ul className="mt-2 list-inside list-disc">{Object.entries(preview.counts).map(([kind, count]) => <li key={kind}>{kind}: {count}</li>)}</ul></Callout>}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}{error && <Callout tone="error">{error.message}</Callout>}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Last successful reconciliation: {savedRecord.last_run_at ? new Date(savedRecord.last_run_at).toLocaleString() : "Not run yet"}. {savedRecord.recipe.enabled ? "Saved playbook enabled." : "Saved playbook disabled."}</p>
    </form>
  </Panel>;
}
