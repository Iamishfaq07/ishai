import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BizKnowledgeContent, BizKnowledgeImportPreview, BizKnowledgeImportReview } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Textarea, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { PageTitle, useCompany } from "./BusinessApp";
import { knowledgeImport } from "./knowledgeImportApi";
import { EMPTY_KNOWLEDGE, KNOWLEDGE_AUDIENCES, KNOWLEDGE_CATEGORIES } from "./knowledgeModel";
import { LoadError, Panel, errorText } from "./ui";

export function KnowledgeImport({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const { company } = useCompany();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BizKnowledgeImportPreview | null>(null);
  const [draft, setDraft] = useState<BizKnowledgeContent>(EMPTY_KNOWLEDGE);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [review, setReview] = useState<{ key: string; result: BizKnowledgeImportReview } | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const live = useRef(true);
  const locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (preview) e.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [preview]);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await fn(); } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const extract = () => void run(async () => {
    if (!file) return;
    const next = await knowledgeImport.preview(company.id, file);
    if (live.current) { setPreview(next); setDraft({ ...EMPTY_KNOWLEDGE, title: next.suggested_title, body: next.text, audience: "coordinators" }); setChecked(false); setReview(null); requestId.current = crypto.randomUUID(); }
  });
  const change = <K extends keyof BizKnowledgeContent>(key: K, value: BizKnowledgeContent[K]) => { setDraft(current => ({ ...current, [key]: value })); setChecked(false); };
  const leave = () => { if (!preview || window.confirm("Leave this import preview? Download your reviewed draft first to keep your edits.")) onBack(); };
  const disabled = busy || company.status !== "active";
  if (!company.permissions.manage_company) return <Callout>Only company owners and admins can import knowledge documents.</Callout>;
  return <div className="space-y-5 [&_h1]:break-words [&_p]:break-words">
    <Button variant="ghost" disabled={busy} onClick={leave}>Back to knowledge library</Button>
    <PageTitle title="Import company knowledge" subtitle="Extract a policy, compare the text with the original, then save an unpublished draft." />
    {error && <LoadError error={error} />}
    {!preview ? <Panel title="Choose a source file" hint="PDF, DOCX, UTF-8 TXT or Markdown · up to 5 MiB · 40 PDF pages · 50–20,000 extracted characters.">
      <Field label="Policy source file" htmlFor="policy-import-file"><Input id="policy-import-file" type="file" accept=".pdf,.docx,.txt,.md" disabled={disabled} onChange={e => { setFile(e.target.files?.[0] ?? null); setError(null); }} /></Field>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Use company policies and playbooks. Text extraction runs locally on the server; AI is optional after preview. Scanned PDFs need OCR before import.</p>
      {file && file.size > 5 * 1024 * 1024 && <Callout tone="error" className="mt-3">This file exceeds 5 MiB. Choose a smaller document.</Callout>}
      <Button className="mt-4" loading={busy} disabled={disabled || !file || file.size > 5 * 1024 * 1024 || file.size === 0} onClick={extract}>Extract policy text</Button>
    </Panel> : <>
      <Panel title="Review extraction" hint={`${preview.source.filename} · ${preview.source.format.toUpperCase()} · ${preview.source.characters.toLocaleString()} extracted characters${preview.source.pages ? ` · ${preview.source.pages} pages` : ""}`}>
        <Callout tone="warning">{preview.limitations}</Callout>
        {preview.duplicates.length > 0 && <Callout className="mt-3" title="This source file was imported before"><p>Review the existing reference before creating another draft. This import will not overwrite it.</p><ul className="mt-2 space-y-2">{preview.duplicates.map(d => <li key={d.id}><Link className={`break-words rounded underline ${focusRing}`} to={`/business/app/${company.id}/knowledge?document=${d.id}`} onClick={e => { if (!window.confirm("Leave this preview to open the existing reference? Download your edits first.")) e.preventDefault(); }}>{d.title} · {d.published ? "Published" : "Draft"}</Link></li>)}</ul></Callout>}
        <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-4"><legend className="sr-only">Review the imported draft</legend>
          <Field label="Imported document title" htmlFor="import-title"><Input id="import-title" maxLength={160} value={draft.title} onChange={e => change("title", e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Imported category" htmlFor="import-category"><Select id="import-category" value={draft.category} onChange={e => change("category", e.target.value as BizKnowledgeContent["category"])}>{Object.entries(KNOWLEDGE_CATEGORIES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field><Field label="Audience after publication" htmlFor="import-audience"><Select id="import-audience" value={draft.audience} onChange={e => change("audience", e.target.value as BizKnowledgeContent["audience"])}>{Object.entries(KNOWLEDGE_AUDIENCES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field><Field label="Imported review date" htmlFor="import-date"><Input id="import-date" type="date" value={draft.review_due} onChange={e => change("review_due", e.target.value)} /></Field></div>
          <Field label="Extracted policy text" htmlFor="import-body" hint="Compare with the original and repair missing context, table columns and reading order before saving."><Textarea id="import-body" rows={16} maxLength={20000} value={draft.body} onChange={e => change("body", e.target.value)} /></Field>
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className={`mt-1 ${focusRing}`} checked={checked} onChange={e => setChecked(e.target.checked)} />I reviewed this text against the original and checked what extraction may omit.</label>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-2"><Button disabled={disabled || !checked || draft.title.trim().length < 2 || draft.body.trim().length < 50} onClick={() => void run(async () => { const doc = await knowledgeImport.commit(company.id, requestId.current, preview.receipt, draft); if (live.current) onCreated(doc.id); })}>Save imported draft</Button><Button variant="secondary" disabled={disabled || draft.body.trim().length < 50} onClick={() => void run(async () => { const key = JSON.stringify(draft); const result = await knowledgeImport.review(company.id, preview.receipt, draft); if (live.current) setReview({ key, result }); })}>Review extraction with AI</Button><Button variant="ghost" onClick={() => downloadText("orbit-policy-import-preview.json", JSON.stringify({ source: preview.source, limitations: preview.limitations, reviewed_draft: draft }, null, 2), "application/json")}>Download import preview</Button></div>
        <Button className="mt-3" variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Discard this preview and choose another source? Download your edits first.")) { setPreview(null); setFile(null); setReview(null); setChecked(false); } }}>Choose another source</Button>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">The original file is not retained. Its name, byte count and fingerprints are recorded privately with the imported draft. Draft text stays unpublished until you publish it in Knowledge Studio. Preview receipts expire after 30 minutes; download your edits before extracting again.</p>
        <details className="mt-3 text-xs"><summary>Source fingerprints</summary><p className="mt-2 break-all">File SHA-256: {preview.source.file_sha256}</p><p className="mt-2 break-all">Extracted text SHA-256: {preview.source.extracted_sha256}</p></details>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Optional AI review sends up to six excerpts from your edited preview to the configured provider. Ten import-review attempts per company per UTC day, including failures. It cannot verify the original file, repair text automatically or publish.</p>
      </Panel>
      {review && review.key === JSON.stringify(draft) && <Panel title={review.result.source === "mock" ? "Test extraction review · no AI model called" : "AI extraction review"}>
        {review.result.excerpts_truncated && <Callout>Middle passages were omitted from this bounded AI review. Check the full preview against the original.</Callout>}
        <ul className="mt-3 space-y-3">{review.result.tips.map(tip => <li key={tip.fact_id} className="min-w-0 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-white/5"><p className="break-words">{tip.suggestion}</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-indigo-400 pl-3 text-xs">{tip.source_quote}</blockquote><p className="mt-3 break-words text-xs">Check: {tip.success_check}</p></li>)}</ul>
      </Panel>}
    </>}
  </div>;
}
