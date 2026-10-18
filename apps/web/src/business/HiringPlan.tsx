import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { BizHiringPlan, BizHiringPlanRecord, BizInterviewCriterion, BizJob } from "@orbit/types";
import { ArrowLeft, Button, Callout, Field, Input, Plus, Select, Textarea, Trash2, cx, focusRing, toast } from "@orbit/ui";
import { biz } from "./api";
import { PageTitle, useCompany } from "./BusinessApp";
import { hiringApi } from "./hiringApi";
import { HiringLoopGraphic } from "./HiringGraphics";
import { clonePlan, SAMPLE_TEMPLATES } from "./hiringModel";
import { jobPath } from "./model";
import { errorText, LoadError, Loading, Panel } from "./ui";

export function HiringPlanPage() {
  const { company } = useCompany();
  const { jid = "" } = useParams();
  const [record, setRecord] = useState<BizHiringPlanRecord | null>(null);
  const [plan, setPlan] = useState<BizHiringPlan | null>(null);
  const [job, setJob] = useState<BizJob | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let live = true;
    setRecord(null); setPlan(null); setError(null);
    Promise.all([hiringApi.plan(company.id, jid), biz.job(company.id, jid)]).then(([p, j]) => {
      if (live) { setRecord(p); setPlan(clonePlan(p.plan)); setJob(j); }
    }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { live = false; };
  }, [company.id, jid, load]);
  if (error) return <LoadError error={error} onRetry={() => setLoad((n) => n + 1)} />;
  if (!record || !plan || !job) return <Loading label="Opening the interview plan" />;
  const canEdit = company.status === "active" && (company.permissions.manage_jobs || company.role === "hiring_manager");
  const change = (patch: Partial<BizHiringPlan>) => setPlan({ ...plan, ...patch });
  const criterion = (id: string, patch: Partial<BizInterviewCriterion>) =>
    change({ criteria: plan.criteria.map((c) => c.id === id ? { ...c, ...patch } : c) });
  const add = () => change({ criteria: [...plan.criteria, {
    id: crypto.randomUUID(), name: "New criterion", stage_id: plan.criteria[0]!.stage_id,
    question: "Describe a specific example of this skill. What did you do and how did you verify the result?",
    probe: "What constraints or alternatives did you consider?",
    strong: "Explains specific decisions, trade-offs and evidence of their own contribution.",
    weak: "Gives a general description without an example of their own contribution.", minutes: 8,
  }] });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setNotice(null);
    try {
      const saved = await hiringApi.savePlan(company.id, jid, plan, record.revision);
      setRecord(saved); setPlan(clonePlan(saved.plan));
      toast({ message: "Interview plan saved", tone: "success" });
    } catch (err) { setNotice(errorText(err)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6">
    <Link to={jobPath(company.id, jid)} className={cx("inline-flex items-center gap-2 rounded text-sm text-zinc-600 dark:text-zinc-400", focusRing)}>
      <ArrowLeft className="h-4 w-4" /> {job.title}
    </Link>
    <PageTitle title="Design the interview" subtitle="A shared bar for the role, room for real evidence." />
    <div className="grid items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900 md:grid-cols-2">
      <div><p className="font-medium">{record.revision ? `Plan version ${record.revision}` : "Your first interview plan"}</p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Define what matters before you meet candidates. Interviewers save their own observations, then compare evidence together.</p></div>
      <HiringLoopGraphic />
    </div>
    <form onSubmit={(e) => void save(e)} className="space-y-6">
      <fieldset disabled={busy || !canEdit} className="space-y-6">
        <Panel title="What you will assess" hint="Use job-related criteria, consistent questions and concrete rating anchors. No score is inferred from appearance or personality."
          actions={<Button type="button" variant="secondary" size="sm" disabled={plan.criteria.length >= 12} onClick={add}><Plus className="h-4 w-4" /> Add criterion</Button>}>
          <div className="space-y-5">{plan.criteria.map((c, i) => <section key={c.id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10" aria-label={`Criterion ${i + 1}`}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Criterion {i + 1}</h3>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${c.name}`} disabled={plan.criteria.length === 1}
                onClick={() => change({ criteria: plan.criteria.filter((r) => r.id !== c.id) })}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Skill or outcome" htmlFor={`criterion-name-${c.id}`}><Input id={`criterion-name-${c.id}`} value={c.name} required minLength={2} maxLength={120}
                onChange={(e) => criterion(c.id, { name: e.target.value })} /></Field>
              <Field label="Interview stage" htmlFor={`criterion-stage-${c.id}`}><Select id={`criterion-stage-${c.id}`} value={c.stage_id}
                onChange={(e) => criterion(c.id, { stage_id: e.target.value })}>
                {job.stages.filter((s) => !["hired", "rejected"].includes(s.kind)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select></Field>
              <Field label="Discussion time (minutes)" htmlFor={`criterion-time-${c.id}`}><Input id={`criterion-time-${c.id}`} type="number" min={2} max={30} value={c.minutes}
                onChange={(e) => criterion(c.id, { minutes: Number(e.target.value) })} /></Field>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Field label="Core question" htmlFor={`criterion-question-${c.id}`}><Textarea id={`criterion-question-${c.id}`} value={c.question} required minLength={12} maxLength={800} rows={3}
                onChange={(e) => criterion(c.id, { question: e.target.value })} /></Field>
              <Field label="Follow-up to probe" htmlFor={`criterion-probe-${c.id}`}><Textarea id={`criterion-probe-${c.id}`} value={c.probe} maxLength={600} rows={3}
                onChange={(e) => criterion(c.id, { probe: e.target.value })} /></Field>
              <Field label="Strong evidence looks like" htmlFor={`criterion-strong-${c.id}`}><Textarea id={`criterion-strong-${c.id}`} value={c.strong} required minLength={10} maxLength={500} rows={3}
                onChange={(e) => criterion(c.id, { strong: e.target.value })} /></Field>
              <Field label="Needs more evidence when" htmlFor={`criterion-weak-${c.id}`}><Textarea id={`criterion-weak-${c.id}`} value={c.weak} required minLength={10} maxLength={500} rows={3}
                onChange={(e) => criterion(c.id, { weak: e.target.value })} /></Field>
            </div>
          </section>)}</div>
        </Panel>
        <Panel title="Independent feedback" hint="Private drafts and consistent questions help the panel form its own view. Owners, admins and recruiters can coordinate the debrief.">
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className={cx("mt-0.5", focusRing)} checked={plan.independent_feedback}
            onChange={(e) => change({ independent_feedback: e.target.checked })} />
            <span>Interviewers submit their own evidence before seeing colleagues' feedback for that stage.</span></label>
        </Panel>
        <Panel title="A practical challenge, then a change request" hint="See how someone approaches real work and adapts when a constraint changes. A human reviews both versions; assistance disclosure is never a score.">
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" className={focusRing} checked={Boolean(plan.work_sample)}
            onChange={(e) => change({ work_sample: e.target.checked ? structuredClone(SAMPLE_TEMPLATES.engineering!) : null })} /> Add a practical challenge to this plan</label>
          {plan.work_sample && <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">{Object.entries(SAMPLE_TEMPLATES).map(([key, value]) => <Button key={key} type="button" variant="secondary" size="sm"
              onClick={() => change({ work_sample: structuredClone(value) })}>Use {key} scenario</Button>)}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Challenge title" htmlFor="sample-title"><Input id="sample-title" value={plan.work_sample.title} required minLength={5} maxLength={140}
                onChange={(e) => change({ work_sample: { ...plan.work_sample!, title: e.target.value } })} /></Field>
              <Field label="Suggested time box (minutes)" htmlFor="sample-time"><Input id="sample-time" type="number" min={10} max={120} value={plan.work_sample.time_box_min}
                onChange={(e) => change({ work_sample: { ...plan.work_sample!, time_box_min: Number(e.target.value) } })} /></Field>
            </div>
            <Field label="Initial scenario" htmlFor="sample-brief"><Textarea id="sample-brief" value={plan.work_sample.brief} rows={5} required minLength={40} maxLength={6000}
              onChange={(e) => change({ work_sample: { ...plan.work_sample!, brief: e.target.value } })} /></Field>
            <Field label="Change request (revealed after the first submission)" htmlFor="sample-change"><Textarea id="sample-change" value={plan.work_sample.change_request} rows={3} required minLength={20} maxLength={2500}
              onChange={(e) => change({ work_sample: { ...plan.work_sample!, change_request: e.target.value } })} /></Field>
            <Field label="Candidate guidance" htmlFor="sample-guidance"><Textarea id="sample-guidance" value={plan.work_sample.candidate_guidance} rows={3} required minLength={10} maxLength={1200}
              onChange={(e) => change({ work_sample: { ...plan.work_sample!, candidate_guidance: e.target.value } })} /></Field>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" className={focusRing} checked={plan.work_sample.required}
              onChange={(e) => change({ work_sample: { ...plan.work_sample!, required: e.target.checked } })} /> Flag an incomplete challenge in the decision checklist</label>
          </div>}
        </Panel>
        <Panel title="Set expectations for candidates">
          <div className="space-y-3"><Field label="What candidates should know" htmlFor="candidate-intro"><Textarea id="candidate-intro" value={plan.candidate_intro}
            rows={3} required minLength={10} maxLength={1600} onChange={(e) => change({ candidate_intro: e.target.value })} /></Field>
            <Field label="Team target for moving an active application (days)" htmlFor="response-target"><Input id="response-target" type="number" min={1} max={30}
              value={plan.response_target_days} onChange={(e) => change({ response_target_days: Number(e.target.value) })} className="max-w-40" /></Field></div>
        </Panel>
      </fieldset>
      {notice && <Callout tone="error">{notice}</Callout>}
      {canEdit && <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
        <Button type="submit" loading={busy}>Save interview plan</Button>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">Existing interview drafts keep the version they started with.</span>
      </div>}
    </form>
  </div>;
}
