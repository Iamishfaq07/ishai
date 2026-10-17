import { cx } from "./cx";
import { WorkingScene, type WorkingKind } from "./scenes/WorkingScene";

/**
 * A wait of more than a couple of seconds, illustrated: the AI-working scene above what's happening ("Reading your
 * resume…"), announced politely, in place of a big spinner. `kind`: `reading` a resume, profile or job post, `writing`
 * a letter, a message or a review, `matching` a resume against jobs. `compact` sets them side by side, for a panel.
 * The scene loops calmly at Full motion and holds still at Gentle and Off.
 */
export function WorkingState({ label, kind = "reading", compact = false, className }: { label: string; kind?: WorkingKind; compact?: boolean; className?: string }) {
  return (
    <div
      role="status"
      className={cx(
        "flex items-center text-sm text-zinc-500 dark:text-zinc-400",
        compact ? "gap-3 py-1" : "w-full flex-col justify-center gap-2 py-8 text-center",
        className,
      )}
    >
      <WorkingScene kind={kind} className={compact ? "w-24 shrink-0" : "w-36 sm:w-40"} />
      <span>{label.replace(/[.…]+$/, "")}…</span>
    </div>
  );
}
