import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { ArrowRight, LoadGate, cx, focusRing } from "@orbit/ui";
import { Card } from "../../components/ui";
import { api } from "../../lib/api";
import { matchStyle } from "../../lib/companyStyle";
import { formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { CompanyGuide } from "../CompanyGuide";
import { practiceLink } from "./model";
import { jobPath } from "./paths";

/**
 * The company, for this job: how it interviews (Orbit's guide, when it has one: as candidates commonly report it), and
 * what it asked you before (questions from your own sessions you named for this company). Nothing is presented as
 * "the questions they'll ask"; it's what to practise.
 */
export function CompanyPanel({ entry }: { entry: JobTrackerEntry }) {
  const styles = useAsync(() => api.interviewStyles(), [], "interview-styles");
  const memory = useAsync(() => api.loopMemory(entry.company), [entry.company], `loop-memory:${entry.company}`);
  const guide = matchStyle(styles.data ?? [], entry.company);
  const m = memory.data;
  return (
    <div className="space-y-4">
      <LoadGate loading={styles.loading && !styles.data} variant="card" count={1} label="Loading the company guide">
        {guide ? (
          <CompanyGuide style={guide} inMock={false} />
        ) : (
          <Card>
            <h2 className="font-display text-base font-semibold">No guide for {entry.company} yet</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Orbit has interview guides for the companies people ask about most. For this one, the job post is the best guide: practise on it.
            </p>
          </Card>
        )}
      </LoadGate>
      <Card>
        <h2 className="font-display text-base font-semibold">What {entry.company} asked you before</h2>
        <LoadGate loading={memory.loading && !m} variant="line" count={2} label="Loading your earlier rounds">
          {m && m.rounds > 0 ? (
            <>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                From {m.rounds} of your sessions named for {entry.company}
                {m.last_round_at ? `, the last on ${formatDate(m.last_round_at)}` : ""}.
              </p>
              {m.questions.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {m.questions.slice(0, 8).map((q) => <li key={q}>{q}</li>)}
                </ul>
              )}
              {m.stories.length > 0 && (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                  Stories you've already told them: {m.stories.join(", ")}. Pick fresh ones for the next round.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">No earlier rounds with {entry.company}. After a practice or live round named for them, its questions show here.</p>
          )}
        </LoadGate>
        <Link to={practiceLink(entry, jobPath)} className={cx("mt-4 inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          Practise in {entry.company}'s style <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </Card>
    </div>
  );
}
