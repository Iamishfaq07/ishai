import { Link } from "react-router-dom";
import { Badge, CircleCheck, Code2, LoadGate, cx, focusRing } from "@orbit/ui";
import { Card, ErrorNote, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { codePath } from "./paths";

/** A problem's difficulty as the shared Badge's tone. */
export const DIFFICULTY_TONE = { easy: "success", medium: "warning", hard: "danger" } as const;

/**
 * Code AI: coding-round practice by pattern (the way the prep guides recommend: learn the patterns, not hundreds of
 * problems). Each problem runs its tests in your browser, gives hints that don't give it away, and an AI interviewer
 * reviews your code and how you explained it.
 */
export function CodeHomePage() {
  const data = useAsync(() => api.codeProblems(), [], "code-problems");
  const d = data.data;
  const solved = d?.problems.filter((p) => p.solved).length ?? 0;
  return (
    <>
      <PageHeader icon={Code2} title="Code AI" subtitle="Coding-round practice by pattern: write it, run the tests, then get an interviewer's review of your code and your explanation." />
      <LoadGate loading={data.loading && !d} variant="card" count={3} label="Getting the problems">
        {data.error && !d ? (
          <ErrorNote onRetry={data.reload}>{errorText(data.error)}</ErrorNote>
        ) : d ? (
          <>
            <Card className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Solved</p>
                <p className="font-display text-2xl font-semibold tabular-nums">{solved} <span className="text-base font-normal text-zinc-500">of {d.problems.length}</span></p>
              </div>
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Patterns covered</p>
                <p className="font-display text-2xl font-semibold tabular-nums">
                  {d.patterns.filter((pat) => d.problems.some((p) => p.pattern === pat && p.solved)).length} <span className="text-base font-normal text-zinc-500">of {d.patterns.length}</span>
                </p>
              </div>
              <p className="min-w-0 basis-full text-sm text-zinc-600 sm:basis-0 sm:flex-1 dark:text-zinc-300">
                Do the easier one in each pattern first, then the harder one. Explain your approach as you would out loud: the review scores that too.
                {d.reviews_left !== null && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{d.reviews_left} free reviews left today</span>}
              </p>
            </Card>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {d.patterns.map((pattern) => {
                const mine = d.problems.filter((p) => p.pattern === pattern);
                const done = mine.filter((p) => p.solved).length;
                return (
                  <Card key={pattern} className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2 className="font-display text-base font-semibold">{pattern}</h2>
                      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{done}/{mine.length} solved</span>
                    </div>
                    <ul className="space-y-1">
                      {mine.map((p) => (
                        <li key={p.id}>
                          <Link to={codePath(p.id)} className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-500/5", focusRing)}>
                            {p.solved ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Solved" /> : <span aria-hidden className="h-4 w-4 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />}
                            <span className="min-w-0 flex-1 truncate">{p.title}</span>
                            <Badge tone={DIFFICULTY_TONE[p.difficulty]} className="capitalize">{p.difficulty}</Badge>
                            {p.attempts > 0 && !p.solved && <span className="text-xs text-zinc-500">{p.attempts} tr{p.attempts === 1 ? "y" : "ies"}</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
            </div>
          </>
        ) : null}
      </LoadGate>
    </>
  );
}
