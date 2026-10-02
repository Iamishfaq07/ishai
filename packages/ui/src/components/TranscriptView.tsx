import { memo } from "react";
import type { Speaker } from "@orbit/types";
import { useStickyScroll } from "../hooks/useStickyScroll";
import type { TurnView } from "../live/reducer";
import { cx, focusRing } from "./cx";

const SPEAKER_LABEL: Record<Speaker, string> = {
  interviewer: "Interviewer",
  candidate: "You",
  other: "Other",
  unknown: "Speaker",
};

export interface TranscriptViewProps {
  turns: TurnView[];
  /** Optional speaker correction (mixed-channel diarization mistakes). */
  onCorrectSpeaker?: (turnId: string, speaker: Speaker) => void;
}

/** Memoized: it only changes when the turns do, not on every other live update (an answer streaming in). */
export const TranscriptView = memo(function TranscriptView({ turns, onCorrectSpeaker }: TranscriptViewProps) {
  const last = turns[turns.length - 1];
  const { ref, atBottom, jumpToLatest, onScroll } = useStickyScroll<HTMLDivElement>(
    `${turns.length}:${last?.text.length ?? 0}`,
  );

  if (turns.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-zinc-500">The transcript appears here as people speak.</p>;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 py-3"
        role="log"
        aria-label="Live transcript"
        tabIndex={0}
      >
        <ol className="space-y-2.5">
          {turns.map((t) => (
            <li key={t.turn_id} className="text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    "text-xs font-semibold uppercase tracking-wider",
                    t.speaker === "candidate" ? "text-emerald-600 dark:text-emerald-400" : "text-indigo-600 dark:text-indigo-300",
                  )}
                >
                  {SPEAKER_LABEL[t.speaker]}
                </span>
                {onCorrectSpeaker && t.final && (
                  <button
                    type="button"
                    onClick={() => onCorrectSpeaker(t.turn_id, t.speaker === "candidate" ? "interviewer" : "candidate")}
                    className={cx("text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200", focusRing)}
                    title="Wrong speaker? Swap it"
                  >
                    swap
                  </button>
                )}
              </div>
              <p className={cx("leading-snug", t.final ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-500 italic")}>
                {t.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          className={cx(
            "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-white shadow dark:bg-white/90 dark:text-zinc-900",
            focusRing,
          )}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
});
