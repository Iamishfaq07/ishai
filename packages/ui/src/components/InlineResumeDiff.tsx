import { useMemo, useState, type ReactNode } from "react";

export interface DiffToken { text: string; kind: "equal" | "added" | "removed" }
export function wordDiff(before: string, after: string): DiffToken[] {
  const a = before.match(/\S+\s*/g) ?? [];
  const b = after.match(/\S+\s*/g) ?? [];
  if (a.length * b.length > 250_000) return [{ text: before, kind: "removed" }, { text: after, kind: "added" }];
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) {
    rows[i]![j] = a[i] === b[j] ? 1 + rows[i + 1]![j + 1]! : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
  }
  const result: DiffToken[] = [];
  let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ text: a[i++]!, kind: "equal" }); j += 1; }
    else if (j < b.length && (i === a.length || rows[i]![j + 1]! >= rows[i + 1]![j]!)) result.push({ text: b[j++]!, kind: "added" });
    else result.push({ text: a[i++]!, kind: "removed" });
  }
  return result;
}

export function InlineResumeDiff({ before, after, afterContent }: { before: string; after: string; afterContent?: ReactNode }) {
  const [inline, setInline] = useState(false);
  const diff = useMemo(() => wordDiff(before, after), [before, after]);
  return <div className="mt-3 space-y-2">
    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
      <input type="checkbox" checked={inline} onChange={(e) => setInline(e.target.checked)} className="accent-cyan-500" />Inline Diff (Before / After)
    </label>
    {inline ? <p className="rounded-xl border border-cyan-500/15 p-3 text-sm leading-relaxed" aria-label="Inline changes">
      {diff.map((token, i) => token.kind === "removed" ? <del key={i} className="text-rose-700/80 dark:text-rose-300/70">{token.text}</del>
        : token.kind === "added" ? <ins key={i} className="bg-emerald-500/10 text-emerald-800 no-underline dark:text-emerald-200">{token.text}</ins>
          : <span key={i}>{token.text}</span>)}
    </p> : <>
      {before && <p className="rounded-lg bg-rose-500/5 p-2 text-sm text-zinc-500 line-through decoration-rose-400/60">{before}</p>}
      <p key={after} className="resume-update-shimmer rounded-lg bg-emerald-500/10 p-3 text-sm leading-relaxed">{afterContent ?? after}</p>
    </>}
  </div>;
}
