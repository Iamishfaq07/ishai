import { Button, Copy, cx, useCopy } from "@orbit/ui";

/** A labelled block of text the candidate copies into their own resume, email or notes. */
export function CopyBlock({ label, text, hint, className }: { label: string; text: string; hint?: string; className?: string }) {
  const [state, copy] = useCopy();
  if (!text) return null;
  return <div className={cx("rounded-xl border border-zinc-200 p-3 text-sm motion-safe:animate-fade-up dark:border-white/10", className)}>
    <div className="flex items-center justify-between gap-2"><span className="font-medium">{label}</span>
      <Button size="sm" variant="ghost" onClick={() => void copy(text)}><Copy className="h-3.5 w-3.5" aria-hidden /> {state === "copied" ? "Copied" : "Copy"}</Button></div>
    {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    <p className="mt-1 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{text}</p>
  </div>;
}
