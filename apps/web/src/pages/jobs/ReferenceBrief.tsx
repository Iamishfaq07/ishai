import { useId, useState } from "react";
import { Copy, Plus, Sparkles, Trash2, cx, focusRing, useCopy } from "@orbit/ui";
import { Button, ErrorNote, Field, Input, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

interface Person { name: string; relationship: string; worked_on: string }
interface Brief { references: { name: string; ask: string; brief: string[] }[]; tips: string[] }

const empty = (): Person => ({ name: "", relationship: "", worked_on: "" });
const MAX = 3;

/**
 * References for this job (POST /v1/jobs/tracker/{id}/reference-brief): up to three people, each with what you
 * worked on together. AI drafts a request to each and a short brief they can read before the call. Nothing is saved
 * or sent; copy and send from your own email or phone.
 */
export function ReferenceBrief({ entryId, company }: { entryId: string; company: string }) {
  const id = useId();
  const [people, setPeople] = useState<Person[]>([empty()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Brief | null>(null);
  const [copied, copy] = useCopy();
  const [copiedKey, setCopiedKey] = useState("");
  const set = (i: number, patch: Partial<Person>) => setPeople((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const ready = people.filter((p) => p.name.trim());
  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.call<Brief>(`/v1/jobs/tracker/${encodeURIComponent(entryId)}/reference-brief`, {
        method: "POST", body: JSON.stringify({ people: ready }) }));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const copyAs = (key: string, text: string) => { setCopiedKey(key); void copy(text); };
  const isCopied = (key: string) => copied === "copied" && copiedKey === key;
  return <section aria-labelledby={`${id}-h`} className="workspace-panel space-y-4 p-4 sm:p-5">
    <div><h3 id={`${id}-h`} className="font-semibold">Prepare your references</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">When {company} asks for references, ask each person first and give them a short brief, so they can speak to what this role needs.</p></div>
    <ol className="space-y-3">{people.map((p, i) => <li key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-white/10">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-n${i}`}><Input id={`${id}-n${i}`} maxLength={80} value={p.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
        <Field label="How you know them" htmlFor={`${id}-r${i}`}><Input id={`${id}-r${i}`} maxLength={120} value={p.relationship} placeholder="For example, my manager at PayNest" onChange={(e) => set(i, { relationship: e.target.value })} /></Field>
      </div>
      <Field label="What they saw you do" htmlFor={`${id}-w${i}`} hint="In your own words. The brief uses only this and your resume.">
        <Textarea id={`${id}-w${i}`} rows={2} maxLength={1200} value={p.worked_on} placeholder="We rebuilt the checkout service together; I led the migration" onChange={(e) => set(i, { worked_on: e.target.value })} />
      </Field>
      {people.length > 1 && <button type="button" className={cx("inline-flex min-h-11 items-center gap-1 rounded text-sm text-zinc-600 hover:text-rose-700 dark:text-zinc-400", focusRing)}
        onClick={() => setPeople((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /> Remove</button>}
    </li>)}</ol>
    <div className="flex flex-wrap gap-2">
      {people.length < MAX && <Button variant="ghost" onClick={() => setPeople((x) => [...x, empty()])}><Plus className="h-4 w-4" aria-hidden /> Add someone</Button>}
      <Button loading={busy} disabled={!ready.length} onClick={() => void run()}><Sparkles className="h-4 w-4" aria-hidden /> Draft requests and briefs</Button>
    </div>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
    {result && <div className="space-y-4 text-sm">
      {result.references.map((r) => <article key={r.name} className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-white/10">
        <h4 className="font-semibold">{r.name}</h4>
        <div><p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">Your request</p>
          <p className="mt-1 whitespace-pre-wrap">{r.ask}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => copyAs(`ask:${r.name}`, r.ask)}><Copy className="h-4 w-4" aria-hidden /> {isCopied(`ask:${r.name}`) ? "Copied" : "Copy request"}</Button></div>
        {r.brief.length > 0 && <div><p className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">Brief for {r.name}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{r.brief.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => copyAs(`brief:${r.name}`, r.brief.map((b) => `- ${b}`).join("\n"))}><Copy className="h-4 w-4" aria-hidden /> {isCopied(`brief:${r.name}`) ? "Copied" : "Copy brief"}</Button></div>}
      </article>)}
      {result.tips.length > 0 && <div><h4 className="font-semibold">Good to know</h4><ul className="mt-1 list-disc space-y-1 pl-5">{result.tips.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Drafted from your notes and resume. Replace any [bracketed] prompt with what really happened. Orbit sends nothing.</p>
    </div>}
  </section>;
}
