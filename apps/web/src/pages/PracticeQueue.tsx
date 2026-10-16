import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PracticeQueue } from "@orbit/types";
import { CalendarIcon, RotateCcw, cx } from "@orbit/ui";
import { Button, Card, ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { errorText, whenDue } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { LiveLaunchState } from "./SessionSetup";

const SHOWN = 5; // a round asks at most five (practice_queue.MAX_DRILL)

/**
 * The practice queue (spaced repetition, sessions/practice_queue.py): questions you answered weakly in any review
 * come back the next day, then after 3, 7 and 21 days while you answer them well, until they're learnt. One tap
 * practises what's due. Nothing at all to show (no weak answers yet): renders nothing.
 */
export function PracticeQueueCard({ className }: { className?: string }) {
  const navigate = useNavigate();
  const q = useAsync<PracticeQueue>(() => api.practiceQueue(), [], "practice-queue");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = q.data;
  if (!data || (!data.due.length && !data.upcoming && !data.learnt)) return null;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const session = await api.practiceQueueDrill();
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setStarting(false);
    }
  };

  const due = data.due.length;
  const asked = Math.min(due, SHOWN);
  return (
    <Card className={cx("animate-fade-up", className)}>
      <section aria-labelledby="queue-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300">
              <RotateCcw className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="queue-title" className="font-display text-lg font-semibold">
                {due ? `${due} question${due === 1 ? "" : "s"} due for practice` : "Nothing due for practice"}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {due
                  ? "Answers that were weak in a review come back until you nail them: tomorrow, then in 3, 7 and 21 days."
                  : data.next_due_at
                    ? `The next one comes back ${whenDue(data.next_due_at)}.`
                    : "Every question you struggled with is learnt."}
                {data.learnt > 0 && ` ${data.learnt} learnt so far.`}
              </p>
            </div>
          </div>
          {due > 0 && (
            <Button onClick={() => void start()} disabled={starting} className="w-full sm:w-auto">
              {starting ? "Starting…" : `Practise ${asked === due ? (due === 1 ? "it" : "them") : `the first ${asked}`} now`}
            </Button>
          )}
        </div>
        {due > 0 && (
          <ul className="mt-4 divide-y divide-zinc-200/70 dark:divide-white/10">
            {data.due.slice(0, SHOWN).map((item) => (
              <li key={item.question} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 text-zinc-800 dark:text-zinc-200">{item.question}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <CalendarIcon className="h-3 w-3" aria-hidden />
                  {item.last_score === null ? "Not answered" : `${item.last_score}/5 last time`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {due > SHOWN && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {due - SHOWN} more after these: a round asks five at a time, weakest first.
          </p>
        )}
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </section>
    </Card>
  );
}
