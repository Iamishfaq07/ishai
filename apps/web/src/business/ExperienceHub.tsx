import { useCallback, useEffect, useRef, useState } from "react";
import type { BizExperienceBrief, BizExperienceDashboard, BizExperiencePlan } from "@orbit/types";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Callout, Field, Input, Select, Textarea, buttonClass, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { experience } from "./experienceApi";
import { Loading, LoadError, Panel, Stat, errorText } from "./ui";

const STAGES: Record<string, string> = { interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected", withdrawn: "Withdrawn" };
export function ExperienceHub() { const { company } = useCompany(); return <Workspace key={company.id} />; }
function Workspace() {
  const { company } = useCompany();
  const [jobs, setJobs] = useState<Array<{ id: string; title: string }>>([]);
  const [params, setParams] = useSearchParams();
  const requested = params.get("job") ?? "";
  const selected = requested || jobs[0]?.id || "";
  const [ready, setReady] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    if (company.permissions.move_applicants) void experience.jobs(company.id).then(next => { if (active) { setJobs(next.items); setTruncated(next.truncated); setReady(true); } }).catch((e: unknown) => { if (active) setError(new Error(errorText(e))); });
    return () => { active = false; };
  }, [company.id, company.permissions.move_applicants]);
  if (!company.permissions.move_applicants) return <Callout>Candidate experience is available to recruiting coordinators and assigned hiring managers.</Callout>;
  return <div className="space-y-5">
    <PageTitle title="Candidate experience" subtitle="Listen to process feedback, review aggregate signals and track a team improvement plan." actions={<Link className={buttonClass("secondary")} to={`/business/app/${company.id}/jobs`}>Hiring jobs</Link>} />
    {error && <LoadError error={error} />}
    {!ready ? !error && <Loading label="Loading experience workspaces" /> : jobs.length ? <Field label="Experience report job" htmlFor="experience-job"><Select id="experience-job" value={selected} onChange={e => setParams({ job: e.target.value })}>{requested && !jobs.some(j => j.id === requested) && <option value={requested}>Selected job from pipeline</option>}{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</Select></Field> : <Callout>Create a hiring job to configure optional candidate feedback.</Callout>}
    {truncated && <Callout>Showing the latest 200 jobs visible to your role.</Callout>}
    {selected && <JobExperience key={selected} jid={selected} />}
  </div>;
}
function JobExperience({ jid }: { jid: string }) {
  const { company } = useCompany();
  const [data, setData] = useState<BizExperienceDashboard | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<BizExperienceBrief | null>(null);
  const live = useRef(true);
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    const next = await experience.dashboard(company.id, jid);
    if (live.current) { setData(next); setError(null); }
    return next.version;
  }, [company.id, jid]);
  useEffect(() => { live.current = true; void refresh().catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); }); return () => { live.current = false; }; }, [refresh]);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setResult("");
    try { await fn(); } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  if (!data) return error ? <LoadError error={error} /> : <Loading label="Loading process feedback" />;
  const disabled = busy || company.status !== "active";
  return <div className="space-y-5">
    <h2 className="break-words text-lg font-semibold">{data.job.title}</h2>
    <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { setBrief(null); await refresh(); })}>Refresh experience report</Button><Button variant="secondary" onClick={() => downloadText("orbit-candidate-experience-report.json", JSON.stringify(data, null, 2), "application/json")}>Download aggregate report</Button></div>
    {error && <LoadError error={error} />}{result && <p role="status" className="text-sm">{result}</p>}
    <div className="grid grid-cols-2 gap-3"><Stat label="Feedback invitations" value={data.enabled ? "Enabled" : "Off"} detail="Optional prompts in the private application portal" /><Stat label="Released responses" value={data.report.participants ?? "Withheld"} detail="Complete groups of five; no individual reporting" /></div>
    <Campaign key={`campaign:${data.revision}`} data={data} onSaved={next => { setData(next); setBrief(null); }} />
    <Panel title="Candidate process signals" hint="Voluntary ratings from eligible responses retained for 90 days. These describe the process, not candidate suitability.">
      {data.report.status === "collecting" ? <Callout>Results remain withheld until a complete group of five can be released. Individual responses and partial-group counts are not exposed to the hiring team.</Callout> : <><div className="grid gap-3 md:grid-cols-3">{data.report.scores.map(score => <div key={score.id} className="min-w-0 rounded-xl bg-zinc-50 p-4 dark:bg-white/5"><h3 className="text-sm font-medium">{score.label}</h3><p className="mt-3 text-2xl font-semibold">{score.mean}/5</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Responses 1–5: {Object.values(score.distribution).join(" · ")}</p></div>)}</div><h3 className="mt-5 font-semibold">Requested improvements</h3><ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{data.report.priorities.map(p => <li key={p.id} className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">{p.label}: {p.count}</li>)}</ul></>}
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Reports use fixed, non-overlapping groups. A removed, deletion-pending or expired response suppresses its entire original group; remaining members are never recycled into another group. Pending responses are excluded. There are no stage/date/demographic filters or individual response exports.</p>
    </Panel>
    <Panel title="AI process improvement brief" hint="Uses released aggregates only. No individual responses, candidate identities, resumes or interview assessments are sent.">
      <Button disabled={disabled || data.report.status !== "ready"} onClick={() => void run(async () => { setBrief(null); const next = await experience.brief(company.id, jid, data.version); const current = await refresh(); if (next.version !== current) throw new Error("The report changed. Request a fresh brief."); if (live.current) setBrief(next); })}>Prepare experience brief</Button>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Ten attempts per company per UTC day, including failures. AI suggestions cite the supplied aggregates and do not diagnose causes, rate candidates or change records.</p>
      {brief?.version === data.version && <div className="mt-4 space-y-3"><h3 className="font-semibold">{brief.source === "mock" ? "Test experience brief · no AI model called" : "AI process brief"}</h3><ul className="space-y-3">{brief.tips.map(t => <li key={t.fact_id} className="rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5"><p className="break-words">{t.suggestion}</p><blockquote className="mt-3 break-words border-l-2 border-indigo-400 pl-3 text-xs">{t.source_quote}</blockquote><p className="mt-3 break-words text-xs">Check: {t.success_check}</p></li>)}</ul></div>}
    </Panel>
    <ImprovementPlan key={`plan:${data.revision}`} data={data} brief={brief?.version === data.version ? brief : null} onSaved={next => { setData(next); setBrief(null); }} />
    <Panel title="Prepare feedback invitations" hint="Only enabled campaigns. Up to 100 eligible confirmed applicants are invited per run, once per application. This places a prompt in their portal; no email is sent."><Button disabled={disabled || !data.enabled} onClick={() => void run(async () => { const next = await experience.invite(company.id, jid); if (live.current) setResult(`${next.created} feedback invitations prepared in application portals. No email sent.`); })}>Prepare opted-in invitations</Button><p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Enabled campaigns also reconcile about every five minutes while the API runs. Turning off a campaign pauses new invitations and responses; candidates can still remove previous feedback.</p></Panel>
  </div>;
}
function Campaign({ data, onSaved }: { data: BizExperienceDashboard; onSaved: (data: BizExperienceDashboard) => void }) {
  const { company } = useCompany();
  const [enabled, setEnabled] = useState(data.enabled);
  const [stages, setStages] = useState(data.stage_kinds);
  const [days, setDays] = useState(data.expiry_days);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true); const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const save = async () => { if (locked.current) return; locked.current = true; setBusy(true); setError(null); try { const next = await experience.configure(company.id, data.job.id, data.revision, enabled, stages, days); if (live.current) onSaved(next); } catch (e) { if (live.current) setError(new Error(errorText(e))); } finally { locked.current = false; if (live.current) setBusy(false); } };
  return <Panel title="Optional feedback campaign" hint="Default off. Candidates choose whether to participate and can withdraw their response. No free-text answers are collected.">
    <fieldset disabled={busy || company.status !== "active"} className="space-y-4"><legend className="sr-only">Campaign settings</legend><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable optional candidate feedback</label><fieldset><legend className="text-sm font-medium">Invite after these stages</legend><div className="mt-2 flex flex-wrap gap-4">{Object.entries(STAGES).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={stages.includes(key)} onChange={e => setStages(e.target.checked ? [...stages, key] : stages.filter(s => s !== key))} />{label}</label>)}</div></fieldset><Field label="Invitation expires after days" htmlFor="experience-expiry"><Input id="experience-expiry" type="number" min={1} max={30} value={days} onChange={e => setDays(Number(e.target.value))} /></Field></fieldset>
    {error && <LoadError error={error} />}<Button className="mt-4" disabled={busy || company.status !== "active" || !stages.length || !Number.isInteger(days) || days < 1 || days > 30} onClick={() => void save()}>Save feedback campaign</Button>
  </Panel>;
}
function ImprovementPlan({ data, brief, onSaved }: { data: BizExperienceDashboard; brief: BizExperienceBrief | null; onSaved: (data: BizExperienceDashboard) => void }) {
  const { company } = useCompany();
  const [goal, setGoal] = useState(data.plan.goal ?? "");
  const [actions, setActions] = useState((data.plan.actions ?? []).join("\n"));
  const [status, setStatus] = useState<BizExperiencePlan["status"]>(data.plan.status ?? "planned");
  const [date, setDate] = useState(data.plan.target_date ?? "");
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true); const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const steps = actions.split("\n").map(s => s.trim()).filter(Boolean);
  const valid = goal.trim().length >= 10 && steps.length > 0 && steps.length <= 5 && steps.every(s => s.length >= 10 && s.length <= 500);
  const save = async () => { if (locked.current) return; locked.current = true; setBusy(true); setError(null); try { const next = await experience.plan(company.id, data.job.id, data.revision, { goal: goal.trim(), actions: steps, status, target_date: date }, source); if (live.current) onSaved(next); } catch (e) { if (live.current) setError(new Error(errorText(e))); } finally { locked.current = false; if (live.current) setBusy(false); } };
  return <Panel title="Team improvement plan" hint="Turn the process findings into a reviewed plan. Saving does not contact candidates or change hiring decisions.">
    {source && source !== data.version && <Callout className="mb-4">The report changed after these suggestions were drafted. Review the current aggregates before saving.<Button className="mt-3" variant="secondary" onClick={() => setSource(data.version)}>Use refreshed report reference</Button></Callout>}
    {brief && <Button className="mb-4" variant="secondary" disabled={busy} onClick={() => { setGoal("Improve the hiring process using the released candidate feedback."); setActions(brief.tips.map(t => `${t.suggestion} Check: ${t.success_check}`.slice(0, 500)).join("\n")); setSource(brief.version); }}>Use AI suggestions in plan</Button>}
    <fieldset disabled={busy || company.status !== "active"} className="space-y-4"><legend className="sr-only">Process improvement plan</legend><Field label="Improvement goal" htmlFor="experience-goal"><Input id="experience-goal" maxLength={300} value={goal} onChange={e => setGoal(e.target.value)} /></Field><Field label="Improvement actions" htmlFor="experience-actions" hint="One action per line, up to five; 10–500 characters each"><Textarea id="experience-actions" rows={5} value={actions} onChange={e => setActions(e.target.value)} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Plan status" htmlFor="experience-plan-status"><Select id="experience-plan-status" value={status} onChange={e => setStatus(e.target.value as BizExperiencePlan["status"])}><option value="planned">Planned</option><option value="active">In progress</option><option value="done">Completed</option></Select></Field><Field label="Plan review date" htmlFor="experience-plan-date"><Input id="experience-plan-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div></fieldset>
    {error && <LoadError error={error} />}<div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy || company.status !== "active" || !valid} onClick={() => void save()}>Save improvement plan</Button><Button variant="ghost" onClick={() => downloadText("orbit-experience-improvement-plan.json", JSON.stringify({ job_id: data.job.id, revision: data.revision, goal, actions: steps, status, target_date: date, source_version: source }, null, 2), "application/json")}>Download plan draft</Button></div>
  </Panel>;
}
