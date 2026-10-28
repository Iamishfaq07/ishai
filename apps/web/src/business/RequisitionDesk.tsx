import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BizRequisition, BizRequisitionAction, BizRequisitionIntake, BizRequisitionList, BizRequisitionReview, BizRequisitionReviewFocus, BizRequisitionState } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Textarea, buttonClass, cx, focusRing } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { companyPath } from "./model";
import { requisitions } from "./requisitionApi";
import { EMPTY_INTAKE, REQUISITION_STATES, changedIntake, requisitionTotals, totalBudget } from "./requisitionModel";
import { Loading, LoadError, Panel, Stat, errorText } from "./ui";

const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString()}`;

export function RequisitionDesk() {
  const { company } = useCompany();
  const [params, setParams] = useSearchParams();
  const selected = params.get("request");
  const [state, setState] = useState<BizRequisitionState | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<BizRequisitionList | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const createId = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; const pending = generation; return () => { live.current = false; pending.current++; }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const load = useCallback(async (after?: string) => {
    const run = ++generation.current;
    try {
      const result = await requisitions.list(company.id, state, query, after);
      if (!live.current || run !== generation.current) return;
      setData(current => after && current ? { ...result, items: [...current.items, ...result.items.filter(r => !current.items.some(old => old.id === r.id))] } : result);
      setError(null);
    } catch (e) { if (live.current && run === generation.current) setError(new Error(errorText(e))); }
  }, [company.id, state, query]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const row = await requisitions.create(company.id, createId.current, { ...EMPTY_INTAKE, title: title.trim() });
      if (!live.current) return;
      createId.current = crypto.randomUUID(); setTitle(""); setParams({ request: row.id }); void load();
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { if (live.current) setBusy(false); }
  };
  if (company.role === "interviewer") return <Callout>Hiring requests are available to recruiting teams and hiring managers.</Callout>;
  if (selected) return <RequisitionDetail key={selected} id={selected} approvers={data?.approvers ?? []} onBack={() => { setParams({}); void load(); }} />;
  const totals = requisitionTotals(data?.items ?? []);
  return <div className="space-y-6">
    <PageTitle title="Hiring requests" subtitle="Agree on the need, outcomes and budget before opening a role." />
    <div className="rounded-2xl bg-zinc-950 p-5 text-white sm:p-7">
      <p className="text-xs font-medium uppercase tracking-wider text-indigo-300">Plan → review → approve → recruit</p>
      <p className="mt-3 max-w-2xl text-xl font-semibold">Give every new role a clear purpose and an accountable approval trail.</p>
      <p className="mt-3 max-w-2xl text-sm text-zinc-300">Draft a headcount request, ask AI to challenge gaps, and route it through up to three reviewers. Approved requests create a job draft when a recruiter chooses to proceed.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Waiting for approval" value={totals.pending} detail="In the loaded requests" />
      <Stat label="Approved positions" value={totals.positions} detail="Awaiting job-draft handoff" />
      <Stat label="Approved annual envelope" value={Object.entries(totals.budgets).map(([currency, amount]) => <span key={currency} className="block text-lg">{money(amount, currency)}</span>)} detail={Object.keys(totals.budgets).length ? "Separate totals per currency; planned cost, not spend" : "No approved budget in loaded requests"} />
    </div>
    <Panel title="Request a role" hint="Start with a title. You can fill in the business case and select reviewers before submitting.">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={e => void create(e)}>
        <div className="min-w-0 flex-1"><Field label="Role title" htmlFor="new-request-title"><Input id="new-request-title" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="Customer success lead" required minLength={2} disabled={busy || company.status !== "active"} /></Field></div>
        <Button type="submit" loading={busy} disabled={title.trim().length < 2 || company.status !== "active"}>Create hiring request</Button>
      </form>
    </Panel>
    {error && <LoadError error={error} onRetry={() => void load()} />}
    <Panel title="Request desk" hint="Hiring managers see their own requests. Owners, admins and recruiters see all company requests.">
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
        <Input aria-label="Search hiring requests" placeholder="Find a role" value={search} onChange={e => setSearch(e.target.value)} />
        <Select aria-label="Filter request status" value={state} onChange={e => setState(e.target.value as BizRequisitionState | "all")}><option value="all">All statuses</option>{Object.entries(REQUISITION_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        <Button variant="secondary" onClick={() => void load()}>Refresh requests</Button>
      </div>
      {!data ? <Loading label="Loading hiring requests" /> : !data.items.length ? <p className="text-sm text-zinc-600 dark:text-zinc-400">No requests match this view. Create a request or change the filters.</p> : <ul className="space-y-3">{data.items.map(row => <li key={row.id}>
        <Link to={`?request=${encodeURIComponent(row.id)}`} className={cx("block rounded-xl border border-zinc-200 p-4 hover:border-indigo-400 dark:border-white/10", focusRing)}>
          <span className="flex flex-wrap items-center justify-between gap-2"><strong className="min-w-0 break-words">{row.data.title}</strong><span className="text-xs text-indigo-700 dark:text-indigo-300">{REQUISITION_STATES[row.state]}</span></span>
          <span className="mt-2 block text-sm text-zinc-600 dark:text-zinc-400">{row.data.positions} position{row.data.positions === 1 ? "" : "s"} · {row.data.department || "Department not set"} · {totalBudget(row.data) === null ? "Budget not set" : `${money(totalBudget(row.data)!, row.data.currency)} annual envelope`}</span>
          {row.state === "pending" && <span className="mt-2 block text-xs">{row.approved_by.length} of {row.approver_ids.length} approvals recorded</span>}
        </Link>
      </li>)}</ul>}
      {data?.next_after && <Button className="mt-4" variant="secondary" onClick={() => void load(data.next_after ?? undefined)}>Load more requests</Button>}
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Totals cover the loaded requests and current filters. Budgets are internal annual cost envelopes; currencies are never combined.</p>
    </Panel>
  </div>;
}

function RequisitionDetail({ id, approvers: initialApprovers, onBack }: { id: string; approvers: BizRequisitionList["approvers"]; onBack: () => void }) {
  const { company } = useCompany();
  const { user } = useAuth();
  const [row, setRow] = useState<BizRequisition | null>(null);
  const [draft, setDraft] = useState<BizRequisitionIntake>(EMPTY_INTAKE);
  const [requirements, setRequirements] = useState("");
  const [approvers, setApprovers] = useState(initialApprovers);
  const [chain, setChain] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [focus, setFocus] = useState<BizRequisitionReviewFocus>("intake");
  const [review, setReview] = useState<BizRequisitionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true);
  const actionLock = useRef(false);
  const value = { ...draft, requirements: requirements.split("\n").map(r => r.trim()).filter(Boolean) };
  const dirty = row !== null && changedIntake(value, row.data);
  const accept = useCallback((next: BizRequisition) => {
    setRow(next); setDraft(next.data); setRequirements(next.data.requirements.join("\n")); setReview(null); setChain([]); setNote("");
  }, []);
  const reload = useCallback(async () => {
    const result = await requisitions.read(company.id, id);
    if (live.current) { accept(result); setError(null); }
  }, [company.id, id, accept]);
  useEffect(() => {
    live.current = true;
    void reload().catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); });
    void requisitions.list(company.id, "all", "").then(data => { if (live.current) setApprovers(data.approvers); }).catch(() => {});
    return () => { live.current = false; };
  }, [reload, company.id]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", before); return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null);
    try { await fn(); } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { actionLock.current = false; if (live.current) setBusy(false); }
  };
  const action = (kind: BizRequisitionAction) => void run(async () => {
    if (!row) return;
    const next = await requisitions.action(company.id, id, row.revision, kind, note, chain);
    if (live.current) accept(next);
  });
  const set = <K extends keyof BizRequisitionIntake>(key: K, val: BizRequisitionIntake[K]) => setDraft(current => ({ ...current, [key]: val }));
  const leave = () => { if (!dirty || window.confirm("Leave this unsaved request? Download your draft first if you want to keep it.")) onBack(); };
  if (!row) return <div className="space-y-4"><Button variant="ghost" onClick={onBack}>← All hiring requests</Button>{error ? <LoadError error={error} onRetry={() => void run(reload)} /> : <Loading label="Loading hiring request" />}</div>;
  const active = !["converted", "cancelled"].includes(row.state);
  const disabled = busy || company.status !== "active";
  const canWrite = !disabled && row.can_edit;
  const reviewerName = (member: string) => approvers.find(a => a.id === member)?.name ?? "Former or unavailable reviewer";
  return <div className="space-y-5">
    <Button variant="ghost" onClick={leave}>← All hiring requests</Button>
    <PageTitle title={row.data.title} subtitle={`${REQUISITION_STATES[row.state]} · revision ${row.revision}`} actions={<>
      <Button variant="secondary" onClick={() => downloadText("orbit-hiring-request.json", JSON.stringify({ request: row, unsaved_intake: value }, null, 2), "application/json")}>Download request</Button>
      <Button variant="ghost" disabled={busy} onClick={() => { if (!dirty || window.confirm("Replace your unsaved edits with the saved request? Download your draft first to keep it.")) void run(reload); }}>Reload request</Button>
    </>} />
    {error && <Callout tone="error">{error.message}</Callout>}
    {dirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Unsaved changes. Save before AI review or approval. You can download this draft if another reviewer changed the request.</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel title="Role intake" hint={row.can_edit ? "Save a draft first; the submitted version stays fixed while reviewers approve it." : active ? "This version is read-only. Reopen it to change the brief and invalidate prior approvals." : "This closed request is read-only. Its submitted brief and decisions remain in the history below."}>
        <fieldset disabled={!canWrite} className="min-w-0 space-y-4">
          <legend className="sr-only">Hiring request details</legend>
          <Field label="Role title" htmlFor="req-title"><Input id="req-title" maxLength={160} value={draft.title} onChange={e => set("title", e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="req-department"><Input id="req-department" maxLength={80} value={draft.department} onChange={e => set("department", e.target.value)} /></Field>
            <Field label="Why this role?" htmlFor="req-reason"><Select id="req-reason" value={draft.reason} onChange={e => set("reason", e.target.value as BizRequisitionIntake["reason"])}><option value="growth">Team growth</option><option value="replacement">Replacement</option><option value="project">New project</option></Select></Field>
            <Field label="Positions" htmlFor="req-positions"><Input id="req-positions" type="number" min={1} max={100} step={1} value={draft.positions} onChange={e => set("positions", Number(e.target.value))} /></Field>
            <Field label="Target start date" htmlFor="req-date"><Input id="req-date" type="date" value={draft.target_date} onChange={e => set("target_date", e.target.value)} /></Field>
            <Field label="Annual budget per position" htmlFor="req-budget" hint="Internal total cost envelope, not a public salary"><Input id="req-budget" type="number" min={0} max={10000000000} step={1} value={draft.annual_budget_per_position ?? ""} onChange={e => set("annual_budget_per_position", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Budget currency" htmlFor="req-currency"><Select id="req-currency" value={draft.currency} onChange={e => set("currency", e.target.value)}>{Array.from(new Set([draft.currency, "INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"])).map(c => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Location" htmlFor="req-location"><Input id="req-location" maxLength={120} value={draft.location} onChange={e => set("location", e.target.value)} /></Field>
            <Field label="Workplace" htmlFor="req-workplace"><Select id="req-workplace" value={draft.workplace} onChange={e => set("workplace", e.target.value as BizRequisitionIntake["workplace"])}><option value="hybrid">Hybrid</option><option value="remote">Remote</option><option value="onsite">On-site</option></Select></Field>
          </div>
          <Field label="Business case" htmlFor="req-case" hint="What problem requires more headcount? What alternatives did you consider? Internal only."><Textarea id="req-case" rows={4} maxLength={4000} value={draft.business_case} onChange={e => set("business_case", e.target.value)} /></Field>
          <Field label="Measurable role outcomes" htmlFor="req-outcomes" hint="What should this role accomplish? These outcomes can seed the job draft."><Textarea id="req-outcomes" rows={4} maxLength={4000} value={draft.outcomes} onChange={e => set("outcomes", e.target.value)} /></Field>
          <Field label="Essential requirements" htmlFor="req-requirements" hint="One per line, up to 15. Include only capabilities needed for the outcomes."><Textarea id="req-requirements" rows={4} maxLength={2414} value={requirements} onChange={e => setRequirements(e.target.value)} /></Field>
        </fieldset>
        {row.can_edit && <Button className="mt-4" disabled={!dirty || disabled} loading={busy} onClick={() => void run(async () => { const next = await requisitions.save(company.id, id, row.revision, value); if (live.current) accept(next); })}>Save request</Button>}
      </Panel>
      <div className="min-w-0 space-y-5">
        <Panel title="Approval route" hint="Reviewers approve in order. They must be active owners/admins, and cannot be the requester or submitter.">
          {row.approver_ids.length > 0 && <ol className="mb-4 space-y-3">{row.approver_ids.map((a, i) => <li key={a} className="text-sm"><span className="font-medium">{i + 1}. {reviewerName(a)}</span><span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{row.approved_by.includes(a) ? "Approved" : row.next_approver_id === a ? "Current reviewer" : row.state === "cancelled" ? "Request cancelled" : "Waiting for previous step"}</span></li>)}</ol>}
          {row.state === "draft" && row.can_manage && <div className="space-y-3">
            <Select aria-label="Add approval reviewer" value="" disabled={disabled || chain.length >= 3} onChange={e => { if (e.target.value) setChain(current => [...current, e.target.value]); }}><option value="">Add reviewer in order…</option>{approvers.filter(a => a.id !== row.requester_id && a.id !== user?.id && !chain.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <ol className="space-y-2">{chain.map((a, i) => <li key={a} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{i + 1}. {reviewerName(a)}</span><Button variant="ghost" size="sm" disabled={disabled} onClick={() => setChain(current => current.filter(x => x !== a))} aria-label={`Remove ${reviewerName(a)} from approval route`}>Remove</Button></li>)}</ol>
            {!approvers.some(a => a.id !== row.requester_id && a.id !== user?.id) && <p className="text-sm">An independent owner/admin reviewer is needed. Add a colleague from <Link to={companyPath(company.id, "team")} className="underline">Team</Link> before submitting.</p>}
          </div>}
          {active && <Field label="Action note" htmlFor="req-note" hint="10–2,000 characters explaining your submission, review or change"><Textarea id="req-note" className="mt-2" rows={3} value={note} maxLength={2000} disabled={disabled} onChange={e => setNote(e.target.value)} /></Field>}
          <div className="mt-4 flex flex-wrap gap-2">
            {row.state === "draft" && row.can_manage && <Button disabled={disabled || dirty || note.trim().length < 10 || !chain.length} onClick={() => action("submit")}>Submit for approval</Button>}
            {row.can_approve && <><Button disabled={disabled || note.trim().length < 10} onClick={() => action("approve")}>Approve current step</Button><Button variant="secondary" disabled={disabled || note.trim().length < 10} onClick={() => action("request_changes")}>Request changes</Button></>}
            {row.can_create_job && <Button disabled={disabled || note.trim().length < 10} onClick={() => action("create_job")}>Create job draft</Button>}
            {row.can_manage && ["pending", "approved"].includes(row.state) && <Button variant="secondary" disabled={disabled || note.trim().length < 10} onClick={() => action("reopen")}>Reopen for changes</Button>}
            {row.can_manage && active && <Button variant="ghost" disabled={disabled || dirty || note.trim().length < 10} onClick={() => { if (window.confirm("Cancel this hiring request? Its history will be retained.")) action("cancel"); }}>Cancel request</Button>}
          </div>
          {row.state === "approved" && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">The next action creates one draft job. Review its description, salary, interview plan and publishing settings in Jobs.</p>}
          {row.job_id && (company.permissions.manage_jobs || company.role === "hiring_manager") && <Link className={cx(buttonClass("secondary"), "mt-3")} to={companyPath(company.id, `jobs/${row.job_id}${company.permissions.manage_jobs ? "/edit" : ""}`)}>Open linked job draft</Link>}
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">This route governs requests created here. Existing jobs and their publishing workflow remain independent.</p>
        </Panel>
        <Panel title="AI planning studio" hint="Challenge gaps in the saved brief, with exact quotes you can inspect. Suggestions do not approve or change the request.">
          <Field label="Review focus" htmlFor="req-ai-focus"><Select id="req-ai-focus" className="mb-3" value={focus} disabled={disabled} onChange={e => { setFocus(e.target.value as BizRequisitionReviewFocus); setReview(null); }}><option value="intake">Clarify the hiring request</option><option value="assessment">Plan interview evidence</option><option value="budget">Prepare budget review questions</option></Select></Field>
          <Button variant="secondary" disabled={disabled || dirty || !active} loading={busy} onClick={() => void run(async () => { const result = await requisitions.review(company.id, id, row.revision, focus); if (live.current) setReview(result); })}>Review saved request with AI</Button>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">10 review attempts per company per UTC day, including failed attempts. No applicant data or external market research is used.</p>
          {review && review.revision === row.revision && !dirty && <div className="mt-4 space-y-4">
            <p className="text-xs font-medium">{review.source === "mock" ? "Test preview · no AI model called" : "AI suggestions · review before use"}</p>
            {review.tips.map(tip => <article key={tip.fact_id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">
              <p className="break-words font-medium">{tip.suggestion}</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-indigo-400 pl-3 text-xs text-zinc-600 dark:text-zinc-400">{tip.source_quote}</blockquote><p className="mt-3 break-words text-xs">Check: {tip.success_check}</p>
              <details className="mt-2 text-xs"><summary>Read source fact</summary><p className="mt-2 whitespace-pre-wrap break-words">{review.facts.find(f => f.id === tip.fact_id)?.text}</p></details>
            </article>)}
          </div>}
        </Panel>
      </div>
    </div>
    <Panel title="Request history" hint="Submitted briefs and reviewer decisions are retained. Reopening clears approval authority while keeping the prior submission in this history.">
      <ol className="space-y-4">{row.history.map(event => <li key={event.id} className="border-l-2 border-zinc-200 pl-4 dark:border-white/10">
        <p className="text-sm font-medium">{event.action.replaceAll("_", " ")} · {event.actor}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Revision {event.revision} · {new Date(event.at).toLocaleString()}</p>{event.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.note}</p>}
        {event.snapshot && <details className="mt-2 text-sm"><summary>Review submitted brief</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-3 text-xs dark:bg-white/5">{JSON.stringify(event.snapshot, null, 2)}</pre></details>}
      </li>)}</ol>
      {row.history_truncated && <p className="mt-4 text-xs">Showing the latest 100 events. Earlier events remain stored.</p>}
    </Panel>
  </div>;
}
