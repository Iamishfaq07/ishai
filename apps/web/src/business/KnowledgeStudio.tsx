import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BizKnowledgeAnswer, BizKnowledgeContent, BizKnowledgeDocument, BizKnowledgeLibrary } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Textarea, cx, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { knowledge } from "./knowledgeApi";
import { EMPTY_KNOWLEDGE, KNOWLEDGE_ACTION_LABELS, KNOWLEDGE_AUDIENCES, KNOWLEDGE_CATEGORIES, changedKnowledge, filterKnowledge, knowledgeAnswerText, questionKey } from "./knowledgeModel";
import { LoadError, Loading, Panel, Stat, errorText } from "./ui";

export function KnowledgeStudio() {
  const { company } = useCompany();
  const [params, setParams] = useSearchParams();
  const selected = params.get("document");
  const [library, setLibrary] = useState<BizKnowledgeLibrary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  const live = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const data = await knowledge.list(company.id);
    if (live.current && request === generation.current) { setLibrary(data); setError(null); }
  }, [company.id]);
  useEffect(() => {
    live.current = true;
    void refresh().catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); });
    const pending = generation;
    return () => { live.current = false; pending.current++; };
  }, [refresh]);
  if (selected || creating) return <DocumentEditor key={selected ?? "new"} id={selected} onBack={() => { setCreating(false); setParams({}); void refresh().catch((e: unknown) => setError(new Error(errorText(e)))); }} onCreated={id => { setCreating(false); setParams({ document: id }); }} />;
  if (!library) return error ? <LoadError error={error} onRetry={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))} /> : <Loading label="Loading Business knowledge" />;
  const rows = filterKnowledge(library.items, query, status);
  return <div className="space-y-6">
    <PageTitle title="Knowledge studio" subtitle="A shared source of truth for your hiring policies, interview playbooks and joining guides." actions={<>
      <Link to={`/business/app/${company.id}/knowledge-reading`} className={cx("rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium dark:border-white/10", focusRing)}>Team reading</Link>
      {library?.can_manage && <Link to={`/business/app/${company.id}/knowledge-reviews`} className={cx("rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium dark:border-white/10", focusRing)}>Review inbox</Link>}
      <Button variant="secondary" onClick={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))}>Refresh library</Button>
      {library.can_manage && <Button disabled={company.status !== "active"} onClick={() => setCreating(true)}>Add document</Button>}
    </>} />
    <div className="rounded-2xl bg-zinc-950 p-5 text-white sm:p-7"><p className="text-xs font-medium uppercase tracking-wider text-indigo-300">Author → publish → cite → review</p><p className="mt-3 max-w-2xl text-xl font-semibold">Give your team answers they can check against the original policy.</p><p className="mt-3 max-w-2xl text-sm text-zinc-300">Publish the guidance your team uses. Ask a question or generate a checklist from the published library, with exact source quotes and version references.</p></div>
    {error && <LoadError error={error} onRetry={() => void refresh().catch((e: unknown) => setError(new Error(errorText(e))))} />}
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Published references" value={library.published_count} detail="Available to your current role" /><Stat label="Review dates passed" value={library.items.filter(r => !r.archived && r.review_overdue).length} detail="Review the guidance before relying on it" /><Stat label={library.can_manage ? "Drafts to review" : "Documents in view"} value={library.can_manage ? library.items.filter(r => !r.archived && r.has_draft_changes).length : library.items.length} detail={library.can_manage ? "Draft edits do not replace published text" : "Published material shared with your role"} /></div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel title="Reference library" hint={library.can_manage ? "Owners/admins can author and publish. Reader access follows the published audience." : "Drafts and restricted material are excluded from your view."}>
        <div className="mb-4 grid gap-3 sm:grid-cols-2"><Input aria-label="Search knowledge documents" placeholder="Search title or category" value={query} onChange={e => setQuery(e.target.value)} /><Select aria-label="Knowledge status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All available documents</option><option value="published">Published</option><option value="review">Review date passed</option>{library.can_manage && <><option value="drafts">Draft changes</option><option value="archived">Archived</option></>}</Select></div>
        <ul className="space-y-3">{rows.map(row => <li key={row.id}><button className={cx("block w-full rounded-xl border border-zinc-200 p-4 text-left hover:border-indigo-400 dark:border-white/10", focusRing)} onClick={() => setParams({ document: row.id })}>
          <span className="block break-words font-semibold">{row.title}</span><span className="mt-2 block text-xs text-zinc-600 dark:text-zinc-400">{KNOWLEDGE_CATEGORIES[row.category]} · {row.archived ? "Archived" : row.published_revision === null ? "Unpublished" : `Published version ${row.published_revision}`}</span>
          <span className="mt-2 block text-xs">{KNOWLEDGE_AUDIENCES[row.audience]}</span>
          {row.has_draft_changes && !row.archived && <span className="mt-2 block text-xs text-indigo-700 dark:text-indigo-300">Private draft changes saved</span>}
          {row.review_overdue && !row.archived && <span className="mt-2 block text-xs text-amber-700 dark:text-amber-300">Review date passed: {row.review_due}</span>}
        </button></li>)}</ul>
        {!rows.length && <p className="text-sm text-zinc-600 dark:text-zinc-400">No matching references. {library.can_manage ? "Add a company document or change the filters." : "Ask a company owner/admin to publish guidance for your team."}</p>}
        {library.truncated && <Callout className="mt-4">Showing the 200 most recently updated documents, including archives. Published search covers the active library.</Callout>}
      </Panel>
      <KnowledgeAssistant key={company.id} library={library} onOpen={id => setParams({ document: id })} />
    </div>
  </div>;
}

function KnowledgeAssistant({ library, onOpen }: { library: BizKnowledgeLibrary; onOpen: (id: string) => void }) {
  const { company } = useCompany();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"answer" | "checklist">("answer");
  const [selected, setSelected] = useState<string[]>([]);
  const [deriving, setDeriving] = useState(false);
  const derivedRequest = useRef({ key: "", id: "" });
  const [answer, setAnswer] = useState<BizKnowledgeAnswer | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const locked = useRef(false);
  const current = useRef(""); current.current = questionKey(question, mode, library.source_version, selected);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setAnswer(null); setSelected([]); }, [library.source_version]);
  const ask = async (e: FormEvent) => {
    e.preventDefault(); if (locked.current) return;
    locked.current = true; setBusy(true); setAnswer(null); setError(null);
    const key = current.current;
    try {
      const result = await knowledge.ask(company.id, question.trim(), mode, library.source_version, selected);
      if (live.current && key === current.current) setAnswer(result);
    } catch (e) { if (live.current && key === current.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const derive = async () => {
    if (!answer || locked.current) return;
    locked.current = true; setDeriving(true); setError(null);
    const key = current.current;
    if (derivedRequest.current.key !== key) derivedRequest.current = { key, id: crypto.randomUUID() };
    try {
      const row = await knowledge.create(company.id, derivedRequest.current.id, {
        ...EMPTY_KNOWLEDGE, title: `Checklist draft: ${question.trim()}`.slice(0, 160),
        body: knowledgeAnswerText(question, answer), category: "operations", audience: "coordinators",
      }, answer.source_version);
      if (live.current) onOpen(row.id);
    } catch (e) { if (live.current && key === current.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setDeriving(false); }
  };
  const usable = library.items.filter(r => !r.archived && r.published_revision !== null);
  return <Panel title="Ask company knowledge" hint="Questions and checklists use published text available to your role. No applicant records or web search are queried.">
    <form onSubmit={e => void ask(e)} className="space-y-4">
      <Field label="Your question" htmlFor="knowledge-question"><Textarea id="knowledge-question" maxLength={1200} rows={4} disabled={deriving} value={question} onChange={e => { setQuestion(e.target.value); setAnswer(null); }} placeholder="How should we collect independent interview feedback?" /></Field>
      <Field label="Response format" htmlFor="knowledge-mode"><Select id="knowledge-mode" disabled={deriving} value={mode} onChange={e => { setMode(e.target.value as "answer" | "checklist"); setAnswer(null); }}><option value="answer">Cited answer</option><option value="checklist">Practical checklist</option></Select></Field>
      {usable.length > 0 && <details className="text-sm"><summary>Choose specific published references (optional)</summary><p className="my-2 text-xs text-zinc-500 dark:text-zinc-400">Use the whole active library, or choose up to 20 documents.</p><ul className="max-h-52 space-y-2 overflow-auto">{usable.map(d => <li key={d.id}><label className="flex min-h-10 items-center gap-2"><input type="checkbox" className={focusRing} checked={selected.includes(d.id)} disabled={deriving || (!selected.includes(d.id) && selected.length >= 20)} onChange={() => { setSelected(ids => ids.includes(d.id) ? ids.filter(i => i !== d.id) : [...ids, d.id]); setAnswer(null); }} /><span className="min-w-0 break-words">{d.title}</span></label></li>)}</ul></details>}
      <Button type="submit" loading={busy} disabled={deriving || question.trim().length < 8 || company.status !== "active" || !library.published_count}>{mode === "checklist" ? "Build cited checklist" : "Ask with sources"}</Button>
    </form>
    <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Published passages and your question are sent to the configured AI provider. There are 10 generation attempts per company per UTC day. Exact-word retrieval may miss differently phrased guidance; no-match searches do not call a model.</p>
    {error && <div className="mt-4"><LoadError error={error} /></div>}
    {answer && <div className="mt-5 space-y-4" aria-live="polite">
      {answer.status === "insufficient" ? <Callout title="Not enough evidence">The available published passages do not support an answer. Try the policy's terminology, select another reference, or ask an owner/admin to add the missing guidance.</Callout> : <>
        <p className="text-xs font-medium">{answer.source === "mock" ? "Test preview · no AI model called" : "AI synthesis · verify against the cited guidance"}</p>
        {answer.needs_update && <Callout tone="warning">A cited document has been flagged for updates by the company. Confirm the guidance before using it.</Callout>}
        {answer.review_overdue && <Callout tone="warning">Some cited guidance is past its review date. Confirm it is still current with the document owner.</Callout>}
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={deriving} onClick={() => downloadText("orbit-cited-working-notes.txt", knowledgeAnswerText(question, answer), "text/plain;charset=utf-8")}>Download cited notes</Button>{library.can_manage && answer.mode === "checklist" && <Button disabled={busy || company.status !== "active"} loading={deriving} onClick={() => void derive()}>Create draft playbook</Button>}</div>
        {library.can_manage && answer.mode === "checklist" && <p className="text-xs text-zinc-500 dark:text-zinc-400">A draft playbook keeps these citations, starts with coordinator-only access, and requires review and explicit publication.</p>}
        <ol className="space-y-4">{answer.points.map((point, i) => {
          const source = answer.sources.find(s => s.id === point.passage_id);
          return <li key={`${point.passage_id}-${i}`} className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-white/10"><p className="whitespace-pre-wrap break-words">{answer.mode === "checklist" && <span className="font-semibold">{i + 1}. </span>}{point.text}</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-indigo-400 pl-3 text-xs text-zinc-600 dark:text-zinc-400">{point.quote}</blockquote>{source && <><Button className="mt-3 max-w-full text-left" size="sm" variant="ghost" onClick={() => onOpen(source.document_id)}><span className="min-w-0 whitespace-normal break-words">{source.title} · version {source.revision}</span></Button><details className="mt-2 text-xs"><summary>Read retrieved passage</summary><p className="mt-2 whitespace-pre-wrap break-words">{source.text}</p></details></>}</li>;
        })}</ol>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Citations show provenance, not proof that the AI interpreted the policy correctly. Refresh the library before relying on later policy changes. No actions were performed.</p>
      </>}
    </div>}
  </Panel>;
}

function DocumentEditor({ id, onBack, onCreated }: { id: string | null; onBack: () => void; onCreated: (id: string) => void }) {
  const { company } = useCompany();
  const canManage = company.permissions.manage_company;
  const [row, setRow] = useState<BizKnowledgeDocument | null>(null);
  const [draft, setDraft] = useState<BizKnowledgeContent>(EMPTY_KNOWLEDGE);
  const [note, setNote] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const lock = useRef(false);
  const createId = useRef(crypto.randomUUID());
  const dirty = changedKnowledge(draft, row?.data ?? EMPTY_KNOWLEDGE);
  const accept = useCallback((value: BizKnowledgeDocument) => { setRow(value); setDraft(value.data); setNote(""); setError(null); }, []);
  const reload = useCallback(async () => { if (id) { const result = await knowledge.read(company.id, id); if (live.current) accept(result); } }, [company.id, id, accept]);
  useEffect(() => {
    live.current = true; void reload().catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); });
    return () => { live.current = false; };
  }, [reload]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { await fn(); } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const save = () => void run(async () => {
    if (id && row) { const result = await knowledge.save(company.id, id, row.revision, draft); if (live.current) accept(result); }
    else { const result = await knowledge.create(company.id, createId.current, draft); if (live.current) { accept(result); onCreated(result.id); } }
  });
  const act = (action: "publish" | "archive" | "restore" | "delete") => void run(async () => {
    if (!row || !id) return;
    const result = await knowledge.action(company.id, id, row.revision, action, note.trim());
    if (!live.current) return;
    if ("deleted" in result) onBack(); else accept(result);
  });
  const set = <K extends keyof BizKnowledgeContent>(field: K, value: BizKnowledgeContent[K]) => setDraft(old => ({ ...old, [field]: value }));
  const leave = () => { if (!dirty || window.confirm("Leave your unsaved document? Download the draft first to keep it.")) onBack(); };
  if (id && !row) return <div className="space-y-4"><Button variant="ghost" onClick={onBack}>← Knowledge library</Button>{error ? <LoadError error={error} onRetry={() => void run(reload)} /> : <Loading label="Loading document" />}</div>;
  if (!id && !canManage) return <Callout>Only company owners and admins can author knowledge documents.</Callout>;
  const editable = canManage && !busy && company.status === "active" && !row?.archived;
  return <div className="space-y-5 [&_h1]:break-words">
    <Button variant="ghost" onClick={leave}>← Knowledge library</Button>
    <PageTitle title={row?.data.title ?? "Add company knowledge"} subtitle={canManage ? "Private draft changes are separate from the published version used by readers and AI." : `Published version ${row?.published_revision ?? ""} · ${KNOWLEDGE_AUDIENCES[draft.audience]}`} actions={<>
      <Button variant="secondary" onClick={() => downloadText("orbit-knowledge-document.json", JSON.stringify({ document: row, unsaved_draft: draft }, null, 2), "application/json")}>Download document</Button>
      {id && <Button variant="ghost" disabled={busy} onClick={() => { if (!dirty || window.confirm("Replace unsaved edits with the saved document? Download your draft first to keep it.")) void run(reload); }}>Reload document</Button>}
    </>} />
    {error && <LoadError error={error} />}
    {dirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Unsaved draft. Save before publishing; download it if another editor changed the document.</p>}
    {row?.needs_update && <Callout tone="warning">This published guidance has been flagged for updates. Review its current instructions before relying on it.</Callout>}
    {row?.archived && <Callout>This document is archived and excluded from readers and AI. Restore it as an unpublished draft before using it again.</Callout>}
    <Panel title={canManage ? "Document draft" : "Published guidance"}>
      {canManage ? <fieldset disabled={!editable} className="min-w-0 space-y-4"><legend className="sr-only">Document content</legend>
        <Field label="Document title" htmlFor="knowledge-title"><Input id="knowledge-title" maxLength={160} value={draft.title} onChange={e => set("title", e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category" htmlFor="knowledge-category"><Select id="knowledge-category" value={draft.category} onChange={e => set("category", e.target.value as BizKnowledgeContent["category"])}>{Object.entries(KNOWLEDGE_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          <Field label="Published audience" htmlFor="knowledge-audience"><Select id="knowledge-audience" value={draft.audience} onChange={e => set("audience", e.target.value as BizKnowledgeContent["audience"])}>{Object.entries(KNOWLEDGE_AUDIENCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          <Field label="Review due date" htmlFor="knowledge-review"><Input id="knowledge-review" type="date" value={draft.review_due} onChange={e => set("review_due", e.target.value)} /></Field>
        </div>
        <Field label="Reference text" htmlFor="knowledge-body" hint="50–20,000 characters of company policy or playbook text. This is a text library; files and external websites are not imported."><Textarea id="knowledge-body" rows={16} maxLength={20000} value={draft.body} onChange={e => set("body", e.target.value)} /></Field>
      </fieldset> : <article className="space-y-4"><p className="text-xs text-zinc-500 dark:text-zinc-400">{KNOWLEDGE_CATEGORIES[draft.category]}{draft.review_due ? ` · Review due ${draft.review_due}` : ""}</p>{row?.review_overdue && <Callout tone="warning">This guidance is past its review date. Confirm it is current with the document owner.</Callout>}<p className="whitespace-pre-wrap break-words text-sm leading-7">{draft.body}</p></article>}
      {canManage && <Button className="mt-4" disabled={!editable || !dirty || draft.title.trim().length < 2 || draft.body.trim().length < 50} loading={busy} onClick={save}>{id ? "Save document draft" : "Create document draft"}</Button>}
    </Panel>
    {row && canManage && <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Publication controls" hint="Publishing applies the saved audience and text together. Draft saves do not change the active guidance.">
        <p className="text-sm">Saved revision {row.revision} · {row.published_revision === null ? "Not published" : `Published version ${row.published_revision}`}</p>
        {row.published && <details className="mt-3 text-sm"><summary>Compare with published guidance</summary><p className="mt-3 font-medium">{row.published.title}</p><p className="mt-2 text-xs">{KNOWLEDGE_AUDIENCES[row.published.audience]}</p><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-3 text-xs dark:bg-white/5">{row.published.body}</pre></details>}
        <div className="mt-4"><Field label="Publication action note" htmlFor="knowledge-note" hint="10–1,000 characters; retained in this document’s history, removed if the document is deleted"><Textarea id="knowledge-note" rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} disabled={busy || company.status !== "active"} /></Field></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!row.archived && <><Button disabled={busy || dirty || !row.has_draft_changes || note.trim().length < 10 || company.status !== "active"} onClick={() => act("publish")}>Publish saved version</Button><Button variant="secondary" disabled={busy || dirty || note.trim().length < 10 || company.status !== "active"} onClick={() => act("archive")}>Archive document</Button></>}
          {row.archived && <Button variant="secondary" disabled={busy || note.trim().length < 10 || company.status !== "active"} onClick={() => act("restore")}>Restore as draft</Button>}
          <Button variant="ghost" disabled={busy || dirty || note.trim().length < 10 || company.status !== "active"} onClick={() => { if (window.confirm("Permanently delete this document and its publication history? This cannot be undone.")) act("delete"); }}>Delete permanently</Button>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Archives and deletions remove the document from future answers. Restoring does not republish it. Previously viewed answers cannot be recalled from a reader's memory or downloaded copies.</p>
      </Panel>
      <Panel title="Publication history" hint="Only owners/admins can inspect historical versions. Readers use the current published audience and guidance.">
        <ol className="space-y-3">{row.history.map(version => <li key={version.revision} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10"><p className="font-medium">Version {version.revision} · {version.actor}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{new Date(version.at).toLocaleString()}</p><Button size="sm" className="mt-2" variant="ghost" onClick={() => void run(async () => { const data = await knowledge.version(company.id, row.id, version.revision); if (live.current) downloadText(`orbit-knowledge-v${version.revision}.json`, JSON.stringify(data, null, 2), "application/json"); })} disabled={busy}>Download version {version.revision}</Button></li>)}</ol>
        {row.events.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold">Publication actions</h3><ol className="mt-3 space-y-3">{row.events.map(event => <li key={`${event.action}-${event.revision}`} className="text-sm"><p className="font-medium">{KNOWLEDGE_ACTION_LABELS[event.action] ?? event.action.replaceAll("_", " ")} · {event.actor} · revision {event.revision}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs">{event.note}</p></li>)}</ol>{row.events_truncated && <p className="mt-2 text-xs">Showing the latest 50 actions.</p>}</div>}
        {!row.history.length && <p className="text-sm">No published versions yet. Saving a draft does not publish it.</p>}
        {row.history_truncated && <p className="mt-3 text-xs">Showing the latest 20 publications. Older publications remain available by their version number.</p>}
      </Panel>
    </div>}
  </div>;
}
