import { useState } from "react";
import { cx, focusRing } from "@orbit/ui";

export interface PipelineStage {
  id: string;
  title: string;
  /** What happens here, in a line. */
  what: string;
  latency: string;
  security: string;
}

/** What a live interview answer goes through, in order. Each claim is what the code does (docs/ARCHITECTURE.md). */
export const STAGES: PipelineStage[] = [
  {
    id: "capture",
    title: "Device capture",
    what: "Your mic and the interviewer's audio (a shared tab, or the desktop app's system audio) as two separate channels.",
    latency: "Audio leaves in 50 ms frames as it's spoken; nothing waits for a full sentence.",
    security: "Raw audio is streamed for transcription and never stored. The phone companion receives text only.",
  },
  {
    id: "speech",
    title: "Speech to question",
    what: "Streaming speech-to-text, then a detector that decides when the interviewer has finished a question.",
    latency: "A question is recognised from the provider's end-of-speech signal plus a short wait you choose.",
    security: "Your own channel is never answered as if it were the interviewer's, so your words can't trigger an answer.",
  },
  {
    id: "context",
    title: "Context & thinking effort",
    what: "The facts from your resume and documents that fit this question, and the thinking effort you picked.",
    latency: "Retrieval is local to the session's index; Off answers at once, more thinking trades seconds for depth.",
    security: "Only the facts this answer needs are sent to the model, never whole documents. Provider keys stay on the server.",
  },
  {
    id: "answer",
    title: "Answer engine",
    what: "The answer streams word by word, with a backup model if the first one fails before its first word.",
    latency: "Words appear as they're written; a stalled provider is dropped and the backup takes over.",
    security: "Screenshots sent for a coding question are answered, then discarded. Turn off saving transcripts in Settings and none are kept.",
  },
];

const X = [20, 220, 420, 620];
const W = 160;

/**
 * The live pipeline as a diagram: four stages joined by a line that packets travel along. Hovering, focusing or
 * tapping a stage shows what it guarantees. Packets stop with reduced motion (base.css stops animations).
 */
export function ArchitecturePipeline() {
  const [active, setActive] = useState(STAGES[0]!.id);
  const stage = STAGES.find((s) => s.id === active) ?? STAGES[0]!;
  return (
    <div>
      {/* Phones: the stages as buttons (the diagram's labels would be too small to read). */}
      <div className="grid grid-cols-2 gap-2 sm:hidden" role="group" aria-label="How a live answer is made">
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === active}
            onClick={() => setActive(s.id)}
            className={cx(
              "min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-medium",
              s.id === active ? "border-sky-400 bg-sky-500/10" : "border-zinc-300 dark:border-white/15",
              focusRing,
            )}
          >
            <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">{i + 1}</span> {s.title}
          </button>
        ))}
      </div>
      <svg viewBox="0 0 800 140" className="hidden w-full overflow-visible sm:block" role="group" aria-label="How a live answer is made">
        <defs>
          <linearGradient id="pipe-line" x1="0" x2="1">
            <stop offset="0" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#818cf8" />
          </linearGradient>
          <filter id="pipe-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <line x1="100" y1="70" x2="700" y2="70" stroke="url(#pipe-line)" strokeOpacity="0.45" strokeWidth="2" />
        {[0, 1, 2].map((i) => (
          <g key={i} className="pipe-packet" style={{ animationDelay: `${i * 0.9}s` }} aria-hidden="true">
            <circle cx="100" cy="70" r="6" fill="#38bdf8" filter="url(#pipe-glow)" />
            <circle cx="100" cy="70" r="3" fill="#e0f2fe" />
          </g>
        ))}
        {STAGES.map((s, i) => {
          const on = s.id === active;
          return (
            <g
              key={s.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={s.title}
              onMouseEnter={() => setActive(s.id)}
              onFocus={() => setActive(s.id)}
              onClick={() => setActive(s.id)}
              className={cx("cursor-pointer outline-none", focusRing)}
            >
              <rect
                x={X[i]}
                y="40"
                width={W}
                height="60"
                rx="14"
                className={cx(
                  "transition-[stroke,fill] duration-200",
                  on ? "fill-sky-500/15 stroke-sky-400" : "fill-zinc-100 stroke-zinc-300 dark:fill-white/[0.04] dark:stroke-white/15",
                )}
                strokeWidth="1.5"
              />
              <text x={X[i]! + W / 2} y="75" textAnchor="middle" className="fill-zinc-800 text-[13px] font-semibold dark:fill-zinc-100">
                {s.title}
              </text>
              <text x={X[i]! + W / 2} y="28" textAnchor="middle" className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="orbit-card mt-3 rounded-2xl p-4" aria-live="polite">
        <h3 className="font-display font-semibold">{stage.title}</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{stage.what}</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Speed</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{stage.latency}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Privacy & security</dt>
            <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{stage.security}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
