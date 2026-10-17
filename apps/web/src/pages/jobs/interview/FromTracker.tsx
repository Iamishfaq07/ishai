import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { InterviewSessionContext } from "@orbit/types";
import { BookmarkCheck, CompanyLogo, Skeleton, contextSummary, cx, focusRing, interviewWhen } from "@orbit/ui";
import { ErrorNote } from "../../../components/ui";
import { api } from "../../../lib/api";
import { errorText } from "../../../lib/format";
import { interviewPrepPath } from "./links";

export interface TrackerContext {
  ctx: InterviewSessionContext | null;
  loading: boolean;
  error: string | null;
}

/**
 * `/start?application=<id>`: the copilot's setup for a tracked job's interview. The server saves the job's post and
 * the resume version sent as documents (once) and says what the session starts with; SessionSetup fills its form from
 * it and creates the session with `application_id`. No AI and no credit until the session starts.
 */
export function useTrackerContext(applicationId: string | null): TrackerContext {
  const [state, setState] = useState<TrackerContext>({ ctx: null, loading: Boolean(applicationId), error: null });
  useEffect(() => {
    if (!applicationId) return;
    let gone = false;
    setState({ ctx: null, loading: true, error: null });
    api
      .interviewSessionContext(applicationId)
      .then((ctx) => !gone && setState({ ctx, loading: false, error: null }))
      .catch((err: unknown) => !gone && setState({ ctx: null, loading: false, error: errorText(err) }));
    return () => {
      gone = true;
    };
  }, [applicationId]);
  return state;
}

/** "From your tracker: Razorpay · Round 2 · Technical round", and what was loaded for it. */
export function FromTrackerBanner({ state }: { state: TrackerContext }) {
  if (state.loading) return <Skeleton variant="line" count={2} label="Loading the interview from your tracker" />;
  if (state.error) return <ErrorNote>{`Couldn't load that interview from your tracker: ${state.error}`}</ErrorNote>;
  const ctx = state.ctx;
  if (!ctx) return null;
  const loaded = contextSummary(ctx);
  return (
    <section aria-label="From your tracker" className="flex items-start gap-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/5 px-4 py-3">
      <CompanyLogo company={ctx.company} size="md" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
          <BookmarkCheck className="h-3.5 w-3.5" aria-hidden /> From your tracker
        </p>
        <p className="mt-0.5 font-medium">
          {[ctx.company, ctx.round.label || ctx.role].filter(Boolean).join(" · ")}
          {ctx.round.at ? <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {interviewWhen(ctx.round.at)}</span> : null}
        </p>
        {loaded && <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">Loaded: {loaded}. Answers are framed for {ctx.role}.</p>}
        {ctx.notes.map((n) => (
          <p key={n} className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            {n}
          </p>
        ))}
        <Link to={interviewPrepPath(ctx.application_id)} className={cx("mt-1 inline-block rounded text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          Open its interview prep
        </Link>
      </div>
    </section>
  );
}
