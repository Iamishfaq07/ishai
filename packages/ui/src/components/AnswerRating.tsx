import { useCallback, useState } from "react";
import type { AnswerFeedback, AnswerFeedbackReason, AnswerRating } from "@orbit/types";
import type { ApiClient } from "../api/client";
import { ThumbsDown, ThumbsUp, X } from "../icons";
import { cx, focusRing } from "./cx";

export const FEEDBACK_REASONS: Array<{ key: AnswerFeedbackReason; label: string }> = [
  { key: "too_long", label: "Too long" },
  { key: "too_generic", label: "Too generic" },
  { key: "inaccurate", label: "Not accurate" },
  { key: "off_topic", label: "Missed the question" },
  { key: "too_formal", label: "Too formal" },
  // A report, not a style (Microsoft Store policy 11.16): the admin's feedback report counts it.
  { key: "inappropriate", label: "Inappropriate or harmful" },
];

export interface AnswerRatings {
  get: (answerId: string) => AnswerFeedback | null;
  rate: (answerId: string, rating: AnswerRating | null, reason?: AnswerFeedbackReason | null) => void;
}

/**
 * Ratings for one session's answers: optimistic (the buttons answer instantly), rolled back if the save fails.
 * `initial` seeds it from a session's stored ratings (the review page).
 */
export function useAnswerRatings(
  api: Pick<ApiClient, "rateAnswer">,
  sessionId: string,
  initial?: Record<string, AnswerFeedback | null | undefined>,
): AnswerRatings {
  const [map, setMap] = useState<Record<string, AnswerFeedback | null>>(() =>
    Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? null])),
  );
  const get = useCallback((id: string) => map[id] ?? null, [map]);
  const rate = useCallback(
    (id: string, rating: AnswerRating | null, reason: AnswerFeedbackReason | null = null) => {
      let previous: AnswerFeedback | null = null;
      setMap((m) => {
        previous = m[id] ?? null;
        return { ...m, [id]: rating ? { rating, reason: rating === "down" ? reason : null } : null };
      });
      api.rateAnswer(sessionId, id, rating, reason).catch(() => setMap((m) => ({ ...m, [id]: previous })));
    },
    [api, sessionId],
  );
  return { get, rate };
}

const btn = (on: boolean, tone: "up" | "down") =>
  cx(
    "inline-flex items-center rounded-md p-1 transition-colors",
    on
      ? tone === "up"
        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
      : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
    focusRing,
  );

/**
 * 👍/👎 for one answer. A 👎 asks why in a small popover (optional, one tap); Orbit adapts later answers to the
 * reasons you keep giving. Used on the live answer card and in the session review.
 */
export function AnswerRatingButtons({
  value,
  onRate,
}: {
  value: AnswerFeedback | null;
  onRate: (rating: AnswerRating | null, reason?: AnswerFeedbackReason | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  const up = value?.rating === "up";
  const down = value?.rating === "down";
  const reasons = (
    <span
      role="group"
      aria-label="What was off?"
      className="glass-panel absolute right-0 top-full z-30 mt-1.5 flex w-64 !bg-white dark:!bg-zinc-900 animate-fade-up flex-wrap items-center gap-1 rounded-xl p-2.5 text-left shadow-menu"
    >
      <span className="basis-full pb-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        What was off? <span className="font-normal text-zinc-500">Orbit adjusts to what you keep telling it.</span>
      </span>
      {FEEDBACK_REASONS.map((r) => (
        <button
          key={r.key}
          type="button"
          aria-pressed={value?.reason === r.key}
          onClick={() => {
            onRate("down", r.key);
            setAsking(false);
          }}
          className={cx(
            "rounded-full px-2 py-0.5 text-xs ring-1 transition-colors",
            value?.reason === r.key
              ? "bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-300"
              : "text-zinc-600 ring-zinc-200 hover:bg-zinc-500/5 dark:text-zinc-300 dark:ring-white/10",
            focusRing,
          )}
        >
          {r.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setAsking(false)}
        aria-label="Skip"
        className={cx("ml-auto rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200", focusRing)}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
  return (
    <span className="relative inline-flex items-center gap-0.5">
        <button
          type="button"
          aria-pressed={up}
          title={up ? "Remove rating" : "Good answer"}
          aria-label="Good answer"
          onClick={() => {
            onRate(up ? null : "up");
            setAsking(false);
          }}
          className={btn(up, "up")}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-pressed={down}
          title={down ? "Remove rating" : "Not a good answer"}
          aria-label="Not a good answer"
          onClick={() => {
            onRate(down ? null : "down");
            setAsking(!down);
          }}
          className={btn(down, "down")}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      {asking && reasons}
    </span>
  );
}
