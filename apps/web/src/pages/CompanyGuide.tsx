import type { CompanyStyle } from "@orbit/types";
import { Building2, cx, focusRing } from "@orbit/ui";
import { Card } from "../components/ui";

/** "What to expect at Amazon": the rounds, what its interviewers listen for, tips and questions in its style
 *  (GET /v1/interview-styles). A mock started with this company asks in the same style. */
export function CompanyGuide({ style, className, inMock = true }: { style: CompanyStyle; className?: string; inMock?: boolean }) {
  return (
    <section aria-labelledby={`guide-${style.slug}`} className={className}>
      <Card className="animate-fade-up">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
            <Building2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 id={`guide-${style.slug}`} className="font-display text-base font-semibold">
              What to expect at {style.name}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              As candidates commonly report it; it varies by team, level and year.{inMock && " Your mock interviewer now asks in this style."}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold text-zinc-500">The rounds</h4>
            <ol className="mt-2 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              {style.rounds.map((r, i) => (
                <li key={r} className="flex gap-2">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-zinc-500/10 text-[11px] font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
                    {i + 1}
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-500">They listen for</h4>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {style.looks_for.map((v) => (
                <li key={v} className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-800 ring-1 ring-indigo-500/20 dark:text-indigo-200">
                  {v}
                </li>
              ))}
            </ul>
            <h4 className="mt-4 text-xs font-semibold text-zinc-500">Tips</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-400 dark:text-zinc-300">
              {style.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
        <details className="mt-4 text-sm">
          <summary className={cx("cursor-pointer select-none text-xs font-medium text-indigo-600 dark:text-indigo-300", focusRing)}>
            Questions in their style
          </summary>
          <ul className="mt-2 space-y-1.5 text-zinc-700 dark:text-zinc-300">
            {style.questions.map((q) => (
              <li key={q} className="rounded-lg bg-zinc-500/5 px-3 py-2">
                {q}
              </li>
            ))}
          </ul>
        </details>
    </Card>
    </section>
  );
}
