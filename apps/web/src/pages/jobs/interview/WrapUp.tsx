import { useState } from "react";
import { Link } from "react-router-dom";
import type { InterviewOutcome, InterviewPrepView, InterviewRoundType, OrbitSession } from "@orbit/types";
import {
  ArrowRight,
  CircleCheck,
  LoadGate,
  OUTCOMES,
  ROUND_TYPES,
  cx,
  dateTimeInput,
  followUpDefault,
  fromDateTimeInput,
  interviewWhen,
  outcomeEffect,
  suggestedOutcome,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select } from "../../../components/ui";
import { api } from "../../../lib/api";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { STATUS_LABEL } from "../model";
import { outreachPath } from "../paths";
import { textLink } from "../links";
import { interviewPrepPath } from "./links";

/**
 * After a round started from a tracked job (SessionDetail, `application_id`): this page's summary and scorecard are
 * already linked on the job's tracker card; here the user says how it went, and only then does the job move (a next
 * round with its type and date, waiting with a date to follow up, an offer, or not this time). The thank-you note:
 * the Follow up card below drafts one from the call at no credit, or Outreach writes one from the resume and the job
 * post for one resume credit. A practice round only links back to the job's prep.
 */
export function JobWrapUp({ session, followUp }: { session: OrbitSession; followUp: boolean }) {
  const id = session.application_id ?? "";
  const prep = useAsync(() => api.interviewPrep(id), [id], `interview-prep:${id}`);
  const v = prep.data;
  if (!id) return null;
  if (prep.error && !v) return null; // the job has left the tracker (or isn't this account's): nothing to wrap up
  return (
    <LoadGate loading={prep.loading && !v} variant="card" count={1} label="Loading the job this round was for">
      {v ? session.type === "mock" ? <PracticeNote view={v} /> : <WrapUpForm view={v} session={session} followUp={followUp} onView={(next) => prep.setData(() => next)} /> : null}
    </LoadGate>
  );
}

function PracticeNote({ view }: { view: InterviewPrepView }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-200/80 bg-zinc-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
      <span>
        Practice for <span className="font-medium">{view.company}</span> · {view.title}
      </span>
      <Link to={interviewPrepPath(view.entry_id)} className={cx(textLink, "inline-flex items-center gap-1")}>
        Back to its interview prep <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

function WrapUpForm({
  view,
  session,
  followUp,
  onView,
}: {
  view: InterviewPrepView;
  session: OrbitSession;
  /** The Follow up card (a thank-you from the transcript) is on this page. */
  followUp: boolean;
  onView: (v: InterviewPrepView) => void;
}) {
  const [outcome, setOutcome] = useState<InterviewOutcome>(() => suggestedOutcome(view.status));
  const [roundType, setRoundType] = useState<InterviewRoundType | "">("");
  const [nextAt, setNextAt] = useState("");
  const [followUpAt, setFollowUpAt] = useState(() => dateTimeInput(followUpDefault()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<InterviewPrepView | null>(null);
  const resume = view.versions.find((x) => x.kind === "resume");
  // The round just held: the one set on the job, else as many as the live rounds started from it (as the server counts).
  const held = view.round.number ?? Math.max(1, view.rounds.filter((r) => !r.practice && r.status === "ended").length);
  const outreach = outreachPath({ job: view.job.live && !view.job.manual ? view.job.listing_id : null, resume: resume?.id ?? null });

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = outcome === "next_round" ? fromDateTimeInput(nextAt) : outcome === "waiting" ? fromDateTimeInput(followUpAt) : null;
      const next = await api.wrapUpInterview(view.entry_id, {
        session_id: session.id,
        outcome,
        ...(outcome === "next_round" ? { round_type: roundType || null } : {}),
        at,
      });
      onView(next);
      setSaved(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="wrap-title" className="mb-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="wrap-title" className="font-display text-lg font-semibold">
              {view.company} · {view.title}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              This round's summary and scorecard are linked on the job's tracker card. Now: {STATUS_LABEL[view.status]}
              {view.round.label ? ` · ${view.round.label}` : ""}
              {view.round.at ? ` · ${interviewWhen(view.round.at)}` : ""}.
            </p>
          </div>
          <Link to={interviewPrepPath(view.entry_id)} className={cx(textLink, "text-sm")}>
            Open the job
          </Link>
        </div>

        {saved ? (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
            <CircleCheck className="h-4 w-4 flex-none" aria-hidden />
            Saved: {STATUS_LABEL[saved.status]}
            {saved.round.label ? ` · ${saved.round.label}` : ""}
            {saved.round.at ? ` · ${interviewWhen(saved.round.at)}` : ""}.
          </p>
        ) : (
          <fieldset className="mt-4 border-t border-zinc-200 pt-4 dark:border-white/10">
            <legend className="sr-only">How did it go?</legend>
            <p className="text-sm font-medium">How did it go?</p>
            <div role="radiogroup" aria-label="How did it go?" className="mt-2 flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  className={cx(
                    "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                    outcome === o.value ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10",
                  )}
                >
                  <input type="radio" name="wrap-outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="h-4 w-4 text-indigo-600 focus:ring-indigo-500" />
                  {o.label}
                </label>
              ))}
            </div>
            {outcome === "next_round" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Next round" htmlFor="wrap-type">
                  <Select id="wrap-type" value={roundType} onChange={(e) => setRoundType(e.target.value as InterviewRoundType | "")}>
                    <option value="">Not sure yet</option>
                    {ROUND_TYPES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Its date and time, if you have it" htmlFor="wrap-at" hint="Home and the prep plan count down to it.">
                  <Input id="wrap-at" type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
                </Field>
              </div>
            )}
            {outcome === "waiting" && (
              <div className="mt-3 max-w-xs">
                <Field label="Follow up on" htmlFor="wrap-follow" hint="A reminder on Home. Clear it for none.">
                  <Input id="wrap-follow" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
                </Field>
              </div>
            )}
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{outcomeEffect(outcome, view.status, held)} Nothing changes until you confirm.</p>
            {error && (
              <div className="mt-3">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}
            <Button className="mt-3" loading={busy} onClick={() => void confirm()}>
              Update the job
            </Button>
          </fieldset>
        )}

        <div className="mt-4 border-t border-zinc-200 pt-4 text-sm dark:border-white/10">
          <p className="font-medium">Thank-you note</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            {followUp && (
              <>
                <a href="#follow-up" className={textLink}>
                  Draft it from this call
                </a>{" "}
                (below, no credit used), or{" "}
              </>
            )}
            <Link to={outreach} className={textLink}>
              {followUp ? "write it in Outreach" : "Write it in Outreach"}
            </Link>{" "}
            from your resume and the job post (1 resume credit).
          </p>
        </div>
      </Card>
    </section>
  );
}
