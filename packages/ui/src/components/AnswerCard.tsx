import { useEffect, useRef, useState } from "react";
import { splitPlaceholders } from "../live/placeholders";
import type { AnswerView } from "../live/reducer";
import { CodeBlock } from "./CodeBlock";
import { cx, focusRing } from "./cx";

export interface AnswerCardProps {
  answer: AnswerView | null;
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  onRetry: () => void;
  compact?: boolean;
  /** Whether the session is waiting on a question (drives the empty state copy). */
  autoAnswer: boolean;
}

/** Answer text with "[fill in]" prompts rendered as distinct chips so they're never read out verbatim. */
function Spoken({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span
            key={i}
            title="Fill this in from your own experience"
            className="rounded bg-amber-500/15 px-1 text-amber-800 underline decoration-amber-500/60 decoration-dashed underline-offset-2 dark:text-amber-200"
          >
            <span className="sr-only">Fill in: </span>
            {part.text}
          </span>
        ),
      )}
    </>
  );
}

export function AnswerCard({ answer, pinned, onPin, onRetry, compact = false, autoAnswer }: AnswerCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showExample, setShowExample] = useState(false);
  const answerId = answer?.answer_id ?? null;

  // Only a *new* answer resets scroll — streaming chunks never move the reader.
  useEffect(() => {
    setShowExample(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [answerId]);

  if (!answer) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {autoAnswer
          ? "Answers appear here as soon as a question is detected."
          : "Auto answer is off — press Answer when you’re ready."}
      </div>
    );
  }

  const a = answer.answer;
  const thinking = answer.status === "streaming" && !answer.has_content;
  const hasComplexity = Boolean(a.time_complexity || a.space_complexity);

  return (
    <section aria-label="Suggested answer" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
          {answer.source === "chat" ? "Reply" : "Answer"}
          {answer.reasoning === "deep" && (
            <span className="ml-2 normal-case tracking-normal text-indigo-600 dark:text-indigo-300">deep reasoning</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => onPin(!pinned)}
          aria-pressed={pinned}
          title={pinned ? "Unpin — follow new questions again" : "Pin — keep this answer on screen"}
          className={cx(
            "rounded-md px-2 py-0.5 text-[11px] font-medium",
            pinned
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
            focusRing,
          )}
        >
          {pinned ? "Pinned" : "Pin"}
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2" tabIndex={0}>
        {thinking && (
          <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-bounce" />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-bounce [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-bounce [animation-delay:240ms]" />
            </span>
            Thinking…
          </p>
        )}

        {answer.status === "failed" && (
          <div className="rounded-lg border border-rose-300/60 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <p>{answer.error?.message ?? "The answer couldn’t be generated."}</p>
            {answer.error?.retryable !== false && (
              <button type="button" onClick={onRetry} className={cx("mt-2 font-medium underline", focusRing)}>
                Try again
              </button>
            )}
          </div>
        )}

        {a.direct_answer && (
          <p className={cx("font-medium text-zinc-900 dark:text-zinc-50", compact ? "text-sm" : "text-[15px] leading-snug")}>
            <Spoken text={a.direct_answer} />
          </p>
        )}

        {a.talking_points.length > 0 && (
          <ul className={cx("mt-2 space-y-1.5", compact ? "text-sm" : "text-[15px]")}>
            {a.talking_points.map((point, i) => (
              <li key={i} className="flex gap-2 leading-snug text-zinc-800 dark:text-zinc-200">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                <span>
                  <Spoken text={point} />
                </span>
              </li>
            ))}
          </ul>
        )}

        {hasComplexity && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {a.time_complexity && (
              <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono dark:bg-zinc-800">Time {a.time_complexity}</span>
            )}
            {a.space_complexity && (
              <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono dark:bg-zinc-800">Space {a.space_complexity}</span>
            )}
          </div>
        )}

        {a.code && (
          <div className="mt-3">
            <CodeBlock code={a.code} />
          </div>
        )}

        {a.example && (
          <div className="mt-3">
            {showExample ? (
              <p className="rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <Spoken text={a.example} />
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setShowExample(true)}
                className={cx("text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}
              >
                {a.context_used.length > 0 ? "Example from your background available" : "Show example"}
              </button>
            )}
          </div>
        )}

        {a.follow_up && answer.status === "complete" && (
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Likely follow-up:</span> {a.follow_up}
          </p>
        )}

        {!compact && a.context_used.length > 0 && answer.status === "complete" && (
          <p className="mt-2 truncate text-[11px] text-zinc-400" title={a.context_used.join(" · ")}>
            Grounded in: {a.context_used.join(" · ")}
          </p>
        )}

        {answer.status === "cancelled" && (
          <p className="mt-3 text-xs text-zinc-400">Stopped — a newer question took over.</p>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {answer.status === "complete" ? `Answer ready: ${a.direct_answer || a.talking_points[0] || ""}` : ""}
      </span>
    </section>
  );
}
