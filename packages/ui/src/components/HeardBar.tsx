import { scriptLang } from "../live/languages";
import { cx } from "./cx";

/** The words of a live transcript that are settled, and the last few the recogniser may still change. */
export function splitSettled(text: string, unstable = 3): { settled: string; tail: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const cut = Math.max(0, words.length - unstable);
  return { settled: words.slice(0, cut).join(" "), tail: words.slice(cut).join(" ") };
}

/**
 * What Orbit is hearing you say right now, while you say it: the settled words in full ink, the newest few (which
 * the recogniser may still revise) dimmer, and a pulsing dot. Shown only while your turn is still in progress.
 */
export function HeardBar({ text, className }: { text: string; className?: string }) {
  const { settled, tail } = splitSettled(text);
  if (!settled && !tail) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "flex items-start gap-2 rounded-xl bg-emerald-500/[0.07] px-3 py-2 text-sm ring-1 ring-emerald-500/20",
        className,
      )}
    >
      <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
      <p lang={scriptLang(text)} className="min-w-0 flex-1 leading-snug">
        <span className="sr-only">Orbit heard: </span>
        <span className="text-zinc-800 dark:text-zinc-100">{settled}</span>
        {settled && tail ? " " : null}
        {/* The newest words: lighter until the recogniser settles them. */}
        <span className="text-zinc-500 dark:text-zinc-400">{tail}</span>
      </p>
    </div>
  );
}
