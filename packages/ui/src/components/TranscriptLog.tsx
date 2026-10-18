import { memo, useCallback, useEffect, useMemo, useState, type ReactNode, type UIEvent } from "react";
import type { Speaker } from "@orbit/types";
import { useStickyScroll } from "../hooks/useStickyScroll";
import { ArrowDown } from "../icons";
import { scriptLang } from "../live/languages";
import { cx, focusRing } from "./cx";

/** One line of a transcript: who said it, what, and whether it's still being heard. */
export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  text: string;
  /** False while it's still being heard: drawn lighter, and not announced until it's final. */
  final: boolean;
  /** Seconds into the session, shown beside the speaker's name. */
  at?: number | null;
}

export const SPEAKER_NAMES: Record<Speaker, string> = {
  interviewer: "Interviewer",
  candidate: "You",
  other: "Other",
  unknown: "Speaker",
};

/** At most this many lines are in the page while you follow the bottom; earlier ones load on request. */
export const TRANSCRIPT_CAP = 200;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = `${Math.floor((s % 3600) / 60)}:${String(s % 60).padStart(2, "0")}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(5, "0")}` : mm;
}

/** The transcript as plain text (Copy): "Name (m:ss): what they said", final lines only. */
export function transcriptText(lines: TranscriptLine[], names: Record<Speaker, string> = SPEAKER_NAMES): string {
  return lines
    .filter((l) => l.final && l.text.trim())
    .map((l) => `${names[l.speaker]}${l.at != null ? ` (${clock(l.at)})` : ""}: ${l.text.trim()}`)
    .join("\n");
}

export interface TranscriptGroup {
  key: string;
  speaker: Speaker;
  at: number | null;
  lines: TranscriptLine[];
}

/** Consecutive lines from one speaker under one name and time (a new group after a long gap). */
export function groupLines(lines: TranscriptLine[], gapSeconds = 90): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    const lastAt = last?.lines[last.lines.length - 1]?.at;
    const gap = line.at != null && lastAt != null && line.at - lastAt > gapSeconds;
    if (last && last.speaker === line.speaker && !gap) last.lines.push(line);
    else groups.push({ key: line.id, speaker: line.speaker, at: line.at ?? null, lines: [line] });
  }
  return groups;
}

const TONES = {
  // The live copilot's panel: themed, light and dark.
  panel: {
    theirs: "bg-indigo-50 text-zinc-900 dark:bg-indigo-400/10 dark:text-zinc-100",
    mine: "bg-zinc-100 text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200",
    theirName: "text-indigo-700 dark:text-indigo-300",
    myName: "text-zinc-600 dark:text-zinc-300",
    time: "text-zinc-500",
    interim: "text-zinc-500 dark:text-zinc-400",
    chip: "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900",
    quiet: "text-zinc-500",
  },
  // The video room: always its dark panel. Saba in her accent, you in light ink, as on her visualizer.
  room: {
    theirs: "bg-indigo-400/[0.13] text-zinc-50 ring-1 ring-inset ring-indigo-300/15",
    mine: "bg-white/[0.08] text-zinc-50",
    theirName: "text-indigo-200",
    myName: "text-zinc-300",
    time: "text-zinc-400",
    interim: "text-zinc-400",
    chip: "bg-white text-zinc-900",
    quiet: "text-zinc-400",
  },
} as const;

/**
 * A live transcript as a conversation: the interviewer's lines on the left (with `mark` beside their name), yours on
 * the right, consecutive lines grouped under one name and time, at a readable width. A line still being heard is
 * lighter and settles into the final text in place (the same box, only its colour changes, so nothing jumps).
 *
 * It follows the newest line while you're at the bottom; scroll up to read and it stays where you are, with a "Jump
 * to latest · N new" chip (useStickyScroll). Screen readers hear each line once, when it's final (the log announces
 * additions; a line still being heard is hidden from it). Long sessions keep the newest TRANSCRIPT_CAP lines in the
 * page while you follow, with the earlier ones a button away.
 */
export const TranscriptLog = memo(function TranscriptLog({
  lines,
  tone = "panel",
  names = SPEAKER_NAMES,
  mark,
  onCorrectSpeaker,
  label = "Live transcript",
  empty = "The transcript appears here as people speak.",
  className,
}: {
  lines: TranscriptLine[];
  tone?: keyof typeof TONES;
  names?: Record<Speaker, string>;
  /** A small mark beside the interviewer's name (Saba's voice mark in the video room). */
  mark?: ReactNode;
  /** Swap a line's speaker (mixed-channel diarization mistakes). */
  onCorrectSpeaker?: (lineId: string, speaker: Speaker) => void;
  label?: string;
  empty?: string;
  className?: string;
}) {
  const t = TONES[tone];
  const finals = useMemo(() => lines.reduce((n, l) => n + (l.final ? 1 : 0), 0), [lines]);
  const last = lines[lines.length - 1];
  const { ref, atBottom, unseen, jumpToLatest, onScroll } = useStickyScroll<HTMLDivElement>(
    `${lines.length}:${last?.text.length ?? 0}:${last?.final ? 1 : 0}`,
    { count: finals },
  );
  // While you follow the bottom, only the newest lines stay in the page; reading back, nothing is taken away.
  const [start, setStart] = useState(0);
  useEffect(() => {
    if (start > lines.length) setStart(0);
    else if (atBottom && lines.length - start > TRANSCRIPT_CAP + 40) setStart(lines.length - TRANSCRIPT_CAP);
  }, [atBottom, lines.length, start]);
  const groups = useMemo(() => groupLines(start > 0 ? lines.slice(start) : lines), [lines, start]);
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      // The top edge fades once there's more above.
      e.currentTarget.toggleAttribute("data-faded", e.currentTarget.scrollTop > 2);
      onScroll();
    },
    [onScroll],
  );

  return (
    <div className={cx("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={ref}
        onScroll={handleScroll}
        className={cx("transcript-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4", tone === "room" && "transcript-room", focusRing)}
        role="log"
        aria-label={label}
        tabIndex={0}
      >
        {lines.length === 0 ? (
          <p className={cx("px-2 py-6 text-center text-sm", t.quiet)}>{empty}</p>
        ) : (
          <>
            {start > 0 && (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setStart(Math.max(0, start - TRANSCRIPT_CAP))}
                  className={cx("rounded-full px-3 py-1 text-xs font-medium underline-offset-2 hover:underline", t.quiet, focusRing)}
                >
                  Show {Math.min(start, TRANSCRIPT_CAP)} earlier lines
                </button>
              </div>
            )}
            <ol className="space-y-3">
              {groups.map((g) => {
                const mine = g.speaker === "candidate";
                return (
                  <li key={g.key} className={cx("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                    <p className={cx("flex items-center gap-1.5 px-1 text-xs", mine && "flex-row-reverse")}>
                      {!mine && g.speaker === "interviewer" && mark}
                      <span className={cx("font-medium", mine ? t.myName : t.theirName)}>{names[g.speaker]}</span>
                      {g.at != null && <span className={cx("tabular-nums", t.time)}>{clock(g.at)}</span>}
                    </p>
                    {g.lines.map((l, i) => (
                      <div key={l.id} className={cx("group/line flex max-w-full items-end gap-1.5", mine && "flex-row-reverse")}>
                        <p
                          lang={scriptLang(l.text)}
                          className={cx(
                            "appear max-w-[min(100%,34rem)] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
                            mine ? t.mine : t.theirs,
                            i === 0 && (mine ? "rounded-tr-md" : "rounded-tl-md"),
                          )}
                        >
                          {l.final ? (
                            <span key="final">{l.text}</span>
                          ) : (
                            // Keyed apart from the final text, so the log announces the line once, when it's final.
                            <span key="heard" aria-hidden="true" className={cx("transition-colors duration-quick", t.interim)}>
                              {l.text}
                              <span className="interim-caret mood-dot-busy" />
                            </span>
                          )}
                        </p>
                        {onCorrectSpeaker && l.final && (
                          <button
                            type="button"
                            onClick={() => onCorrectSpeaker(l.id, l.speaker === "candidate" ? "interviewer" : "candidate")}
                            // Where there's hover, only on the line under the pointer (or when tabbed to), so a long
                            // transcript doesn't repeat "swap" on every line; on touch screens it stays visible.
                            className={cx(
                              "mb-1 shrink-0 text-xs text-zinc-400 hover:text-zinc-700 group-hover/line:opacity-100 focus-visible:opacity-100 dark:hover:text-zinc-200 [@media(hover:hover)]:opacity-0",
                              focusRing,
                            )}
                            title="Wrong speaker? Swap it"
                          >
                            swap
                          </button>
                        )}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
      {!atBottom && lines.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label={unseen ? `Jump to latest, ${unseen} new line${unseen === 1 ? "" : "s"}` : "Jump to latest"}
            className={cx(
              "pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-popover transition-transform duration-quick animate-rise motion-ok:active:scale-[0.96]",
              t.chip,
              focusRing,
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            Jump to latest
            {unseen > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[11px] tabular-nums text-white">{unseen} new</span>}
          </button>
        </div>
      )}
    </div>
  );
});
