import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BizKnowledgeReviewBrief, BizKnowledgeReviewInbox, BizKnowledgeReviewItem } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Textarea, buttonClass, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageTitle, useCompany } from "./BusinessApp";
import { knowledgeReviews } from "./knowledgeReviewApi";
import { REVIEW_LABELS, filterReviews, nextReviewDate } from "./knowledgeReviewModel";
import { LoadError, Loading, Panel, Stat, errorText } from "./ui";

export function KnowledgeReviewInbox() {
  const { company } = useCompany();
  const { user } = useAuth();
  const [data, setData] = useState<BizKnowledgeReviewInbox | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [mine, setMine] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");
  const live = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const next = await knowledgeReviews.list(company.id);
    if (live.current && request === generation.current) { setData(next); setError(null); }
  }, [company.id]);
  useEffect(() => {
    live.current = true;
    if (company.permissions.manage_company) void refresh().catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); });
    const pending = generation; return () => { live.current = false; pending.current++; };
  }, [refresh, company.permissions.manage_company]);
  const remind = async () => {
    if (sending) return;
    setSending(true); setResult(""); setError(null);
    try {
      const count = await knowledgeReviews.remind(company.id);
      if (live.current) { setResult(`${count.created} new internal reminder${count.created === 1 ? "" : "s"}. ${count.unavailable_owner} due document${count.unavailable_owner === 1 ? " has" : "s have"} no eligible owner.`); await refresh(); }
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { if (live.current) setSending(false); }
  };
  if (!company.permissions.manage_company) return <Callout>Only company owners and admins can coordinate policy reviews.</Callout>;
  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))} /> : <Loading label="Loading policy review inbox" />;
  const shown = filterReviews(data.items, status, query, mine, user?.id ?? "");
  return <div className="space-y-6">
    <PageTitle title="Policy review inbox" subtitle="Keep published hiring guidance owned, reviewed and useful." actions={<>
      <Link to={`/business/app/${company.id}/knowledge`} className={buttonClass("secondary")}>Knowledge library</Link>
      <Button variant="ghost" onClick={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))}>Refresh reviews</Button>
      <Button disabled={company.status !== "active"} loading={sending} onClick={() => void remind()}>Run opted-in reminders</Button>
    </>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Review due" value={data.items.filter(r => r.state === "due").length} detail="Due today or earlier, in UTC" />
      <Stat label="Updates requested" value={data.items.filter(r => r.state === "needs_update").length} detail="Flagged guidance remains visibly marked" />
      <Stat label="Due within 14 days" value={data.items.filter(r => r.state === "soon").length} detail="Plan the next review" />
      <Stat label="Owner unavailable" value={data.items.filter(r => !r.owner_available).length} detail="Assign an active owner/admin" />
    </div>
    {error && <LoadError error={error} />}
    {result && <p role="status" className="text-sm">{result}</p>}
    <Panel title="Review queue" hint="Published, active references only. Assignment identifies responsibility; any authorized owner/admin can help review.">
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem_auto]">
        <Input aria-label="Search policy reviews" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find guidance" />
        <Select aria-label="Review queue status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All review states</option>{Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="unassigned">Owner unavailable</option></Select>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={mine} onChange={e => setMine(e.target.checked)} />Assigned to me</label>
      </div>
      <div className="space-y-4">{shown.map(row => <ReviewCard key={`${row.id}:${row.revision}`} row={row} owners={data.owners} today={data.as_of} onChanged={refresh} />)}</div>
      {!shown.length && <p className="text-sm text-zinc-600 dark:text-zinc-400">No published guidance matches this view. Publish a document in the knowledge library or adjust the filters.</p>}
    </Panel>
    <p className="text-xs text-zinc-500 dark:text-zinc-400">Reminders default off and stay inside Orbit. Enabled reviews are checked by the Business automation loop about every five minutes while the API is running, starting after 30 seconds. A publication/date/owner/update episode sends one reminder, including across repeated runs. No review decision is made automatically. Snapshot date: {data.as_of} UTC.</p>
  </div>;
}

function ReviewCard({ row, owners, today, onChanged }: { row: BizKnowledgeReviewItem; owners: BizKnowledgeReviewInbox["owners"]; today: string; onChanged: () => Promise<void> }) {
  const { company } = useCompany();
  const [owner, setOwner] = useState(row.owner_available ? row.owner_id ?? "" : "");
  const [reminders, setReminders] = useState(row.reminders);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(nextReviewDate(today));
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<BizKnowledgeReviewBrief | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true);
  const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await fn(); } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const write = (action: "assign" | "confirm" | "needs_update") => void run(async () => {
    if (action === "assign") await knowledgeReviews.assign(company.id, row.id, row.revision, owner || null, reminders, note.trim());
    else await knowledgeReviews.decide(company.id, row.id, row.revision, row.published_revision, action, note.trim(), action === "confirm" ? date : "");
    if (live.current) await onChanged();
  });
  const disabled = busy || company.status !== "active";
  return <article className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{row.title}</h3><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{REVIEW_LABELS[row.state]} · published version {row.published_revision} · {row.review_due || "No review date"}</p><p className="mt-2 text-xs">Review owner: {row.owner_name ?? "Unassigned or unavailable"}</p></div><Link to={`/business/app/${company.id}/knowledge?document=${row.id}`} className={buttonClass("secondary", "sm")}>Open document</Link></div>
    {row.has_draft_changes && <p className="mt-3 text-sm text-indigo-700 dark:text-indigo-300">A saved private draft differs from the publication. Confirming current guidance will preserve those draft edits.</p>}
    <details className="mt-4"><summary className="text-sm font-medium">Coordinate review</summary>
      <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-4"><legend className="sr-only">Review controls for {row.title}</legend>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Review owner" htmlFor={`owner-${row.id}`}><Select id={`owner-${row.id}`} value={owner} onChange={e => setOwner(e.target.value)}><option value="">Unassigned</option>{owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field><Field label="Next review date" htmlFor={`date-${row.id}`} hint="Future date within two years; used only when confirming current guidance"><Input id={`date-${row.id}`} type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></Field></div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={reminders} onChange={e => setReminders(e.target.checked)} />Enable internal reminders for the assigned owner</label>
        <Field label="Review note" htmlFor={`note-${row.id}`} hint="10–1,000 characters; retained with the document’s private action history"><Textarea id={`note-${row.id}`} rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </fieldset>
      {error && <div className="mt-3"><LoadError error={error} /></div>}
      {note.trim() && <Button className="mt-3" variant="ghost" size="sm" onClick={() => downloadText("orbit-policy-review-draft.json", JSON.stringify({ document_id: row.id, revision: row.revision, published_revision: row.published_revision, owner_id: owner || null, reminders, next_review_date: date, note }, null, 2), "application/json")}>Download review notes</Button>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={disabled || note.trim().length < 10 || (reminders && !owner)} onClick={() => write("assign")}>Save review owner</Button>
        <Button disabled={disabled || note.trim().length < 10 || !date} onClick={() => write("confirm")}>Confirm published guidance</Button>
        <Button variant="secondary" disabled={disabled || note.trim().length < 10} onClick={() => write("needs_update")}>Request document updates</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => void run(async () => { const result = await knowledgeReviews.brief(company.id, row.id, row.revision); if (live.current) setBrief(result); })}>Review changes with AI</Button>
      </div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Confirming records a human review of the currently published text and publishes its new review date. It does not publish private draft wording or a changed audience. Requesting updates flags the guidance and its AI citations until a human confirms or publishes a reviewed version.</p>
      {row.reminded_at && <p className="mt-3 text-xs">Last internal reminder: {new Date(row.reminded_at).toLocaleString()}</p>}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">AI review sends saved publication and private draft excerpts to the configured provider. Ten change-review attempts per company per UTC day, including failures.</p>
      {brief && <div className="mt-5 space-y-3">
        <p className="text-sm font-medium">{brief.source === "mock" ? "Test review · no AI model called" : "AI change-review brief · verify against the full document"}</p>
        {brief.excerpts_truncated && <Callout>The review uses bounded excerpts and changed lines. Open the full document before making a decision.</Callout>}
        <ul className="space-y-3">{brief.tips.map(tip => <li key={tip.fact_id} className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-white/5"><p className="break-words">{tip.suggestion}</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-indigo-400 pl-3 text-xs">{tip.source_quote}</blockquote><p className="mt-3 break-words text-xs">Check: {tip.success_check}</p><details className="mt-2 text-xs"><summary>Read review fact</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{brief.facts.find(f => f.id === tip.fact_id)?.text}</pre></details></li>)}</ul>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">AI suggestions do not confirm currency, approve a policy or change the document. Ten change-review generation attempts per company per UTC day, including failures.</p>
      </div>}
    </details>
  </article>;
}
