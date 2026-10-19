import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { BizEvidenceRating, BizFeedbackContent, BizHiringDecision, BizHiringRoom, BizSampleSubmission } from "@orbit/types";
import { ArrowLeft, Button, Callout, Field, Select, Textarea, buttonClass, confirmDialog, cx, focusRing, toast } from "@orbit/ui";
import { PageTitle, useCompany } from "./BusinessApp";
import { hiringApi } from "./hiringApi";
import { FeedbackAddenda } from "./FeedbackAddenda";
import { CompanyConversation } from "./HiringConversation";
import { EvidenceOrbit } from "./HiringGraphics";
import { COVERAGE_WORDS, coverageCount, feedbackStages, planPath } from "./hiringModel";
import { applicationPath } from "./model";
import { errorText, LoadError, Loading, Panel } from "./ui";

const CompanySaba = lazy(async () => ({ default: (await import("./BusinessSaba")).CompanySaba }));
const CompanyOffer = lazy(async () => ({ default: (await import("./BusinessOffer")).CompanyOffer }));
const CompanyHandoff = lazy(async () => ({ default: (await import("./BusinessHandoff")).CompanyHandoff }));

function InterviewTimer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(seconds + Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, seconds]);
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <span className="font-mono tabular-nums" aria-label="Interview elapsed time">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    <Button size="sm" variant="secondary" onClick={() => setRunning(!running)}>{running ? "Pause timer" : "Start timer"}</Button>
    <Button size="sm" variant="ghost" onClick={() => { setSeconds(0); setRunning(false); }}>Reset</Button>
    <span className="text-xs text-zinc-500">Local pacing aid. Nothing is recorded.</span>
  </div>;
}

export function SampleResponse({ answer, title }: { answer: BizSampleSubmission; title: string }) {
  return <div className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <h3 className="font-medium">{title}</h3>
    <p className="whitespace-pre-wrap break-words text-sm">{answer.response}</p>
    <p className="text-xs font-medium text-zinc-500">Their reasoning</p>
    <p className="whitespace-pre-wrap break-words text-sm">{answer.explanation}</p>
    <p className="text-xs text-zinc-500">Assistance disclosed: {answer.assistance}</p>
  </div>;
}

function FeedbackEditor({ room, stage, onSaved }: { room: BizHiringRoom; stage: string; onSaved: (room: BizHiringRoom) => void }) {
  const { company } = useCompany();
  const id = useId();
  const own = room.feedback.find((f) => f.mine && f.stage_id === stage);
  const plan = own?.plan_snapshot ?? room.plan.plan;
  const criteria = plan.criteria.filter((c) => c.stage_id === stage);
  const [content, setContent] = useState<BizFeedbackContent>(() => structuredClone(own?.content ?? {
    ratings: criteria.map((c) => ({ criterion_id: c.id, score: null, observation: "", source: "interview", quote: "" })),
    recommendation: "hold", summary: "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const locked = !!own?.submitted_at || room.status !== "active" || company.status !== "active";
  const update = (criterionId: string, patch: Partial<BizEvidenceRating>) => {
    setDirty(true);
    setContent({ ...content, ratings: content.ratings.map((r) => r.criterion_id === criterionId ? { ...r, ...patch } : r) });
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = async (submit: boolean) => {
    if (submit && !(await confirmDialog({ title: "Submit your independent feedback?", body: "Your observations will be sealed and available to eligible teammates. You cannot overwrite this submission.", confirmLabel: "Submit feedback" }))) return;
    setBusy(true); setError(null);
    try {
      onSaved(await hiringApi.feedback(company.id, room.application_id, content, stage, own?.revision ?? 0, own?.plan_revision ?? room.plan.revision, submit));
      setDirty(false);
      toast({ message: submit ? "Feedback submitted and sealed" : "Private draft saved", tone: "success" });
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    <Callout tone="info" title={locked ? "Your submitted feedback is sealed" : "Your draft is private"}>
      {locked ? "Use the debrief to discuss context. This original record stays intact." : "Save your observations explicitly. Peer drafts are never shown. Leave anything you did not observe unscored."}
    </Callout>
    {own && own.plan_revision !== room.plan.revision && <Callout tone="warning">This feedback uses plan version {own.plan_revision}. The current plan is version {room.plan.revision}; your original rubric is preserved.</Callout>}
    <fieldset disabled={locked || busy} className="space-y-4">
      {criteria.map((c) => {
        const rating = content.ratings.find((r) => r.criterion_id === c.id);
        if (!rating) return null;
        return <Panel key={c.id} title={c.name} hint={`${c.minutes} minute guide · Plan version ${own?.plan_revision ?? room.plan.revision}`}>
          <p className="font-medium">{c.question}</p><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Follow-up: {c.probe}</p>
          <details className="my-3 text-sm"><summary className={cx("cursor-pointer rounded font-medium", focusRing)}>Rating anchors</summary>
            <dl className="mt-2 space-y-2"><div><dt className="font-medium">Strong evidence</dt><dd>{c.strong}</dd></div><div><dt className="font-medium">Needs support</dt><dd>{c.weak}</dd></div></dl>
          </details>
          <div className="space-y-3">
            <Field label="What did you actually observe?" htmlFor={`${id}-${c.id}-o`} hint="Describe their action, reasoning or outcome. A submitted score needs at least 20 characters of evidence.">
              <Textarea id={`${id}-${c.id}-o`} rows={3} maxLength={1800} value={rating.observation} onChange={(e) => update(c.id, { observation: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Assessment" htmlFor={`${id}-${c.id}-s`}>
                <Select id={`${id}-${c.id}-s`} value={rating.score ?? ""} onChange={(e) => update(c.id, { score: e.target.value ? Number(e.target.value) as 1 | 2 | 3 | 4 : null })}>
                  {COVERAGE_WORDS.map((word, i) => <option key={word} value={i || ""}>{i ? `${i} · ${word}` : word}</option>)}
                </Select>
              </Field>
              <Field label="Evidence source" htmlFor={`${id}-${c.id}-src`}>
                <Select id={`${id}-${c.id}-src`} value={rating.source} onChange={(e) => update(c.id, { source: e.target.value as BizEvidenceRating["source"] })}>
                  <option value="interview">Interview observation</option><option value="resume">Shared resume</option><option value="work_sample">Practical challenge</option><option value="saba">Saba transcript</option>
                </Select>
              </Field>
            </div>
            <Field label="Verbatim evidence quote (optional)" htmlFor={`${id}-${c.id}-q`} hint="Must appear exactly in the selected source. For interview evidence, quote your observation above.">
              <Textarea id={`${id}-${c.id}-q`} rows={2} maxLength={1200} value={rating.quote} onChange={(e) => update(c.id, { quote: e.target.value })} />
            </Field>
          </div>
        </Panel>;
      })}
      <Panel title="Your summary">
        <div className="space-y-3">
          <Field label="Recommendation" htmlFor={`${id}-rec`}><Select id={`${id}-rec`} value={content.recommendation} onChange={(e) => { setDirty(true); setContent({ ...content, recommendation: e.target.value as BizFeedbackContent["recommendation"] }); }}>
            <option value="hold">Need more evidence</option><option value="hire">Recommend hire</option><option value="no_hire">Do not recommend hire</option>
          </Select></Field>
          <Field label="Summary and remaining questions" htmlFor={`${id}-summary`}><Textarea id={`${id}-summary`} rows={3} maxLength={3000} value={content.summary} onChange={(e) => { setDirty(true); setContent({ ...content, summary: e.target.value }); }} /></Field>
        </div>
      </Panel>
    </fieldset>
    {own?.submitted_at && <FeedbackAddenda feedback={own} cid={company.id} aid={room.application_id} editable={company.status === "active"} onSaved={onSaved} />}
    {error && <Callout tone="error">{error} Your text is still here. Copy it before reloading if another tab changed this draft.</Callout>}
    {!locked && <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
      <Button variant="secondary" loading={busy} onClick={() => void save(false)}>Save private draft</Button>
      <Button disabled={busy} onClick={() => void save(true)}>Submit feedback</Button>
      <span role="status" className="text-xs text-zinc-500">{dirty ? "Unsaved changes" : own ? "Draft saved" : "No draft saved"}</span>
    </div>}
  </div>;
}

function Debrief({ room, onSaved }: { room: BizHiringRoom; onSaved: (room: BizHiringRoom) => void }) {
  const { company } = useCompany();
  const id = useId();
  const [outcome, setOutcome] = useState<BizHiringDecision["outcome"]>("hold");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (room.feedback_locked) return <Callout tone="info" title="Independent feedback first">Submit your feedback for a stage before viewing its panel observations. Other interviewers' drafts stay private.</Callout>;
  const save = async () => {
    setBusy(true); setError(null);
    try { onSaved(await hiringApi.decision(company.id, room.application_id, outcome, reason, room.evidence_version, ack)); setReason(""); setAck(false); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {room.decision_outdated && <Callout tone="warning" title="Revisit the decision record">The current evidence snapshot differs from the latest decision. Review submitted feedback, dated addenda, Saba evidence and any changed plan before relying on that record.</Callout>}
    <Panel title="Evidence coverage" hint="Observations by criterion. A blank area means unassessed; scores are not averaged into an automatic verdict.">
      <div className="space-y-4">{room.coverage.map((c) => <div key={c.criterion_id} className="border-b border-zinc-200 pb-4 last:border-0 dark:border-white/10">
        <h3 className="font-medium">{c.name} {c.spread >= 2 && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Discuss disagreement</span>}</h3>
        {c.observations.length === 0 ? <p className="mt-1 text-sm text-zinc-500">No submitted observation yet.</p> : <ul className="mt-2 space-y-2">{c.observations.map((o, i) => <li key={i} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/5">
          <p className="font-medium">{o.author} · {o.score}/4 · {COVERAGE_WORDS[o.score]} <span className="font-normal text-zinc-500">· plan v{o.plan_revision}</span></p>
          <p className="mt-1 whitespace-pre-wrap">{o.observation}</p>
        </li>)}</ul>}
      </div>)}</div>
    </Panel>
    <Panel title="Submitted summaries">{room.feedback.filter((f) => f.submitted_at).map((f) => <article key={f.id} className="mb-3 text-sm"><h3 className="font-medium">{f.author} · {f.content.recommendation.replaceAll("_", " ")}</h3><p className="whitespace-pre-wrap">{f.content.summary || "No summary added."}</p><FeedbackAddenda feedback={f} cid={company.id} aid={room.application_id} /></article>)}</Panel>
    {room.gaps.length > 0 && <Callout tone="warning" title="Resolve or explicitly acknowledge these gaps"><ul className="list-disc space-y-1 pl-4">{room.gaps.map((g) => <li key={g}>{g}</li>)}</ul></Callout>}
    {company.permissions.move_applicants && room.status === "active" && company.status === "active" && <Panel title="Record a human decision" hint="Records the evidence you reviewed. Move stages or send a candidate update from their application.">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
        <fieldset disabled={busy} className="space-y-3">
          <Field label="Decision" htmlFor={`${id}-out`}><Select id={`${id}-out`} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}><option value="hold">Collect more evidence</option><option value="advance">Advance</option><option value="hire">Recommend hire</option><option value="no_hire">Do not recommend hire</option></Select></Field>
          <Field label="Evidence and rationale" htmlFor={`${id}-reason`} hint="At least 30 characters. Refer to observations and explain remaining uncertainty."><Textarea id={`${id}-reason`} rows={4} minLength={30} maxLength={5000} required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {room.gaps.length > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed these evidence gaps and will include them in the decision record.</label>}
        </fieldset>
        {error && <Callout tone="error">{error} Reload the room to review new evidence; copy your rationale first.</Callout>}
        <Button type="submit" loading={busy}>Save decision record</Button>
      </form>
    </Panel>}
    <Panel title="Decision history">{room.decisions.length ? <ol className="space-y-3">{room.decisions.map((d) => <li key={d.id} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/5"><p className="font-medium">{d.outcome.replaceAll("_", " ")} · {d.actor} · {new Date(d.created_at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap">{d.rationale}</p>{d.acknowledged_gaps.length > 0 && <p className="mt-2 text-xs text-zinc-500">Recorded with {d.acknowledged_gaps.length} acknowledged evidence gaps.</p>}</li>)}</ol> : <p className="text-sm text-zinc-500">No decision recorded.</p>}</Panel>
  </div>;
}

export function HiringRoomPage() {
  const { company } = useCompany();
  const { aid = "" } = useParams();
  const [params] = useSearchParams();
  const [room, setRoom] = useState<BizHiringRoom | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tab, setTab] = useState(() => params.get("tab") === "offer" && company.permissions.move_applicants ? "offer" : "prepare");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [load, setLoad] = useState(0);
  useEffect(() => {
    let live = true;
    setRoom(null); setError(null);
    hiringApi.room(company.id, aid).then((r) => { if (live) { setRoom(r); setStage(r.feedback_stage_id); } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { live = false; };
  }, [company.id, aid, load]);
  if (error) return <LoadError error={error} onRetry={() => setLoad((n) => n + 1)} />;
  if (!room) return <Loading label="Opening the interview room" />;
  const count = coverageCount(room.coverage);
  const sample = room.work_sample;
  const own = room.feedback.find((f) => f.mine && f.stage_id === stage);
  const assign = async () => {
    setBusy(true); setNotice(null);
    try { setRoom(await hiringApi.assignSample(company.id, aid)); toast({ message: "Challenge assigned. It is available on the candidate's application page.", tone: "success" }); }
    catch (e) { setNotice(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-5">
    <Link to={applicationPath(company.id, aid)} className={cx("inline-flex items-center gap-2 rounded text-sm", focusRing)}><ArrowLeft className="h-4 w-4" /> Application and scheduling</Link>
    <PageTitle title={`Interview · ${room.name}`} subtitle={`${room.job_title} · ${room.reference}`} actions={<Link to={planPath(company.id, room.job_id)} className={buttonClass("secondary")}>Interview plan</Link>} />
    <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
      <EvidenceOrbit {...count} /><div><p className="font-semibold">Every decision starts with evidence</p><p className="mt-1 text-sm text-zinc-500">{room.pending_reviewers} of {room.expected_reviewers} assigned reviewers still to submit · {count.disagreements} criteria to discuss</p><p className="mt-1 text-xs text-zinc-500">Plan v{room.plan.revision} · Observed criteria reflect feedback you can currently view.</p></div>
    </div>
    {!room.plan.revision && <Callout tone="warning" title="Save the interview plan first">The suggested questions are editable starting points. Your team needs to save a job plan before collecting structured feedback.</Callout>}
    <nav aria-label="Interview workspace" className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {[["prepare", "Prepare"], ["interview", "Interview"], ["challenge", "Practical challenge"], ["debrief", "Team debrief"], ["inbox", "Candidate inbox"], ["saba", "Saba screening"], ...(company.permissions.move_applicants ? [["offer", "Offer and hire"]] : [])].map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key!)} className={cx("whitespace-nowrap border-b-2 px-4 py-3 text-sm", focusRing, tab === key ? "border-indigo-600 font-semibold" : "border-transparent text-zinc-500")}>{label}</button>)}
    </nav>
    <Suspense fallback={<p role="status">Loading hiring tools…</p>}>
      <div hidden={tab !== "saba"}><CompanySaba cid={company.id} aid={aid} readOnly={!company.permissions.move_applicants || room.status !== "active" || company.status !== "active"} /></div>
      {company.permissions.move_applicants && <div hidden={tab !== "offer"} className="space-y-5"><CompanyOffer cid={company.id} aid={aid} readOnly={room.status !== "active" || company.status !== "active"} /><CompanyHandoff cid={company.id} aid={aid} readOnly={!["active", "hired"].includes(room.status) || company.status !== "active"} /></div>}
    </Suspense>
    {tab === "prepare" && <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title="Resume evidence and follow-up questions" hint="Only quotes found in the shared resume appear. A reference is a starting point to verify, not a skill verdict."><div className="space-y-5">{room.evidence.map((e) => <article key={e.criterion_id}><h3 className="font-medium">{e.name}</h3>{e.quote ? <blockquote className="my-2 whitespace-pre-wrap border-l-2 border-indigo-400 pl-3 text-sm">{e.quote}</blockquote> : <p className="my-2 text-sm text-zinc-500">No verified resume excerpt linked. Ask for a concrete example.</p>}<p className="text-sm">{e.question}</p><p className="mt-1 text-sm text-zinc-500">{e.probe}</p></article>)}</div></Panel>
      <div className="space-y-4"><Panel title="What the candidate sees"><p className="whitespace-pre-wrap text-sm">{room.plan.plan.candidate_intro}</p><p className="mt-3 text-xs text-zinc-500">Their application page shows assessment areas and time guidance. Private anchors and panel feedback stay with your team.</p></Panel>
        <Panel title="Candidate questions"><p className="text-sm text-zinc-500">{room.candidate_questions.filter((q) => !q.reply).length} unanswered in the latest question page. Read and reply in the candidate inbox.</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => setTab("inbox")}>Open candidate inbox</Button></Panel>
      </div>
    </div>}
    <div hidden={tab !== "interview"} className="space-y-4"><InterviewTimer />
      <Field label="Interview stage" htmlFor="feedback-stage"><Select id="feedback-stage" value={stage} onChange={async (e) => { const next = e.target.value; if (await confirmDialog({ title: "Switch interview stage?", body: "Save any private draft before switching. Unsaved text in this stage will be discarded.", confirmLabel: "Switch stage" })) setStage(next); }}>
        {feedbackStages(room).map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
      </Select></Field>
      {room.plan.revision > 0 && <FeedbackEditor key={`${stage}-${own?.revision ?? 0}`} room={room} stage={stage} onSaved={setRoom} />}
    </div>
    <div hidden={tab !== "inbox"}><CompanyConversation cid={company.id} aid={aid} canReply={company.permissions.move_applicants && company.status === "active"} /></div>
    {tab === "challenge" && <div className="space-y-4"><Panel title={sample?.brief.title ?? room.plan.plan.work_sample?.title ?? "Practical challenge"} hint="A small task, then a changed constraint. Discuss the candidate's reasoning; no automated grading or tool-use detection.">
      {sample ? <div className="space-y-4"><p className="whitespace-pre-wrap text-sm">{sample.brief.brief}</p><p className="text-xs text-zinc-500">About {sample.brief.time_box_min} minutes · Frozen from plan v{sample.plan_revision}</p>
        {sample.answer ? <SampleResponse title="Initial solution" answer={sample.answer} /> : <Callout tone="info">Waiting for the candidate's initial solution.</Callout>}
        {sample.change_request && <div><h3 className="font-medium">Changed constraint</h3><p className="mt-1 whitespace-pre-wrap text-sm">{sample.change_request}</p></div>}
        {sample.follow_up ? <SampleResponse title="Adaptation and reasoning" answer={sample.follow_up} /> : sample.answer && <p className="text-sm text-zinc-500">Waiting for their response to the changed constraint.</p>}
      </div> : room.plan.plan.work_sample ? <div className="space-y-3"><p className="whitespace-pre-wrap text-sm">{room.plan.plan.work_sample.brief}</p><p className="text-sm text-zinc-500">The second constraint is released only after the first submission. Assigned briefs do not change when you edit the job plan.</p>
        {company.permissions.move_applicants && <Button loading={busy} disabled={room.status !== "active" || company.status !== "active"} onClick={() => void assign()}>Assign to candidate</Button>}</div> : <p className="text-sm text-zinc-500">Add a challenge in the interview plan. Templates cover engineering, support, operations and sales.</p>}
      {notice && <Callout tone="error" className="mt-3">{notice}</Callout>}
    </Panel></div>}
    {tab === "debrief" && <Debrief room={room} onSaved={setRoom} />}
  </div>;
}
