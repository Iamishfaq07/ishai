import { useId, useState } from "react";
import type { JobTrackerEntry } from "@orbit/types";
import { Copy, cx, focusRing, useCopy } from "@orbit/ui";
import { Button, ErrorNote, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

const OPEN = new Set(["applied", "interviewing", "offer"]);

function draft(entry: JobTrackerEntry): string {
  const stage = entry.status === "offer" ? "your offer" : entry.status === "interviewing" ? "the interviews so far" : "considering my application";
  return [`Hi,`, "",
    `Thank you for ${stage} for the ${entry.title} role at ${entry.company}. I've accepted another position, so I'd like to withdraw from the process.`, "",
    `I appreciated the time your team gave me and would be glad to stay in touch for the future.`, "",
    `Best regards`].join("\n");
}

/**
 * Withdrawing from one open application (Today's "Wrap up your search" links here with ?withdraw=1): a short,
 * courteous note to edit and send from your own email, then a button to mark the job withdrawn. A tracker change
 * never notifies the employer; Orbit sends nothing.
 */
export function WithdrawNote({ entry, open, onDone }: { entry: JobTrackerEntry; open: boolean; onDone: () => void }) {
  const id = useId();
  const [text, setText] = useState(() => draft(entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();
  if (!OPEN.has(entry.status)) return null;
  const mark = async () => {
    setBusy(true); setError(null);
    try { await api.updateTrackedJob(entry.id, { status: "withdrawn" }); onDone(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <details open={open} className="workspace-panel p-4 sm:p-5">
    <summary className={cx("cursor-pointer rounded font-semibold", focusRing)}>Withdrawing from this job?</summary>
    <div className="mt-3 space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">A short note lets {entry.company} move on and remember you well. Edit it, send it from your own email, then mark the job withdrawn here.</p>
      <label htmlFor={`${id}-note`} className="sr-only">Withdrawal note</label>
      <Textarea id={`${id}-note`} rows={9} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy(text)}><Copy className="h-4 w-4" aria-hidden /> {copied === "copied" ? "Copied" : "Copy note"}</Button>
        <Button variant="ghost" loading={busy} onClick={() => void mark()}>I've sent it: mark withdrawn</Button>
      </div>
      <div aria-live="polite">{error && <ErrorNote>{error}</ErrorNote>}</div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Marking it withdrawn only updates your tracker. If you applied through a portal, withdraw there too.</p>
    </div>
  </details>;
}
