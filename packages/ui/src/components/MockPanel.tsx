import { useEffect, useState } from "react";
import { answerBand, answerWords, bandLabel, clock, paceState } from "../live/answerPace";
import type { LiveViewState } from "../live/reducer";
import type { InterviewerVoice } from "../live/useInterviewerVoice";
import type { LiveActions } from "../live/useLiveSession";
import { cx, focusRing } from "./cx";
import { Orb } from "./Orb";

/**
 * Mock interview view: the AI interviewer's question (spoken aloud), whose turn it is, and controls. Orbit never
 * suggests answers here — it's practice; the report afterwards grades what was said.
 */
export function MockPanel({ live, actions, voice, ended, onViewReport }: {
  live: LiveViewState;
  actions: LiveActions;
  voice: InterviewerVoice;
  ended: boolean;
  /** Open the transcript and review, offered once the session has ended. */
  onViewReport?: () => void;
}) {
  const q = live.mock;
  const btn = cx("rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 " +
    "dark:border-zinc-800 dark:hover:bg-zinc-900", focusRing);

  if (live.mockCompleted || ended) {
    const s = live.mockSummary;
    return (
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold">
          {s?.negotiation
            ? "That's the end of the call."
            : s?.drill
              ? "That's the end of the drill."
              : "That's the end of the interview."}
        </p>
        {s && s.answered !== undefined && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300" aria-label="Round summary">
            {s.negotiation ? `${s.questions} turns with the recruiter` : `${s.answered} of ${s.questions} answered`}
            {s.follow_ups ? ` · ${s.follow_ups} follow-up${s.follow_ups === 1 ? "" : "s"}` : ""}
            {s.average_answer_words ? ` · about ${s.average_answer_words} words per answer` : ""}
            {s.unanswered ? ` · ${s.unanswered} skipped` : ""}
          </p>
        )}
        <p className="text-sm text-zinc-500">
          {/* The server ends the session itself when the round finishes, so there's nothing left to press. */}
          {s?.negotiation
            ? "Your review is on its way to History: how you anchored, justified and handled pushback, with stronger lines to use."
            : "Your review is on its way to History: each answer graded, with a stronger way to say it."}
        </p>
        {ended && onViewReport && (
          <button type="button" onClick={onViewReport} className={cx(btn, "mt-2")}>
            See the transcript and review
          </button>
        )}
      </div>
    );
  }
  if (!q) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-sm text-zinc-500">
        <Orb state="connecting" size={64} />
        The interviewer is getting ready…
      </div>
    );
  }
  const status = q.negotiation
    ? voice.speaking
      ? "Recruiter speaking…"
      : "Your move — respond out loud. Pause when you're done."
    : voice.speaking
      ? "Interviewer speaking…"
      : "Your turn — answer out loud. Pause when you're done.";
  return (
    <section aria-label="Mock interview" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span className="uppercase tracking-[0.12em]">
          {q.negotiation ? `Recruiter · turn ${q.index} of up to ${q.total}` : `Question ${q.index} of ${q.total}`}
        </span>
        {q.isFollowUp && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-700 dark:text-indigo-300">Follow-up</span>}
        {q.drillKind === "retry" && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-300" title="A question you found hard last time">
            Drill: try again
          </span>
        )}
        {q.drillKind === "prep" && (
          <span className="rounded-full bg-aurora-400/10 px-2 py-0.5 text-aurora-700 dark:text-aurora-300" title="A question from your interview prep">
            From your prep
          </span>
        )}
        {q.drillKind === "story" && (
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-800 dark:text-violet-300" title="A question one of your saved stories answers">
            Story practice
          </span>
        )}
        {q.drillKind === "concise" && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:text-emerald-300">Short version · ~30 s</span>
        )}
      </div>
      <p key={q.questionId} className="animate-fade-up text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {q.text}
      </p>
      <p role="status" className={cx("flex items-center gap-2 text-sm",
        voice.speaking ? "text-indigo-700 dark:text-indigo-300" : "text-emerald-700 dark:text-emerald-300")}>
        <span className={cx("h-2 w-2 rounded-full", voice.speaking ? "animate-pulse bg-indigo-500" : "animate-ping bg-emerald-500")}
              aria-hidden="true" />
        {status}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={voice.speaking ? voice.stop : voice.repeat} className={btn} disabled={!voice.supported}>
          {voice.speaking ? "Stop voice" : q.negotiation ? "Repeat that" : "Repeat question"}
        </button>
        <button type="button" onClick={actions.mockNext} className={btn}>
          {q.negotiation ? "I'm done — your turn, recruiter" : "I'm done — next question"}
        </button>
      </div>
      {!voice.supported && (
        <p className="text-xs text-amber-700 dark:text-amber-300">This device has no speech voice — read the question above.</p>
      )}
      {!q.negotiation && <AnswerTimer key={`timer-${q.questionId}`} live={live} q={q} />}
      {/* Who has the floor, at a glance from across the room: the interviewer talking, or Orbit listening to you. */}
      <div aria-hidden="true" className="flex min-h-48 flex-1 flex-col items-center justify-center gap-10">
        <span className="relative flex items-center justify-center">
          <span
            className={cx(
              "absolute inset-0 -m-6 rounded-full ring-1 transition-colors duration-panel",
              voice.speaking ? "bg-indigo-500/[0.07] ring-indigo-500/15" : "bg-emerald-500/[0.07] ring-emerald-500/20",
            )}
          />
          <Orb key={voice.speaking ? "speaking" : "listening"} state={voice.speaking ? "composing" : "listening"} size={64} className="relative" />
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
          {voice.speaking ? (q.negotiation ? "Recruiter" : "Interviewer") : "Listening to you"}
        </span>
      </div>
    </section>
  );
}

/**
 * How long this answer has run, against how long one like it usually runs (live/answerPace.ts). It starts with the
 * first words, so thinking time before answering doesn't count; a new question (its key) starts it again.
 */
function AnswerTimer({ live, q }: { live: LiveViewState; q: NonNullable<LiveViewState["mock"]> }) {
  // The turns already there when the question came: the answer is what's said after them.
  const [from] = useState(live.turnOrder.length);
  const words = answerWords(live, from);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (words > 0 && startedAt === null) {
      const t = Date.now();
      setStartedAt(t);
      setNow(t);
    }
  }, [words, startedAt]);
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const band = answerBand(q);
  if (startedAt === null) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Take a moment to think first. A good answer here runs {bandLabel(band)}.
      </p>
    );
  }
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const state = paceState(elapsed, band);
  // The track runs a quarter past the band's end, so "too long" has somewhere to go.
  const scale = band.max * 1.25;
  const pct = (n: number) => `${Math.min(n / scale, 1) * 100}%`;
  const note = state === "warming" ? `Keep going: aim for ${bandLabel(band)}` : state === "good" ? "Good length" : `Past ${clock(band.max)}: land the result and stop`;
  return (
    <div role="group" aria-label="Answer timer" className="max-w-md space-y-1.5">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-display text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{clock(elapsed)}</span>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">· {words} word{words === 1 ? "" : "s"}</span>
        <span
          aria-live="polite"
          className={cx(
            "ml-auto text-xs font-medium",
            state === "good" ? "text-emerald-700 dark:text-emerald-300" : state === "long" ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400",
          )}
        >
          {note}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-500/15" aria-hidden="true">
        <span className="absolute inset-y-0 bg-emerald-500/25" style={{ left: pct(band.min), width: `calc(${pct(band.max)} - ${pct(band.min)})` }} />
        <span
          className={cx(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
            state === "good" ? "bg-emerald-500" : state === "long" ? "bg-amber-500" : "bg-indigo-500",
          )}
          style={{ width: pct(elapsed) }}
        />
      </div>
    </div>
  );
}
