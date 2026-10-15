import { useEffect, useState } from "react";
import type { LoopMemory } from "@orbit/types";
import { Zap, cx } from "@orbit/ui";
import { api } from "../lib/api";

/**
 * Before another round with a company the candidate has met before: what earlier interviewers asked and which of
 * their stories were already told. Orbit's answers in this round pick different stories (the server passes the same
 * memory to them). Shows nothing for a first round.
 */
export function LoopMemoryNote({ company, className }: { company: string; className?: string }) {
  const [memory, setMemory] = useState<LoopMemory | null>(null);
  const name = company.trim();
  useEffect(() => {
    setMemory(null);
    if (name.length < 2) return;
    let live = true;
    const t = window.setTimeout(() => {
      api.loopMemory(name).then((m) => live && setMemory(m), () => undefined);
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [name]);
  if (!memory || memory.rounds === 0) return null;
  return (
    <div role="status" className={cx("rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-sm", className)}>
      <p className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
        <Zap className="h-4 w-4 shrink-0" aria-hidden /> Loop memory & story guard
      </p>
      <p className="mt-1 text-zinc-700 dark:text-zinc-300">
        Round {memory.rounds + 1} with {memory.company}. Interviewers in one loop compare notes, so Orbit's answers will
        pick different stories from the ones you've already told here.
      </p>
      {memory.stories.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Stories already told</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {memory.stories.map((s) => (
              <li key={s} className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {memory.questions.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Already asked ({memory.questions.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-300">
            {memory.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
