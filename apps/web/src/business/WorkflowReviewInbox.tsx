import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Button, Callout, Clock, Field, Input, Select, ShieldCheck, buttonClass } from "@orbit/ui";
import { PageTitle, useCompany } from "./BusinessApp";
import { companyPath } from "./model";
import { pausedReview, visibleReviews, type InboxSort } from "./reviewInboxModel";
import { reviewFollowups, workflowReviews, type WorkflowInboxData, type WorkflowInboxView } from "./workflowApi";
import { LoadError, Loading, Panel, Stat, errorText } from "./ui";

function ReviewArt() {
  return <svg aria-hidden="true" viewBox="0 0 230 150" fill="none" className="h-36 w-56"><rect x="53" y="18" width="128" height="114" rx="15" className="fill-white stroke-indigo-200 dark:fill-zinc-900 dark:stroke-indigo-400/30" transform="rotate(-6 117 75)" /><g className="motion-ok:animate-fade-up">{[46, 77, 108].map((y, i) => <g key={y}><rect x="73" y={y - 10} width="19" height="19" rx="5" className="fill-indigo-50 stroke-indigo-300 dark:fill-indigo-400/10 dark:stroke-indigo-400/50" />{i < 2 && <path d={`M78 ${y}l3 3 6-7`} className="stroke-indigo-600 dark:stroke-indigo-300" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}<path d={`M105 ${y - 3}H158M105 ${y + 5}H144`} className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth="3" strokeLinecap="round" /></g>)}</g><circle cx="180" cy="121" r="22" className="fill-indigo-600" /><path d="M180 108l11 5v8c0 8-11 13-11 13s-11-5-11-13v-8l11-5Z" stroke="white" strokeWidth="1.5" /><path d="m175 121 3 3 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function WorkflowReviewInbox() { const { company } = useCompany(); return <Inbox key={company.id} />; }
function Inbox() {
  const { company } = useCompany();
  const [view, setView] = useState<WorkflowInboxView>("all");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ view: WorkflowInboxView; value: WorkflowInboxData } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState(""); const [jobId, setJobId] = useState(""); const [sort, setSort] = useState<InboxSort>("due");
  const [scanning, setScanning] = useState(false); const [scanError, setScanError] = useState<Error | null>(null); const [notice, setNotice] = useState("");
  const live = useRef(true); const scanLock = useRef(false);
  const allowed = company.permissions.move_applicants;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    if (!allowed) return;
    setData(null); setError(null);
    void workflowReviews.inbox(company.id, view).then(next => { if (current) setData({ view, value: next }); })
      .catch((e: unknown) => { if (current) setError(new Error(errorText(e))); });
    return () => { current = false; };
  }, [company.id, allowed, view, refresh]);
  const scan = async () => {
    if (scanLock.current) return;
    scanLock.current = true; setScanning(true); setScanError(null); setNotice("");
    try { const result = await reviewFollowups.scan(company.id); if (live.current) { setNotice(`${result.created} due internal reminders prepared.`); setRefresh(value => value + 1); } }
    catch (e) { if (live.current) setScanError(new Error(errorText(e))); }
    finally { scanLock.current = false; if (live.current) setScanning(false); }
  };
  if (!allowed) return <Callout>Workflow reviews are available to coordinators and assigned hiring managers.</Callout>;
  const loaded = data?.view === view ? data.value : null;
  const now = Date.now(); const today = new Date(now).toISOString().slice(0, 10);
  const shown = visibleReviews(loaded?.items ?? [], query, jobId, sort);
  const roles = [...new Map((loaded?.items ?? []).map(row => [row.job_id, row.job_title])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const reset = () => { setQuery(""); setJobId(""); setSort("due"); };
  return <div className="space-y-5">
    <PageTitle title="Workflow review inbox" subtitle="Independent checkpoints assigned to you, across roles you currently access." actions={<Link to={companyPath(company.id, "workflow-studio")} className={buttonClass("secondary")}>Workflow Studio<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>} />
    <section aria-labelledby="review-intro-title" className="grid items-center gap-4 rounded-3xl border border-indigo-200 bg-indigo-50/60 p-6 dark:border-indigo-400/20 dark:bg-indigo-400/5 sm:grid-cols-3"><div className="sm:col-span-2"><p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Your independent review queue</p><h2 id="review-intro-title" className="mt-3 text-xl font-semibold">A clear decision starts with visible evidence.</h2><p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">Open a checkpoint, inspect its frozen evidence and record your decision in the workflow. Publishing jobs and hiring decisions happen in their linked workspaces.</p></div><div className="hidden justify-center sm:flex"><ReviewArt /></div></section>
    <section aria-label="Review inbox controls" className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/60 sm:p-5"><div className="grid gap-4 md:grid-cols-2"><Field label="Review inbox filter" htmlFor="review-inbox-filter"><Select id="review-inbox-filter" value={view} onChange={e => { setView(e.target.value as WorkflowInboxView); setJobId(""); setError(null); }}><option value="all">All pending reviews</option><option value="overdue">Overdue reviews</option><option value="snoozed">Paused reminders</option></Select></Field><Field label="Search loaded reviews" htmlFor="review-inbox-search"><Input id="review-inbox-search" type="search" maxLength={120} value={query} onChange={e => setQuery(e.target.value)} placeholder="Role or checkpoint title" /></Field></div>
      <div className="grid gap-4 md:grid-cols-2"><Field label="Role in loaded reviews" htmlFor="review-inbox-role"><Select id="review-inbox-role" value={jobId} onChange={e => setJobId(e.target.value)}><option value="">All loaded roles</option>{jobId && !roles.some(([id]) => id === jobId) && <option value={jobId}>{loaded ? "Selected role is outside this loaded view" : "Selected role"}</option>}{roles.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</Select></Field><Field label="Order loaded reviews" htmlFor="review-inbox-sort"><Select id="review-inbox-sort" value={sort} onChange={e => setSort(e.target.value as InboxSort)}><option value="due">Due date first</option><option value="requested">Oldest request first</option><option value="role">Role title (A–Z)</option></Select></Field></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh review inbox</Button><Button variant="ghost" onClick={reset}>Reset loaded-review filters</Button>{company.permissions.manage_company && <Button variant="ghost" disabled={scanning} onClick={() => void scan()}>Check due review reminders</Button>}</div>
    </section>
    {notice && <p role="status" className="text-sm">{notice}</p>}{scanError && <LoadError error={scanError} />}
    {error ? <LoadError error={error} onRetry={() => setRefresh(value => value + 1)} /> : !loaded ? <Loading label="Loading your review requests" /> : <>
      <section aria-label="Loaded review summary" className="grid grid-cols-3 gap-3"><Stat label="Loaded pending reviews" value={loaded.items.length} /><Stat label="Overdue in this view" value={loaded.items.filter(row => row.overdue).length} /><Stat label="Reminders paused in this view" value={loaded.items.filter(row => pausedReview(row, now)).length} /></section>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Counts and search cover this loaded view, up to 50 requests. Refresh to recheck assignments, due status and reminder pauses.</p>
      {loaded.truncated && <Callout>Showing the first 50 current requests, ordered by due date before undated requests. Local filters cover these loaded requests. Resolve these and refresh for the next requests.</Callout>}
      <Panel title="Awaiting your review" hint={`${shown.length} of ${loaded.items.length} loaded requests shown`}>
        {!loaded.items.length ? <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center dark:border-white/20"><ShieldCheck className="mx-auto h-9 w-9 text-indigo-700 dark:text-indigo-300" aria-hidden="true" /><h3 className="mt-4 font-semibold">Your current queue is clear.</h3><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No current checkpoint reviews are assigned to you.</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">This applies to the selected inbox view. Choose all pending reviews to see your other current requests.</p></div> : !shown.length ? <div className="py-6 text-center"><h3 className="font-semibold">No loaded requests match these filters.</h3><Button variant="secondary" className="mt-4" onClick={reset}>Show all loaded reviews</Button></div> : <ol aria-label="Loaded checkpoint reviews" className="space-y-4">{shown.map(row => <li key={row.id} className={`rounded-2xl border bg-white p-5 dark:bg-zinc-900/60 ${row.overdue ? "border-amber-300 dark:border-amber-400/30" : "border-zinc-200 dark:border-white/10"}`}><div className="flex flex-wrap items-center justify-between gap-3"><span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${row.overdue ? "bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200" : "bg-indigo-50 text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-200"}`}><Clock className="h-3.5 w-3.5" aria-hidden="true" />{row.overdue ? "Overdue" : row.due_date === today ? "Due today UTC" : row.due_date ? "Scheduled review" : "No due date"}</span>{pausedReview(row, now) && <span className="text-xs text-zinc-600 dark:text-zinc-400">Reminders paused</span>}</div><h3 className="mt-4 break-words text-lg font-semibold">{row.step_title}</h3><p className="mt-1 break-words text-sm text-zinc-600 dark:text-zinc-400">{row.job_title}</p>{row.due_date && <p className="mt-4 text-sm">Due {row.due_date} UTC{row.overdue ? " · Overdue" : ""}</p>}{pausedReview(row, now) && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Reminders paused until {new Date(row.snoozed_until!).toLocaleString()} (your time)</p>}<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-white/10"><p className="text-xs text-zinc-600 dark:text-zinc-400">Requested {new Date(row.requested_at).toLocaleString()}</p><Link className={buttonClass("secondary", "sm")} to={row.path}>Open checkpoint review</Link></div></li>)}</ol>}
      </Panel>
    </>}
  </div>;
}
