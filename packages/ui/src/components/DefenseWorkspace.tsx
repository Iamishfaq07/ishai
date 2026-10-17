import { useState } from "react";
import type { DefenseCard } from "@orbit/types";
import { Button, ErrorNote, Textarea } from "./ui";
import { focusRing } from "./cx";
import { Dropzone } from "./Dropzone";

interface Client {
  defenseNotes(id: string, notes: string): Promise<DefenseCard>;
  defenseFile(id: string, file: Blob, name: string, notes?: string): Promise<DefenseCard>;
}
export function DefenseWorkspace({ api, sessionId, capture }: { api: Client; sessionId: string; capture?: () => Promise<Blob> }) {
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [card, setCard] = useState<DefenseCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const critique = async (screen = false) => {
    setBusy(true); setError(null);
    try {
      const image = screen && capture ? await capture() : file;
      if (image && image.size > 5 * 1024 * 1024) throw new Error("Upload a file smaller than 5 MB.");
      setCard(image ? await api.defenseFile(sessionId, image, image instanceof File ? image.name : "architecture.png", notes)
        : await api.defenseNotes(sessionId, notes));
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't critique this architecture."); }
    finally { setBusy(false); }
  };
  return <details className="max-h-[min(60vh,36rem)] overflow-auto border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
    <summary className={`cursor-pointer font-display text-sm font-semibold ${focusRing}`}>Critique architecture / diagram</summary>
    <div className="mt-4 space-y-3">
      <p className="text-xs text-zinc-500">Get a Defense Card before you explain the design. Uses one analysis from your screenshot allowance; failed assessments are refunded.</p>
      <label className="block text-sm">Architecture notes<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={file ? 5000 : 30_000}
        placeholder="Describe the services, data flow, traffic assumptions and failure handling." /></label>
      <Dropzone busy={busy} file={file} hint="Diagram or code file: PNG, JPEG, PDF, DOCX, or text; max 5 MB"
        accept=".png,.jpg,.jpeg,.pdf,.docx,.txt,.md,.py,.js,.ts,.tsx,.jsx,.rs,.go,.java,.c,.cpp,.h,.sql,.sh,.yaml,.yml,.json"
        onFile={(next) => { setFile(next); setError(null); }} />
      <div className="flex flex-wrap gap-2"><Button disabled={busy || (!file && notes.trim().length < 20)} onClick={() => void critique()}>{busy ? "Reviewing…" : "Build Defense Card"}</Button>
        {capture && <Button variant="secondary" disabled={busy} onClick={() => void critique(true)}>Capture diagram</Button>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {card && <section aria-label="Architecture Defense Card" className="space-y-2 pt-2">
        <h3 className="font-display font-semibold">Defense Card</h3>
        {([['Single points of failure', card.spofs], ['Scaling & data flow bottlenecks', card.bottlenecks], ['Trade-offs to mention proactively', card.trade_offs]] as const).map(([title, lines]) =>
          <details key={title} className="rounded-xl border border-zinc-500/15 p-3" open><summary className="cursor-pointer text-sm font-medium">{title}</summary>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul></details>)}
        <details className="rounded-xl border border-zinc-500/15 p-3" open><summary className="cursor-pointer text-sm font-medium">Three likely follow-up questions</summary>
          <ol className="mt-3 space-y-3 text-sm">{card.follow_ups.map((item, i) => <li key={i}><p className="font-medium">{i + 1}. {item.question}</p><p className="mt-1 leading-relaxed text-zinc-500">{item.answer}</p></li>)}</ol>
        </details>
      </section>}
    </div>
  </details>;
}
