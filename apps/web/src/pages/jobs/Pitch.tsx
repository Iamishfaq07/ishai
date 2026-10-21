import { useState } from "react";
import { Copy, Mic, useCopy } from "@orbit/ui";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

interface Pitch { short: string; standard: string; long: string; hooks: string[]; resume_title: string; words: Record<"short" | "standard" | "long", number> }
const LENGTHS = [["short", "30 seconds"], ["standard", "60 seconds"], ["long", "90 seconds"]] as const;

/**
 * "Tell me about yourself" for one job (POST /v1/jobs/tracker/{id}/pitch): 30, 60 and 90 second versions from the
 * resume's own facts, shaped present, past, future. Nothing is saved.
 */
export function PitchBuilder({ entryId }: { entryId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [length, setLength] = useState<(typeof LENGTHS)[number][0]>("standard");
  const [copied, copy] = useCopy();
  const run = async () => {
    setBusy(true); setError(null);
    try { setPitch(await api.call<Pitch>(`/v1/jobs/tracker/${encodeURIComponent(entryId)}/pitch`, { method: "POST" })); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Your pitch" className="workspace-panel space-y-4 p-4 sm:p-5">
    <div><h3 className="font-semibold">“Tell me about yourself”</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">The first question in most interviews. Get it for this job in three lengths: what you do now, how you got here, and why this role.</p></div>
    <Button loading={busy} variant={pitch ? "secondary" : "primary"} onClick={() => void run()}><Mic className="h-4 w-4" aria-hidden /> {pitch ? "Write it again" : "Write my answer"}</Button>
    <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
    {pitch && <div className="space-y-3">
      <div role="tablist" aria-label="Answer length" className="flex flex-wrap gap-2">{LENGTHS.map(([key, label]) =>
        <Button key={key} role="tab" aria-selected={length === key} size="sm" variant={length === key ? "primary" : "secondary"} onClick={() => setLength(key)}>{label}</Button>)}</div>
      <blockquote className="whitespace-pre-wrap rounded-lg border border-zinc-200 p-4 text-sm leading-relaxed dark:border-white/10">{pitch[length]}</blockquote>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{pitch.words[length]} words · built from “{pitch.resume_title}”{pitch.hooks.length ? ` · leans on: ${pitch.hooks.join("; ")}` : ""}. Replace any [bracketed] prompt with the real detail.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void copy(pitch[length])}><Copy className="h-4 w-4" aria-hidden /> {copied === "copied" ? "Copied" : "Copy"}</Button>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Then say it out loud with Saba below.</span>
      </div>
    </div>}
  </section>;
}
