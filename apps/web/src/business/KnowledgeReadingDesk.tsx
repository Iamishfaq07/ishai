import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BizKnowledgeCoverage, BizKnowledgeReadingDocument, BizKnowledgeReadingGuide, BizKnowledgeReadingList, BizKnowledgeReaders } from "@orbit/types";
import { Button, Callout, Input, Select, buttonClass, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { knowledgeReading } from "./knowledgeReadingApi";
import { filterReading, readingDocumentId, readingStatus } from "./knowledgeReadingModel";
import { PublishedReadingText, ReadingIntro } from "./ReadingPresentation";
import { ROLE_LABEL } from "./model";
import { LoadError, Loading, Panel, Stat, errorText } from "./ui";

const saveJson = (name: string, data: unknown) => downloadText(name, JSON.stringify(data, null, 2), "application/json");

export function KnowledgeReadingDesk() {
  const { company } = useCompany();
  // Scope all local state and in-flight work to this company.
  return <ReadingWorkspace key={`${company.id}:${company.role}`} />;
}

function ReadingWorkspace() {
  const { company } = useCompany();
  const [data, setData] = useState<BizKnowledgeReadingList | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("remaining");
  const [tab, setTab] = useState("mine");
  const [params, setParams] = useSearchParams();
  const selected = readingDocumentId(params.get("document"));
  const activeTab = selected ? "mine" : tab;
  const selectDocument = (id: string | null) => { const next = new URLSearchParams(params); if (id) next.set("document", id); else next.delete("document"); setParams(next); };
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await knowledgeReading.list(company.id);
      if (request === generation.current) { setData(next); setError(null); }
    } catch (e) { if (request === generation.current) setError(new Error(errorText(e))); }
  }, [company.id]);
  useEffect(() => {
    void refresh();
    const pending = generation; return () => { pending.current++; };
  }, [refresh]);
  const reload = () => void refresh();
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Loading reading desk" />;
  const shown = filterReading(data.items, query, status);
  return <div className="space-y-6">
    <PageTitle title="Team reading desk" subtitle="Read published guidance, record your acknowledgement and revisit changed instructions." actions={<Link to={`/business/app/${company.id}/knowledge`} className={buttonClass("secondary")}>Knowledge library</Link>} />
    {params.has("document") && !selected && <Callout tone="warning">This document link is invalid. Choose published guidance from the reading list.</Callout>}
    {!selected && activeTab === "mine" && <><ReadingIntro /><details className="text-sm text-zinc-600 dark:text-zinc-400"><summary className="font-medium">About reading acknowledgements</summary><p className="mt-2">An acknowledgement records that you say you read the published text. Reading and AI help never record one automatically. These optional receipts do not assess understanding or gate hiring actions.</p></details></>}
    {data.can_manage && <div className="flex flex-wrap gap-2" aria-label="Reading desk views"><Button variant={activeTab === "mine" ? "primary" : "secondary"} aria-pressed={activeTab === "mine"} onClick={() => { setTab("mine"); selectDocument(null); }}>My reading</Button><Button variant={activeTab === "team" ? "primary" : "secondary"} aria-pressed={activeTab === "team"} onClick={() => { setTab("team"); selectDocument(null); }}>Team coverage</Button></div>}
    {activeTab === "team" && data.can_manage ? <CoverageView key={company.id} /> : <>
      {!selected && <div className="grid gap-3 sm:grid-cols-3"><Stat label="Available to read" value={data.items.length} detail="Published documents your role can access" /><Stat label="Current acknowledgements" value={data.items.filter(r => r.acknowledged).length} detail="Matches the currently published wording" /><Stat label="Not yet current" value={data.items.filter(r => !r.acknowledged).length} detail="New or changed guidance, optional to acknowledge" /></div>}
      {error && <LoadError error={error} />}
      {selected ? <ReadingDocument key={selected} id={selected} onBack={() => { selectDocument(null); setTab("mine"); reload(); }} onChanged={refresh} /> : <Panel title="My reading list" hint="Private drafts never appear here, including for document authors.">
        <div className="mb-4 flex flex-wrap gap-3"><Input className="sm:max-w-sm" aria-label="Search reading list" placeholder="Find guidance" value={query} onChange={e => setQuery(e.target.value)} /><Select className="sm:max-w-xs" aria-label="Reading status" value={status} onChange={e => setStatus(e.target.value)}><option value="remaining">Not yet current</option><option value="current">Acknowledged current text</option><option value="all">All available guidance</option></Select><Button variant="ghost" onClick={reload}>Refresh reading list</Button></div>
        <ul className="space-y-3">{shown.map(row => <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900/60"><div className="min-w-0"><h2 className="break-words font-semibold">{row.title}</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{readingStatus(row)} · published version {row.published_revision}</p>{row.needs_update && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Owner has requested updates to this guidance.</p>}</div><Button variant="secondary" onClick={() => selectDocument(row.id)} aria-label={`Read ${row.title}`}>Read guidance</Button></li>)}</ul>
        {!shown.length && <p className="text-sm text-zinc-600 dark:text-zinc-400">No guidance matches this view. Choose all available guidance or ask a company owner to publish a reference.</p>}
      </Panel>}
    </>}
  </div>;
}

function ReadingDocument({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const { company } = useCompany();
  const [doc, setDoc] = useState<BizKnowledgeReadingDocument | null>(null);
  const [guide, setGuide] = useState<BizKnowledgeReadingGuide | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await knowledgeReading.read(company.id, id);
      if (live.current && request === generation.current) { setDoc(next); setConfirmed(false); setGuide(null); setError(null); }
    } catch (e) { if (live.current && request === generation.current) { setError(new Error(errorText(e))); setConfirmed(false); setGuide(null); } }
  }, [company.id, id]);
  useEffect(() => {
    live.current = true;
    void refresh();
    const pending = generation; return () => { live.current = false; pending.current++; };
  }, [refresh]);
  const run = async (action: "acknowledge" | "withdraw" | "guide" | "reload") => {
    if (locked.current || !doc) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      if (action === "guide") {
        const next = await knowledgeReading.guide(company.id, id, doc.content_hash);
        if (live.current) setGuide(next);
      } else {
        if (action === "acknowledge") await knowledgeReading.acknowledge(company.id, id, doc.content_hash);
        if (action === "withdraw") await knowledgeReading.withdraw(company.id, id);
        if (live.current) { await refresh(); await onChanged(); }
      }
    } catch (e) { if (live.current) { setError(new Error(errorText(e))); setConfirmed(false); setGuide(null); } }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  if (!doc) return <div className="space-y-3"><Button variant="ghost" onClick={onBack}>Back to reading list</Button>{error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Loading label="Loading published guidance" />}</div>;
  const disabled = busy || company.status !== "active";
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={onBack}>Back to reading list</Button><Button variant="secondary" disabled={busy} onClick={() => void run("reload")}>Reload published text</Button></div>
    <Panel title={doc.title} hint={`Published version ${doc.published_revision} · ${readingStatus(doc)}`}>
      {(doc.needs_update || doc.review_overdue) && <Callout tone="warning" className="mb-4">{doc.needs_update ? "The owner has requested updates. " : ""}{doc.review_overdue ? "The review date has passed. " : ""}Check uncertain instructions with the document owner.</Callout>}
      <PublishedReadingText documentId={id} body={doc.data.body} />
      {doc.acknowledged_at && <p className="mt-4 text-sm">Your latest acknowledgement: {new Date(doc.acknowledged_at).toLocaleString()} · version {doc.acknowledged_revision}{!doc.acknowledged ? " · older wording" : ""}</p>}
      {error && <div className="mt-4"><LoadError error={error} /></div>}
      {!doc.acknowledged && <label className="mt-4 flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className={`mt-1 ${focusRing}`} checked={confirmed} disabled={disabled} onChange={e => setConfirmed(e.target.checked)} />I personally read the full published text shown above.</label>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!doc.acknowledged && <Button disabled={disabled || !confirmed} onClick={() => void run("acknowledge")}>Record my acknowledgement</Button>}
        {doc.acknowledged_at && <Button variant="secondary" disabled={disabled} onClick={() => void run("withdraw")}>Withdraw my acknowledgement</Button>}
        <Button variant="ghost" disabled={disabled} onClick={() => void run("guide")}>Prepare AI reading guide</Button>
        {doc.acknowledged && <Button variant="ghost" onClick={() => saveJson("orbit-reading-receipt.json", { document_id: id, title: doc.title, content_hash: doc.content_hash, published_revision: doc.published_revision, acknowledged_revision: doc.acknowledged_revision, acknowledged_at: doc.acknowledged_at, exported_at: new Date().toISOString() })}>Download my receipt</Button>}
      </div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">AI help sends up to six published text excerpts to the configured provider. Ten reading-guide attempts per company per UTC day, including failures. It does not record reading or replace the original document.</p>
    </Panel>
    {guide && <Panel title={guide.source === "mock" ? "Test reading guide · no AI model called" : "AI reading guide"}>
      {(guide.needs_update || guide.review_overdue) && <Callout tone="warning" className="mb-4">This guidance is flagged for updates or past its review date. Confirm uncertain instructions with its owner.</Callout>}
      {guide.excerpts_truncated && <Callout className="mb-4">This guide uses beginning and ending excerpts. Middle passages were omitted; read the full published text.</Callout>}
      <ul className="space-y-4">{guide.tips.map(tip => <li key={tip.fact_id} className="min-w-0 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5"><p className="break-words">{tip.suggestion}</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-indigo-400 pl-3">{tip.source_quote}</blockquote><p className="mt-3 break-words">Self-check: {tip.success_check}</p><details className="mt-3"><summary>Read source excerpt</summary><p className="mt-2 whitespace-pre-wrap break-words">{guide.facts.find(f => f.id === tip.fact_id)?.text}</p></details></li>)}</ul>
      <Button className="mt-4" variant="secondary" onClick={() => saveJson("orbit-policy-reading-guide.json", { document_id: id, ...guide })}>Download reading guide</Button>
    </Panel>}
  </div>;
}

function CoverageView() {
  const { company } = useCompany();
  const [data, setData] = useState<BizKnowledgeCoverage | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await knowledgeReading.coverage(company.id);
      if (request === generation.current) { setData(next); setError(null); }
    } catch (e) { if (request === generation.current) setError(new Error(errorText(e))); }
  }, [company.id]);
  useEffect(() => {
    void refresh();
    const pending = generation; return () => { pending.current++; };
  }, [refresh]);
  const reload = () => void refresh();
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading label="Loading team reading coverage" />;
  return <div className="space-y-4">
    <Panel title="Current-member reading coverage" hint="Eligible means a current, active member whose role can read this publication. These are available references, not mandatory assignments.">
      <div className="mb-4 flex flex-wrap gap-3"><Input aria-label="Search coverage" className="sm:max-w-sm" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find guidance" /><Button variant="ghost" onClick={() => { setSelected(null); reload(); }}>Refresh coverage</Button><Button variant="secondary" onClick={() => saveJson("orbit-policy-reading-coverage.json", data)}>Download coverage summary</Button></div>
      {error && <LoadError error={error} />}
      <ul className="space-y-3">{filterReading(data.items, query, "all").map(row => <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10"><div className="min-w-0"><h2 className="break-words font-semibold">{row.title}</h2><p className="mt-2 text-sm">{row.acknowledged_count} of {row.eligible} eligible readers acknowledged current text · {row.remaining} remaining</p><p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Published version {row.published_revision} · {row.audience === "coordinators" ? "Coordinators only" : "All hiring members"}</p></div><Button variant="secondary" onClick={() => setSelected(row.id)} aria-label={`View readers for ${row.title}`}>View readers</Button></li>)}</ul>
      {!data.items.length && <p className="text-sm">Publish company guidance to see reading coverage.</p>}
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Snapshot: {new Date(data.as_of).toLocaleString()}. Removed and suspended members are excluded. Title, body, category or audience changes require a fresh acknowledgement; review dates and private draft edits do not.</p>
    </Panel>
    {selected && <ReaderDetails key={selected} id={selected} />}
  </div>;
}

function ReaderDetails({ id }: { id: string }) {
  const { company } = useCompany();
  const [data, setData] = useState<BizKnowledgeReaders | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true; setData(null); setError(null);
    void knowledgeReading.readers(company.id, id, offset).then(next => { if (active) setData(next); }).catch((e: unknown) => { if (active) setError(new Error(errorText(e))); });
    return () => { active = false; };
  }, [company.id, id, offset]);
  if (!data) return error ? <LoadError error={error} /> : <Loading label="Loading eligible readers" />;
  return <Panel title={`Readers · ${data.document.title}`} hint="Only owners and admins can see individual reading receipts. They cannot acknowledge on someone else’s behalf.">
    <ul className="space-y-3">{data.items.map(person => <li key={person.id} className="min-w-0 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-white/5"><p className="break-words font-medium">{person.name}</p><p className="mt-1">{ROLE_LABEL[person.role as keyof typeof ROLE_LABEL] ?? person.role} · {person.acknowledged ? "Acknowledged current text" : person.acknowledged_at ? "Older acknowledgement" : "Not acknowledged"}</p>{person.acknowledged_at && <p className="mt-1 text-xs">{new Date(person.acknowledged_at).toLocaleString()} · version {person.acknowledged_revision}</p>}</li>)}</ul>
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.limit))}>Previous readers</Button><p className="text-sm">{data.total ? offset + 1 : 0}–{Math.min(offset + data.items.length, data.total)} of {data.total}</p><Button variant="secondary" disabled={offset + data.limit >= data.total} onClick={() => setOffset(offset + data.limit)}>Next readers</Button><Button variant="ghost" onClick={() => saveJson("orbit-policy-readers-page.json", { ...data, exported_at: new Date().toISOString() })}>Download this reader page</Button></div>
  </Panel>;
}
