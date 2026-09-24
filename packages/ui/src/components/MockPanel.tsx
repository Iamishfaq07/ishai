import type { LiveViewState } from "../live/reducer";
import type { InterviewerVoice } from "../live/useInterviewerVoice";
import type { LiveActions } from "../live/useLiveSession";
import { cx, focusRing } from "./cx";

/**
 * Mock interview view: the AI interviewer's question (spoken aloud), whose turn it is, and controls. Orbit never
 * suggests answers here — it's practice; the report afterwards grades what was said.
 */
export function MockPanel({ live, actions, voice, ended }: {
  live: LiveViewState;
  actions: LiveActions;
  voice: InterviewerVoice;
  ended: boolean;
}) {
  const q = live.mock;
  const btn = cx("rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 " +
    "dark:border-zinc-800 dark:hover:bg-zinc-900", focusRing);

  if (live.mockCompleted || ended) {
    return (
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold">That's the end of the interview.</p>
        <p className="text-sm text-zinc-500">Your review — each answer graded, with a stronger way to say it — is being prepared in History.</p>
      </div>
    );
  }
  if (!q) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-zinc-500">
        <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-hidden="true" />
        The interviewer is getting ready…
      </div>
    );
  }
  const status = voice.speaking ? "Interviewer speaking…" : "Your turn — answer out loud. Pause when you're done.";
  return (
    <section aria-label="Mock interview" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span className="uppercase tracking-[0.12em]">Question {q.index} of {q.total}</span>
        {q.isFollowUp && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-700 dark:text-indigo-300">Follow-up</span>}
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
          {voice.speaking ? "Stop voice" : "Repeat question"}
        </button>
        <button type="button" onClick={actions.mockNext} className={btn}>
          I'm done — next question
        </button>
      </div>
      {!voice.supported && (
        <p className="text-xs text-amber-700 dark:text-amber-300">This device has no speech voice — read the question above.</p>
      )}
    </section>
  );
}
