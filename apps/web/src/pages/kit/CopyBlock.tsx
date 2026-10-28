import { useState } from "react";
import { downloadText } from "../../lib/format";
import { Button, Copy, cx, useCopy } from "@orbit/ui";

/** A labelled block of text the candidate copies into their own resume, email or notes. */
export function CopyBlock({ label, text, hint, className }: { label: string; text: string; hint?: string; className?: string }) {
  const [state, copy] = useCopy();
  const [failed, setFailed] = useState(false);
  if (!text) return null;
  return <div className={cx("rounded-xl border border-zinc-200 p-3 text-sm motion-safe:animate-fade-up dark:border-white/10", className)}>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{label}</span>
      <div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={async () => setFailed(!(await copy(text)))}><Copy className="h-3.5 w-3.5" aria-hidden /> {state === "copied" ? "Copied" : failed ? "Retry copy" : "Copy"}</Button>
      <Button size="sm" variant="ghost" onClick={() => downloadText(`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`, text, "text/plain;charset=utf-8")}>Download text</Button></div></div>
    {failed && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">Clipboard access was blocked. Select the text or download it instead.</p>}
    {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    <p className="mt-1 whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">{text}</p>
  </div>;
}
