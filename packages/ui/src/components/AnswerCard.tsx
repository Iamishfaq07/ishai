import { useEffect, useRef, useState } from "react";
import type { CodingLanguage } from "@orbit/types";
import type { KeyPointProgress } from "../live/coverage";
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
  /** Key points ticked off from the candidate's speech ("NEXT" guidance). */
  progress?: KeyPointProgress | null;
  /** Rewrite a coding answer in another language (shows the language picker on the code). */
  onCodeLanguage?: (lang: CodingLanguage) => void;
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

/** Plain-text version of an answer for the clipboard. */
export function answerAsText(a: AnswerView["answer"]): string {
  return [
    a.direct_answer,
    ...a.talking_points.map((p) => `- ${p}`),
    a.code ? `\n${a.code.content}` : "",
    a.example ? `\nExample: ${a.example}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
      title="Copy this answer"
      className={cx(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        copied ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
        focusRing,
      )}
    >
      {copied ? <span className="inline-block animate-pop">Copied ✓</span> : "Copy"}
    </button>
  );
}

const NEXT_PREF = "orbit.adaptiveNext";

/** The answer's key points, ticked off as the candidate says them, with the one to say next highlighted. */
function KeyPoints({ progress, compact }: { progress: KeyPointProgress; compact: boolean }) {
  const [on, setOn] = useState(() => localStorage.getItem(NEXT_PREF) !== "off");
  const toggle = () => {
    localStorage.setItem(NEXT_PREF, on ? "off" : "on");
    setOn(!on);
  };
  const done = progress.next === null;
  return (
    <section aria-label="Key points" className="mt-3 animate-fade-in rounded-lg border border-zinc-200/70 p-2.5 dark:border-zinc-800">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
          {done ? "All points covered" : "Key points"}
        </h3>
        <button type="button" onClick={toggle} className={cx("text-xs text-zinc-500 hover:underline", focusRing)}
                aria-pressed={on} title="Tick points off as you say them">
          {on ? "Hide" : "Show"}
        </button>
      </div>
      {on && (
        <ul className={cx("space-y-1", compact ? "text-[0.9375rem]" : "text-base")}>
          {progress.points.map((p, i) => {
            const isNext = i === progress.next;
            return (
              <li key={i} className={cx("flex items-start gap-2 leading-snug transition-colors",
                p.covered ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-800 dark:text-zinc-200",
                isNext && "font-semibold text-indigo-700 dark:text-indigo-300")}>
                <span aria-hidden="true" className={cx("w-4 flex-none text-center",
                  p.covered ? "text-emerald-500" : isNext ? "text-indigo-500" : "text-zinc-400")}>
                  {p.covered ? "✓" : isNext ? "→" : "○"}
                </span>
                <span>
                  {isNext && <span className="sr-only">Next: </span>}
                  {p.covered && <span className="sr-only">Covered: </span>}
                  {p.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SectionLabel({ children, block = false }: { children: string; block?: boolean }) {
  const cls = "text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400";
  return block ? <h3 className={cx(cls, "mb-1")}>{children}</h3> : <span className={cls}>{children}</span>;
}

export function AnswerCard({
  answer, pinned, onPin, onRetry, compact = false, autoAnswer, progress, onCodeLanguage,
}: AnswerCardProps) {
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
      <div className="flex flex-1 animate-fade-in items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {autoAnswer
          ? "Answers appear here as soon as a question is detected."
          : "Auto answer is off — press Answer when you’re ready."}
      </div>
    );
  }

  const a = answer.answer;
  const thinking = answer.status === "streaming" && !answer.has_content;
  // Coding layout: what to SAY (the talk track) is kept apart from what to CODE.
  const coding = Boolean(a.code || a.problem || a.edge_cases?.length || a.tests?.length);
  const hasComplexity = Boolean(a.time_complexity || a.space_complexity);

  return (
    <section aria-label="Suggested answer" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
          {answer.source === "chat" ? "Reply" : answer.source === "screenshot" ? "Screenshot answer" : "Answer"}
          {answer.reasoning === "deep" && (
            <span className="ml-2 normal-case tracking-normal text-indigo-600 dark:text-indigo-300">in-depth</span>
          )}
        </h2>
        <span className="flex items-center gap-1">
          {answer.has_content && answer.status !== "failed" && <CopyButton text={answerAsText(a)} />}
          <button
            type="button"
            onClick={() => onPin(!pinned)}
            aria-pressed={pinned}
            title={pinned ? "Unpin — follow new questions again" : "Pin — keep this answer on screen"}
            className={cx(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              pinned
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              focusRing,
            )}
          >
            {pinned ? "Pinned" : "Pin"}
          </button>
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2" tabIndex={0}>
        {a.grounding === "example" && answer.has_content && (
          <p
            className="mb-2 flex animate-fade-in items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200"
            title="Parts of this answer describe experience that isn't in your documents"
          >
            <span aria-hidden="true">✎</span>
            <span>Suggested details — check they match your real experience before you say them.</span>
          </p>
        )}
        {thinking && (
          <div className="animate-fade-in space-y-2.5" role="status" aria-label="Thinking">
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-bounce [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-bounce [animation-delay:240ms]" />
              </span>
              Thinking…
            </p>
            <div className="skeleton-line h-3 w-11/12 motion-safe:animate-shimmer" aria-hidden="true" />
            <div className="skeleton-line h-3 w-9/12 motion-safe:animate-shimmer" aria-hidden="true" />
            <div className="skeleton-line h-3 w-10/12 motion-safe:animate-shimmer" aria-hidden="true" />
          </div>
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

        {coding && a.problem && (
          <p className="mb-2 rounded-md bg-zinc-100 px-2.5 py-1.5 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <SectionLabel>Problem</SectionLabel> {a.problem}
          </p>
        )}
        {coding && a.direct_answer && <SectionLabel block>Say</SectionLabel>}

        {a.direct_answer && (
          <div className={cx("space-y-2.5", compact ? "text-[0.9375rem] leading-relaxed" : "text-base leading-relaxed")}>
            {a.direct_answer.split(/\n{2,}/).map((para, i) => (
              // The opening sentence carries the answer, so it reads a touch stronger for a quick glance.
              <p
                key={i}
                className={cx(
                  "animate-fade-up",
                  i === 0 ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-800 dark:text-zinc-200",
                )}
              >
                <Spoken text={para} />
              </p>
            ))}
          </div>
        )}

        {progress && answer.status !== "failed" && <KeyPoints progress={progress} compact={compact} />}

        {a.talking_points.length > 0 && (
          <ul className={cx("mt-2 space-y-1.5", compact ? "text-[0.9375rem]" : "text-base")}>
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
            {coding && <SectionLabel block>Code</SectionLabel>}
            <CodeBlock code={a.code} {...(onCodeLanguage ? { onLanguage: onCodeLanguage } : {})} />
          </div>
        )}

        {coding && (a.edge_cases?.length ?? 0) > 0 && (
          <div className="mt-3">
            <SectionLabel block>Edge cases</SectionLabel>
            <ul className="space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
              {a.edge_cases!.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-zinc-400" aria-hidden="true">•</span>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {coding && (a.tests?.length ?? 0) > 0 && (
          <div className="mt-3">
            <SectionLabel block>Tests</SectionLabel>
            <ul className="space-y-1 font-mono text-[0.8125rem] text-zinc-700 dark:text-zinc-300">
              {a.tests!.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
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
          <p className="mt-2 truncate text-xs text-zinc-400" title={a.context_used.join(" · ")}>
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
