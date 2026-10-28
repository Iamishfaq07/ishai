import { useState } from "react";
import type { JobMission, JobTrackerEntry } from "@orbit/types";
import { Circle, CircleCheck, LoaderCircle, Sparkles, TriangleAlert, cx } from "@orbit/ui";
import { Button } from "../../components/ui";
import { trackAction } from "../../lib/activity";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";

type StepId = "fit" | "resume" | "post" | "questions";
type State = { status: "todo" | "done" | "running" | "failed" | "skipped"; note?: string };

const MANUAL = "ext:";

/**
 * One tap for a job: check the fit, give it a resume (a tailored copy, or your main resume), keep its post for
 * practice and write the likely interview questions. Each step is the same call its own tab makes, so the limits,
 * credits and checks are the same; steps already done are skipped and never paid for twice. A step that can't run
 * (no post for a job added by hand, no resume yet) says why and the rest still run.
 */
export function PrepareAll({ entry, mission, onDone, onInterview }: {
  entry: JobTrackerEntry; mission: JobMission; onDone: () => void; onInterview?: () => void;
}) {
  const prep = useAsync(() => api.interviewPrep(entry.id), [entry.id], `interview-prep:${entry.id}`);
  const profile = useAsync(() => api.jobProfile(), [], "job-profile");
  const manual = entry.listing_id.startsWith(MANUAL);
  const [tailor, setTailor] = useState(!manual);
  const [askQuestions, setAskQuestions] = useState(true);
  const [run, setRun] = useState<Record<StepId, State> | null>(null);
  const [busy, setBusy] = useState(false);

  const has = {
    fit: Boolean(mission.fit),
    resume: Boolean(mission.resume),
    post: Boolean(entry.document_id),
    questions: Boolean(prep.data?.questions && !prep.data.questions.stale),
  };
  if (!run && has.fit && has.resume && has.post && has.questions) return null;
  if (!["saved", "applied", "interviewing"].includes(entry.status)) return null;

  const credits = (!has.resume && tailor && !manual ? 1 : 0) + (!has.questions && askQuestions ? 1 : 0);
  const steps: Array<{ id: StepId; label: string; detail: string }> = [
    { id: "fit", label: "Check your fit", detail: manual && !has.post ? "Needs the job post (paste it on the Requirements tab)" : "Free, within your daily checks" },
    { id: "resume", label: "A resume for this job", detail: manual ? "Your main resume, linked to this job" : tailor ? "A tailored copy (1 AI credit)" : "Your main resume, linked to this job" },
    { id: "post", label: "Keep the job post for practice", detail: manual ? "Saved when you paste the post" : "Free" },
    { id: "questions", label: "Likely interview questions", detail: askQuestions ? "From this job and its resume (1 AI credit)" : "Skipped" },
  ];

  const start = async () => {
    setBusy(true);
    trackAction("Prepare everything", entry.company);
    const state: Record<StepId, State> = {
      fit: { status: has.fit ? "done" : "todo" }, resume: { status: has.resume ? "done" : "todo" },
      post: { status: has.post ? "done" : "todo" }, questions: { status: has.questions ? "done" : askQuestions ? "todo" : "skipped" },
    };
    const set = (id: StepId, s: State) => { state[id] = s; setRun({ ...state }); };
    setRun({ ...state });
    const step = async (id: StepId, fn: () => Promise<string | void>) => {
      if (state[id].status !== "todo") return;
      set(id, { status: "running" });
      try {
        const note = await fn();
        set(id, { status: "done", ...(note ? { note } : {}) });
      } catch (err) {
        set(id, { status: "failed", note: errorText(err) });
      }
    };
    await step("fit", async () => {
      if (manual) {
        if (!has.post) throw new Error("Paste the job post on the Requirements tab first.");
        await api.call(`/v1/jobs/tracker/${encodeURIComponent(entry.id)}/fit`, { method: "POST", body: JSON.stringify({}) });
      } else await api.jobFitCheck(entry.listing_id);
    });
    await step("resume", async () => {
      if (!manual && tailor) {
        const out = await api.tailorForJob(entry.listing_id);
        return `${out.title} made and linked`;
      }
      const main = profile.data?.resume?.id;
      if (!main) throw new Error("Choose your main resume in My Career first.");
      await api.linkMissionResume(entry.id, main);
      return "Main resume linked";
    });
    await step("post", async () => {
      if (manual) throw new Error("Paste the job post on the Requirements tab to keep it.");
      await api.prepareForJob(entry.listing_id);
    });
    if (state.resume.status === "failed" && state.questions.status === "todo") {
      set("questions", { status: "skipped", note: "Needs a resume for this job first." });
    }
    await step("questions", async () => {
      const out = await api.interviewQuestions(entry.id);
      return `${out.questions.length} questions ready on the Interview tab`;
    });
    setBusy(false);
    prep.reload();
    onDone();
  };

  return (
    <section aria-labelledby="prepare-all" className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200 sm:p-6 dark:bg-zinc-900 dark:ring-white/10">
      <h2 id="prepare-all" className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-emerald-700 dark:text-emerald-300" aria-hidden />Prepare everything for this job</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">One tap runs each step below; what's already done is skipped.</p>
      <ol className="mt-4 space-y-2.5">
        {steps.map((s) => {
          const st = run?.[s.id] ?? { status: has[s.id] ? "done" : s.id === "questions" && !askQuestions ? "skipped" : "todo" };
          return (
            <li key={s.id} className="flex items-start gap-2.5 text-sm">
              <StepIcon status={st.status} />
              <span className="min-w-0 flex-1">
                <span className={cx("block font-medium", st.status === "done" && "text-zinc-500 dark:text-zinc-400")}>{s.label}</span>
                <span className={cx("block text-xs", st.status === "failed" ? "text-rose-700 dark:text-rose-300" : "text-zinc-500 dark:text-zinc-400")}>
                  {st.note ?? (st.status === "done" ? "Done" : s.detail)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {!run && (
        <div className="mt-4 space-y-2 text-sm">
          {!has.resume && !manual && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={tailor} onChange={(e) => setTailor(e.target.checked)} className="h-4 w-4" />
              Tailor a copy of my resume (else link my main resume)</label>
          )}
          {!has.questions && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={askQuestions} onChange={(e) => setAskQuestions(e.target.checked)} className="h-4 w-4" />
              Write likely interview questions</label>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!run || busy ? (
          <Button loading={busy} onClick={() => void start()}>Prepare everything</Button>
        ) : (
          <>
            {run.questions.status === "done" && onInterview && <Button onClick={onInterview}>See the interview questions</Button>}
            <Button variant="secondary" onClick={() => setRun(null)}>Done</Button>
          </>
        )}
        {!run && <span className="text-xs text-zinc-500 dark:text-zinc-400">{credits ? `Uses up to ${credits} AI credit${credits > 1 ? "s" : ""}.` : "No AI credits needed."}</span>}
      </div>
    </section>
  );
}

function StepIcon({ status }: { status: State["status"] }) {
  const base = "mt-0.5 h-4 w-4 shrink-0";
  if (status === "done") return <CircleCheck className={cx(base, "text-emerald-600")} aria-label="Done" />;
  if (status === "running") return <LoaderCircle className={cx(base, "animate-spin text-zinc-500 motion-reduce:animate-none")} aria-label="Working" />;
  if (status === "failed") return <TriangleAlert className={cx(base, "text-rose-600")} aria-label="Couldn't run" />;
  return <Circle className={cx(base, "text-zinc-400")} aria-label={status === "skipped" ? "Skipped" : "To do"} />;
}
