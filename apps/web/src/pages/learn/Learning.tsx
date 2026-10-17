import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Badge, Code2, GraduationCap, LearningScene, ShieldCheck, cx, focusRing } from "@orbit/ui";
import { PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { CODE_HOME } from "../code/paths";
import { KASHSEC_URL } from "./links";

const card = "orbit-card lift flex h-full flex-col rounded-2xl p-5";

/**
 * Learning AI: where Orbit teaches. Code AI (coding-round practice, in Orbit) and KashSec (free cybersecurity and AI
 * lessons, its own site).
 */
export function LearningPage() {
  const code = useAsync(() => api.codeProblems(), [], "code-problems");
  const solved = code.data?.problems.filter((p) => p.solved).length ?? 0;
  const total = code.data?.problems.length ?? 0;
  return (
    <>
      <PageHeader icon={GraduationCap} title="Learning AI" subtitle="Learn the skills interviews test: coding rounds here in Orbit, and cybersecurity and AI for free on KashSec." art={<LearningScene />} />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <li className="min-w-0">
          <Link to={CODE_HOME} className={cx(card, focusRing)}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
              <Code2 className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold">Code AI</h2>
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
        <li className="min-w-0">
          <a href={KASHSEC_URL} target="_blank" rel="noopener" className={cx(card, focusRing)}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-4 flex items-center gap-2 font-display text-lg font-semibold">
              KashSec <Badge tone="success">Free</Badge>
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Learn cybersecurity and AI for free: lessons and guides from Orbit's founder, for beginners and for anyone heading into security roles.
            </p>
            <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Open KashSec <ArrowUpRight className="h-4 w-4" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </span>
          </a>
        </li>
      </ul>
    </>
  );
}
