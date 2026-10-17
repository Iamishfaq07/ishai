import { memo, useEffect, useRef, useState } from "react";
import type {
  AnswerFeedback,
  AnswerFeedbackReason,
  AnswerRating as AnswerRatingValue,
  CodingLanguage,
} from "@orbit/types";
import { SIZE_HINTS } from "../live/answerSize";
import type { KeyPointProgress } from "../live/coverage";
import { StreamingText } from "./StreamingText";
import { splitPlaceholders } from "../live/placeholders";
import { READ_ALOUD_RATES, speechText } from "../live/readAloud";
import type { AnswerView } from "../live/reducer";
import type { ReadAloud } from "../live/useReadAloud";
import { AnswerRatingButtons } from "./AnswerRating";
import { CodeBlock } from "./CodeBlock";
import { SpokenWalkthrough } from "./SpokenWalkthrough";
import { cx, focusRing } from "./cx";
import { Orb } from "./Orb";
import { ArrowRight, Check, Circle, Feather, Maximize2, Minimize2, Pause, PenLine, Play, Square, Volume2 } from "../icons";
import { safeLocal } from "../storage";

export interface AnswerCardProps {
  loadWalkthrough?: (answerId: string) => Promise<NonNullable<import("@orbit/types").LiveAnswer["walkthrough"]>>;
  answer: AnswerView | null;
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  /** Ask again after a failure; left out when nothing can be (a chat reply whose message isn't known, say). */
  onRetry?: () => void;
  /** Stop writing this answer, keeping what's there (shown while it streams). */
  onStop?: () => void;
  compact?: boolean;
  /** Whether the session is waiting on a question (drives the empty state copy). */
  autoAnswer: boolean;
  /** Key points ticked off from the candidate's speech ("NEXT" guidance). */
  progress?: KeyPointProgress | null;
  /** Manually tick / untick a key point. */
  onTogglePoint?: (index: number) => void;
  /** Read the answer aloud (user-triggered; capture is muted while it plays). */
  reader?: ReadAloud;
  /** Rewrite a coding answer in another language (shows the language picker on the code). */
  onCodeLanguage?: (lang: CodingLanguage) => void;
  /** Re-answer the same question shorter / longer (null = already at that end of the scale). */
  onShorter?: (() => void) | null;
  onLonger?: (() => void) | null;
  /** Re-answer the same question in plainer words (null = not available for this answer). */
  onSimpler?: (() => void) | null;
  /** Phone companion: a mirror of the session, so nothing here can act on it (no "Try again"). */
  readOnly?: boolean;
  /** 👍/👎 for this answer (shown once it's complete). */
  rating?: AnswerFeedback | null;
  onRate?: (rating: AnswerRatingValue | null, reason?: AnswerFeedbackReason | null) => void;
}

/** Answer text with "[fill in]" prompts rendered as distinct chips so they're never read out verbatim. */
function Spoken({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <>
      {splitPlaceholders(text).map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>
            <StreamingText text={part.text} live={live} />
          </span>
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
    a.design?.length ? `\n${a.design.map((d) => `${d.title}: ${d.text}`).join("\n")}` : "",
    a.debug?.root_cause ? `\nRoot cause: ${a.debug.root_cause}` : "",
    a.debug?.fix ? `Minimal fix: ${a.debug.fix}` : "",
    a.debug?.why ? `Why it failed: ${a.debug.why}` : "",
    a.debug?.diff ? `\n${a.debug.diff}` : "",
    a.code ? `\n${a.code.content}` : "",
    a.example ? `\nExample: ${a.example}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function CopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 1500);
    return () => clearTimeout(t);
  }, [result]);
  return (
    <button
      type="button"
      onClick={() => {
        // The clipboard can be missing (insecure page) or refused (no permission): say so instead of doing nothing.
        if (!navigator.clipboard) return setResult("failed");
        navigator.clipboard.writeText(text).then(
          () => setResult("copied"),
          () => setResult("failed"),
        );
      }}
      title="Copy this answer"
      className={cx(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        result === "copied"
          ? "text-emerald-600 dark:text-emerald-400"
          : result === "failed"
            ? "text-rose-600 dark:text-rose-400"
            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
        focusRing,
      )}
    >
      {result === "copied" ? (
        <span className="inline-flex animate-pop items-center gap-1">Copied <Check className="h-3.5 w-3.5" /></span>
      ) : result === "failed" ? (
        "Couldn’t copy"
      ) : (
        "Copy"
      )}
    </button>
  );
}

const NEXT_PREF = "orbit.adaptiveNext";

/** The answer's key points, ticked off as the candidate says them, with the one to say next highlighted. */
function KeyPoints({ progress, compact, onToggle }: {
  progress: KeyPointProgress;
  compact: boolean;
  onToggle?: (index: number) => void;
}) {
  const [on, setOn] = useState(() => safeLocal.getItem(NEXT_PREF) !== "off");
  const toggle = () => {
    safeLocal.setItem(NEXT_PREF, on ? "off" : "on");
    setOn(!on);
  };
  const done = progress.next === null;
  return (
    <section aria-label="Key points" className="mt-3 animate-fade-in rounded-lg border border-zinc-200/70 p-2.5 dark:border-zinc-800">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          {done ? "All points covered" : "Key points"}
        </h3>
        <button type="button" onClick={toggle} className={cx("text-xs text-zinc-500 hover:underline", focusRing)}
                aria-pressed={on} title="Points tick off as you say them. Click one to tick or untick it yourself">
          {on ? "Hide" : "Show"}
        </button>
      </div>
      {on && (
        <ul className={cx("space-y-1", compact ? "text-[0.9375rem]" : "text-base")}>
          {progress.points.map((p, i) => {
            const isNext = i === progress.next;
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!onToggle}
                  onClick={() => onToggle?.(i)}
                  aria-pressed={p.covered}
                  title={p.covered ? "Mark as not said yet" : "Mark as said"}
                  className={cx("flex w-full items-start gap-2 rounded text-left leading-snug transition-colors",
                    onToggle && "hover:bg-zinc-100 dark:hover:bg-zinc-800/60", focusRing,
                    p.covered ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-800 dark:text-zinc-200",
                    isNext && "font-semibold text-indigo-700 dark:text-indigo-300")}>
                  <span aria-hidden="true" className={cx("mt-0.5 flex w-4 flex-none justify-center",
                    p.covered ? "text-emerald-500" : isNext ? "text-indigo-500" : "text-zinc-400")}>
                    {p.covered ? <Check className="h-3.5 w-3.5" /> : isNext ? <ArrowRight className="h-3.5 w-3.5" /> : <Circle className="mt-0.5 h-2.5 w-2.5" />}
                  </span>
                  <span>
                    {isNext && <span className="sr-only">Next: </span>}
                    {p.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const iconBtn = (active = false) =>
  cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
    active ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
    focusRing);

/** Pause / stop / speed / voice for the answer being read aloud. */
function ReadAloudControls({ reader }: { reader: ReadAloud }) {
  const select = cx("rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900", focusRing);
  return (
    <div role="group" aria-label="Read aloud" className="mx-4 mt-2 flex animate-fade-in flex-wrap items-center gap-1.5 rounded-lg bg-indigo-500/5 px-2 py-1.5">
      {reader.status === "paused" ? (
        <button type="button" onClick={reader.resume} className={iconBtn()}>
          <Play className="h-3.5 w-3.5" /> Resume
        </button>
      ) : (
        <button type="button" onClick={reader.pause} className={iconBtn()}>
          <Pause className="h-3.5 w-3.5" /> Pause
        </button>
      )}
      <button type="button" onClick={reader.stop} className={iconBtn()}>
        <Square className="h-3 w-3" /> Stop
      </button>
      <select aria-label="Speed" value={reader.rate} onChange={(e) => reader.setRate(Number(e.target.value))} className={select}>
        {READ_ALOUD_RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
      {reader.voices.length > 1 && (
        <select aria-label="Voice" value={reader.voiceId ?? ""} onChange={(e) => reader.setVoiceId(e.target.value)}
                className={cx(select, "max-w-[10rem] truncate")}>
          {reader.voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name.replace(/^Microsoft /, "")}
            </option>
          ))}
        </select>
      )}
      <span role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
        {reader.status === "paused" ? "Paused. Listening again" : "Playing on your speakers. Orbit isn’t listening"}
      </span>
    </div>
  );
}

/** A toolbar button's text: icon-only in the compact overlay (the words stay for screen readers). */
/** A toolbar button's word: always in the compact overlay and on phones just the icon (the word stays for screen
 * readers, and the button's title shows it), the word beside the icon from 640 px up. */
function Label({ compact, children }: { compact: boolean; children: string }) {
  return <span className={compact ? "sr-only" : "sr-only sm:not-sr-only"}>{children}</span>;
}

function SectionLabel({ children, block = false }: { children: string; block?: boolean }) {
  const cls = "text-xs font-semibold text-zinc-500 dark:text-zinc-400";
  return block ? <h3 className={cx(cls, "mb-1")}>{children}</h3> : <span className={cls}>{children}</span>;
}

/**
 * Memoized: the live panel re-renders on every transcript update, and re-rendering the answer (code highlighting
 * included) each time is wasted work while it hasn't changed. Callers pass stable callbacks to keep that working.
 */
export const AnswerCard = memo(function AnswerCard({
  answer, pinned, onPin, onRetry, onStop, compact = false, autoAnswer, progress, onTogglePoint, reader, onCodeLanguage,
  onShorter, onLonger, onSimpler, readOnly = false, rating = null, onRate, loadWalkthrough,
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
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-5 px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {/* Orbit listening for the next question: the dotted listening orb (a calm breath when auto answer is off). */}
        <span className="relative flex items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 -m-4 rounded-full bg-indigo-500/[0.07] ring-1 ring-indigo-500/15 dark:bg-indigo-400/[0.06]" />
          <Orb state={autoAnswer ? "listening" : "breathing"} size={compact ? 20 : 64} className="relative" />
        </span>
        <span className="max-w-xs">
          {autoAnswer
            ? "Answers appear here as soon as a question is detected."
            : "Auto answer is off — press Answer when you’re ready."}
        </span>
      </div>
    );
  }

  const a = answer.answer;
  const thinking = answer.status === "streaming" && !answer.has_content;
  // Coding layout: what to SAY (the talk track) is kept apart from what to CODE.
  const coding = Boolean(a.code || a.problem || a.edge_cases?.length || a.tests?.length || a.trace?.steps.length);
  const design = a.design ?? [];
  const debug = a.debug ?? null;
  const structured = coding || design.length > 0 || Boolean(debug);
  const hasComplexity = Boolean(a.time_complexity || a.space_complexity);
  const reading = Boolean(reader && reader.status !== "idle" && reader.key === answer.answer_id);
  // How much to say, when the length is automatic: spoken answers only (chat replies and screenshots aren't said).
  const size = answer.size && (answer.source === "auto" || answer.source === "manual") ? SIZE_HINTS[answer.size] : null;
  const terms = a.terms ?? [];

  return (
    <section aria-label="Suggested answer" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 pt-3">
        <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          {answer.source === "chat" ? "Reply" : answer.source === "screenshot" ? "Screenshot answer" : "Answer"}
          {answer.reasoning === "deep" && (
            <span className="ml-2 normal-case tracking-normal text-indigo-600 dark:text-indigo-300">in-depth</span>
          )}
          {size && (
            <span
              title={size.hint}
              className="ml-2 rounded-full bg-zinc-100 px-1.5 py-px font-medium normal-case tracking-normal text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300"
            >
              {size.label}
            </span>
          )}
        </h2>
        <span className="flex flex-wrap items-center justify-end gap-1">
          {onStop && !readOnly && answer.status === "streaming" && (
            <button
              type="button"
              onClick={onStop}
              title="Stop writing this answer (keeps what's here)"
              className={cx(iconBtn(false), "text-rose-600 dark:text-rose-400")}
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          {reader?.supported && answer.status === "complete" && answer.has_content && speechText(a) && (
            <button
              type="button"
              onClick={() => (reading ? reader.stop() : reader.play(answer.answer_id, speechText(a)))}
              aria-pressed={reading}
              title={reading ? "Stop reading" : "Read this answer aloud on your speakers (Orbit stops listening while it plays)"}
              className={iconBtn(reading)}
            >
              <Volume2 className="h-3.5 w-3.5" /> <Label compact={compact}>{reading ? "Reading" : "Read aloud"}</Label>
            </button>
          )}
          {answer.status === "complete" && answer.has_content && (onShorter !== undefined || onLonger !== undefined) && (
            <>
              <button
                type="button"
                onClick={onShorter ?? undefined}
                disabled={!onShorter}
                title={onShorter ? "Answer this question again, shorter" : "Already the shortest length"}
                className={cx(iconBtn(false), "disabled:opacity-40")}
              >
                <Minimize2 className="h-3.5 w-3.5" /> <Label compact={compact}>Shorter</Label>
              </button>
              <button
                type="button"
                onClick={onLonger ?? undefined}
                disabled={!onLonger}
                title={onLonger ? "Answer this question again, in more depth" : "Already the longest length"}
                className={cx(iconBtn(false), "disabled:opacity-40")}
              >
                <Maximize2 className="h-3.5 w-3.5" /> <Label compact={compact}>Longer</Label>
              </button>
              {onSimpler && (
                <button
                  type="button"
                  onClick={onSimpler}
                  title="Answer this question again in plainer, everyday words"
                  className={iconBtn(false)}
                >
                  <Feather className="h-3.5 w-3.5" /> <Label compact={compact}>Simpler</Label>
                </button>
              )}
            </>
          )}
          {answer.has_content && answer.status !== "failed" && <CopyButton text={answerAsText(a)} />}
          {onRate && answer.status === "complete" && answer.has_content && (
            <AnswerRatingButtons value={rating} onRate={onRate} />
          )}
          <button
            type="button"
            onClick={() => onPin(!pinned)}
            aria-pressed={pinned}
            title={pinned ? "Unpin — follow new questions again" : "Pin — keep this answer on screen"}
            className={cx(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              pinned
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
              focusRing,
            )}
          >
            {pinned ? "Pinned" : "Pin"}
          </button>
        </span>
      </div>

      {reading && reader && <ReadAloudControls reader={reader} />}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2" tabIndex={0}>
        {a.grounding === "example" && answer.has_content && (
          <p
            className="mb-2 flex animate-fade-in items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200"
            title="Parts of this answer describe experience that isn't in your documents"
          >
            <PenLine className="mt-px h-3.5 w-3.5 flex-none" />
            <span>Suggested details — check they match your real experience before you say them.</span>
          </p>
        )}
        {a.grounding === "inferred" && answer.status === "complete" && (
          <p
            className="mb-2 flex animate-fade-in items-start gap-1.5 rounded-md bg-sky-500/10 px-2 py-1 text-xs text-sky-800 dark:text-sky-200"
            title="Built on facts from your documents, but goes further than they say"
          >
            <PenLine className="mt-px h-3.5 w-3.5 flex-none" />
            <span>Based on your documents — some details go beyond them, so check before you say them.</span>
          </p>
        )}
        {thinking && (
          <div className="animate-fade-in space-y-2.5" role="status" aria-label="Thinking">
            <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Orb state="solving" />
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
            {answer.error?.retryable !== false && !readOnly && onRetry && (
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
        {structured && a.direct_answer && <SectionLabel block>Say</SectionLabel>}

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
                <Spoken text={para} live={answer.status === "streaming"} />
              </p>
            ))}
          </div>
        )}

        {terms.length > 0 && answer.status !== "failed" && (
          // The jargon the answer says, in plain words: so the candidate knows what they're saying. Never read out.
          <dl aria-label="Words in this answer" className="mt-2 animate-fade-in space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {terms.map((t) => (
              <div key={t.term} className="flex min-w-0 gap-1">
                <dt className="flex-none font-medium text-zinc-600 dark:text-zinc-300">{t.term}</dt>
                <dd className="min-w-0">= {t.meaning}</dd>
              </div>
            ))}
          </dl>
        )}

        {progress && answer.status !== "failed" && <KeyPoints progress={progress} compact={compact} {...(onTogglePoint ? { onToggle: onTogglePoint } : {})} />}

        {a.talking_points.length > 0 && (
          <ul className={cx("mt-2 space-y-1.5", compact ? "text-[0.9375rem]" : "text-base")}>
            {a.talking_points.map((point, i) => (
              <li key={i} className="flex gap-2 leading-snug text-zinc-800 dark:text-zinc-200">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                <span>
                  <Spoken text={point} live={answer.status === "streaming"} />
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

        {design.length > 0 && (
          <div className="mt-3 animate-fade-in" aria-label="System design">
            <SectionLabel block>Design</SectionLabel>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {design.map((d) => (
                <div key={d.title} className="min-w-0">
                  <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{d.title}</dt>
                  <dd className="text-zinc-800 dark:text-zinc-200">{d.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {debug && (debug.root_cause || debug.fix || debug.why || debug.diff) && (
          <div className="mt-3 animate-fade-in space-y-2" aria-label="Debugging">
            {debug.root_cause && (
              <p className="text-sm text-zinc-800 dark:text-zinc-200">
                <SectionLabel>Root cause</SectionLabel> {debug.root_cause}
              </p>
            )}
            {debug.fix && (
              <p className="text-sm text-zinc-800 dark:text-zinc-200">
                <SectionLabel>Minimal fix</SectionLabel> {debug.fix}
              </p>
            )}
            {debug.why && (
              <p className="text-sm text-zinc-800 dark:text-zinc-200">
                <SectionLabel>Why it failed</SectionLabel> {debug.why}
              </p>
            )}
            {debug.diff && <DiffView diff={debug.diff} />}
          </div>
        )}

        {a.code && (
          <div className="mt-3">
            {coding && <SectionLabel block>{debug ? "Corrected code" : "Code"}</SectionLabel>}
            <SpokenWalkthrough key={answer.answer_id} walkthrough={a.walkthrough}
              {...(loadWalkthrough && answer.status === "complete" ? { load: () => loadWalkthrough(answer.answer_id) } : {})}
              complete={answer.status === "complete"}
              code={<CodeBlock code={a.code} {...(onCodeLanguage ? { onLanguage: onCodeLanguage } : {})} />} />
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

        {coding && a.trace && a.trace.steps.length > 0 && (
          <div className="mt-3">
            <SectionLabel block>Dry run</SectionLabel>
            <p className="mb-1.5 font-mono text-[0.8125rem] text-zinc-600 dark:text-zinc-400">
              Input: <span className="text-zinc-900 dark:text-zinc-100">{a.trace.input}</span>
            </p>
            <ol className="relative space-y-1 border-l border-sky-500/30 pl-4 font-mono text-[0.8125rem] text-zinc-800 dark:text-zinc-200">
              {a.trace.steps.map((step, i) => (
                <li key={i} className="trace-step relative" style={{ animationDelay: `${i * 90}ms` }}>
                  <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-sky-400" />
                  <span className="mr-2 text-zinc-400">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
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
                <Spoken text={a.example} live={answer.status === "streaming"} />
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

        {!compact && answer.status === "complete" && a.sources !== undefined && a.sources.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400" aria-label="Sources from your documents">
            {a.sources.map((s) => (
              <li key={s.ref} className="flex min-w-0 items-center gap-1.5" title={s.excerpt}>
                {s.verified ? (
                  <Check className="h-3 w-3 flex-none text-emerald-600 dark:text-emerald-400" aria-label="From your documents" />
                ) : (
                  <Circle className="h-2 w-2 flex-none" aria-label="Reference" />
                )}
                <span className="truncate">
                  {sourceKind(s.doc_kind)}
                  {s.document ? ` · ${s.document}` : ""}: {s.excerpt}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!compact && answer.status === "complete" && a.sources === undefined && a.context_used.length > 0 && (
          <p className="mt-2 truncate text-xs text-zinc-400" title={a.context_used.join(" · ")}>
            Grounded in: {a.context_used.join(" · ")}
          </p>
        )}

        {answer.status === "cancelled" && (
          <p className="mt-3 text-xs text-zinc-400">
            {answer.cancel_reason === "stopped"
              ? answer.source === "chat"
                ? "Stopped. Ask again in chat for the whole reply."
                : "Stopped. Press Answer to write it again."
              : answer.cancel_reason === "superseded"
                ? "Stopped — a newer question took over."
                : "Stopped."}
          </p>
        )}
      </div>

      <span className="sr-only" aria-live="polite">
        {answer.status === "complete" ? `Answer ready: ${a.direct_answer || a.talking_points[0] || ""}` : ""}
      </span>
    </section>
  );
});

function sourceKind(kind: string): string {
  return kind === "resume" ? "Resume" : kind === "job_description" ? "Job description" : kind === "notes" ? "Notes" : "Document";
}

/** A unified diff with added/removed lines tinted; read-only and selectable. */
function DiffView({ diff }: { diff: string }) {
  return (
    <div>
      <SectionLabel block>Diff</SectionLabel>
      <pre
        className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 py-2 font-mono text-[0.8125rem] leading-relaxed dark:border-zinc-800 dark:bg-zinc-950"
        aria-label="Code diff"
      >
        {diff.split("\n").map((line, i) => {
          const tone = line.startsWith("+") && !line.startsWith("+++")
            ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
            : line.startsWith("-") && !line.startsWith("---")
              ? "bg-rose-500/10 text-rose-800 dark:text-rose-300"
              : line.startsWith("@@")
                ? "text-indigo-700 dark:text-indigo-300"
                : "text-zinc-700 dark:text-zinc-300";
          return (
            <div key={i} className={cx("px-3", tone)}>
              {line || "\u00a0"}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
