import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, GraduationCap, Spot, cx, focusRing } from "@orbit/ui";
import { KashSecFeature } from "../../components/KashSec";
import { PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { CODE_HOME } from "../code/paths";
import { OpportunityReturn } from "../../components/OpportunityReturn";
import { careerToolHref } from "../../lib/opportunityTrail";

const card = "orbit-card lift flex h-full flex-col rounded-2xl p-5";

/**
 * Learning: where Orbit teaches. Coding practice (coding-round practice, in Orbit) and KashSec Academy (the Orbit team's
 * free cybersecurity school, its own site), featured below it.
 */
export function LearningPage() {
  const [params] = useSearchParams();
  const code = useAsync(() => api.codeProblems(), [], "code-problems");
  const solved = code.data?.problems.filter((p) => p.solved).length ?? 0;
  const total = code.data?.problems.length ?? 0;
  return (
    <>
      <OpportunityReturn />
      <PageHeader eyebrow="Interview preparation" icon={GraduationCap} title="Learning" subtitle="Learn the skills interviews test: coding rounds here in Orbit, and cybersecurity for free on KashSec Academy." />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <li className="min-w-0">
          <Link to={careerToolHref(CODE_HOME, params)} className={cx(card, focusRing)}>
            <Spot kind="code" size="lg" />
            <h2 className="mt-4 font-display text-lg font-semibold">Coding practice</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Coding-round practice by pattern: write it, run the tests in your browser, take hints that don't give it away, and get an interviewer's review of your code and how you explained it.
            </p>
            {total > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Solved</span>
                  <span className="tabular-nums">{solved} of {total}</span>
                </div>
                <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-zinc-500/15">
                  <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(solved / total) * 100}%` }} />
                </span>
              </div>
            )}
            <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {solved ? "Keep practising" : "Start practising"} <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </li>
      </ul>
      <KashSecFeature placement="learning" className="mt-6" />
    </>
  );
}
