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
          {s?.negotiation
            ? "End the session for your review: how you anchored, justified and handled pushback, with stronger lines to use, in History."
            : "End the session for your review: each answer graded, with a stronger way to say it, in History."}
        </p>
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
    </section>
  );
}
