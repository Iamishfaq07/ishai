import { Link } from "react-router-dom";
import { ArrowRight, RotateCcw, Users, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { followUpState } from "./jobs/model";
import { JOBS_OUTREACH } from "./jobs/paths";

/**
 * Home's "Due today": the practice queue's questions that are due again (PracticeQueue.tsx) and the people to follow
 * up with (jobs/People.tsx), each one tap from what to do about it. Nothing due: nothing shown.
 */
export function DueToday() {
  const queue = useAsync(() => api.practiceQueue(), [], "practice-queue");
  const contacts = useAsync(() => api.jobContacts(), [], "job-contacts");
  const questions = queue.data?.due.length ?? 0;
  const people = (contacts.data ?? []).filter((c) => {
    const s = followUpState(c.follow_up_at);
    return s === "overdue" || s === "today";
  });
  if (!questions && !people.length) return null;

  const tile = cx(
    "glass-panel lift flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3.5 text-sm hover:border-indigo-400/40 dark:hover:border-indigo-400/30",
    focusRing,
  );
  return (
    <section aria-label="Due today" className="flex flex-col gap-3 sm:flex-row">
      {questions > 0 && (
        <Link to="/mock" className={tile}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <RotateCcw className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              {questions} question{questions === 1 ? "" : "s"} due for practice
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">Answers that were weak last time, back until you nail them</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        </Link>
      )}
      {people.length > 0 && (
        <Link to={`${JOBS_OUTREACH}#people`} className={tile}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              Follow up with {people.length === 1 ? people[0]!.name : `${people.length} people`}
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {people.length === 1
                ? [people[0]!.title, people[0]!.company].filter(Boolean).join(" at ") || "A follow-up you planned"
                : people
                    .slice(0, 3)
                    .map((p) => (p.company ? `${p.name} (${p.company})` : p.name))
                    .join(", ")}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        </Link>
      )}
    </section>
  );
}
