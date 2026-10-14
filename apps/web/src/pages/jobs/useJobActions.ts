import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { JobFitCheck, JobFitResponse, JobListing, JobStatus } from "@orbit/types";
import { ApiError, practiceDocuments } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { practiceHref } from "../../lib/onboarding";
import { resumeToText } from "../resume/model";
import { resumePath } from "../resume/paths";
import { prepParams } from "../../lib/prepContext";

export interface FitState {
  loading: boolean;
  result: JobFitResponse | null;
  error: string | null;
  open: boolean;
}

/** A note after an action, with where to go next ("Open “Backend resume (Acme)”"). */
export interface ActionNote {
  text: string;
  to: string;
  label: string;
}

/**
 * What Orbit can do with one job, for its card in the feed and its own page alike: save it (or take it off the
 * tracker), mark it applied, check the fit with the AI, tailor a copy of the resume to it, and prepare for its
 * interview. `initialFit` is a fit check already run for this job and resume (it opens without using a check).
 */
export function useJobActions(
  job: JobListing,
  resumeId: string | null,
  onTracked: (jobId: string, tracked: JobListing["tracked"]) => void,
  initialFit: JobFitCheck | null = null,
) {
  const navigate = useNavigate();
  const [askApplied, setAskApplied] = useState(false);
  const [busy, setBusy] = useState<"save" | "applied" | "tailor" | "prepare" | "fullprep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<ActionNote | null>(null);
  const [fit, setFit] = useState<FitState>({
    loading: false,
    result: initialFit ? { check: initialFit, cached: true, left: null } : null,
    error: null,
    open: Boolean(initialFit),
  });
  const tracked = job.tracked;

  const track = async (status: JobStatus) => {
    setBusy(status === "applied" ? "applied" : "save");
    setError(null);
    try {
      const entry = await api.trackJob(job.id, status);
      onTracked(job.id, { id: entry.id, status: entry.status });
      setAskApplied(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const unsave = async () => {
    if (!tracked) return;
    setBusy("save");
    setError(null);
    try {
      await api.untrackJob(tracked.id);
      onTracked(job.id, null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const checkFit = async () => {
    if (fit.result) {
      setFit((f) => ({ ...f, open: !f.open }));
      return;
    }
    setFit({ loading: true, result: null, error: null, open: true });
    try {
      setFit({ loading: false, result: await api.jobFitCheck(job.id), error: null, open: true });
    } catch (err) {
      const limit = err instanceof ApiError && err.code === "fit_check_limit";
      setFit({ loading: false, result: null, error: limit ? err.message : errorText(err), open: true });
    }
  };

  const tailor = async () => {
    setBusy("tailor");
    setError(null);
    try {
      const r = await api.tailorForJob(job.id, resumeId);
      if (!tracked) onTracked(job.id, { id: r.tracker_id, status: "saved" });
      if (r.note) setNote({ text: r.note, to: resumePath(r.resume_id), label: `Open “${r.title}”` });
      else navigate(resumePath(r.resume_id), { state: { fromJob: job.title } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const prepare = async () => {
    setBusy("prepare");
    setError(null);
    try {
      const r = await api.prepareForJob(job.id);
      const to = practiceHref({ jd: r.document_id, role: job.title, company: job.company });
      if (!tracked) onTracked(job.id, { id: r.tracker_id, status: "saved" });
      // Practice reads the resume from Documents: save the matched one there too, the way "Use in Orbit" does (kept
      // up to date, not copied). Without it the questions still come; the answers just can't use the resume.
      let resumeMissed = false;
      if (resumeId) {
        resumeMissed = await api
          .getResume(resumeId)
          .then((resume) => practiceDocuments(api, { title: resume.title, resumeText: resumeToText(resume.data), jobText: "" }))
          .then(() => false)
          .catch(() => true);
      }
      const missed = resumeMissed
        ? "The resume couldn't be copied into Documents just now, so practice answers won't use it until you add it there."
        : "";
      const text = [r.note, missed].filter(Boolean).join(" ");
      if (text) setNote({ text, to, label: "Go to Practice" });
      else navigate(to);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const fullPrep = async () => {
    setBusy("fullprep"); setError(null);
    try {
      const result = await api.fullJobPrep(job.id, resumeId);
      navigate(`${resumePath(result.resume_id)}?${prepParams(result.context)}`, { state: { fromJob: job.title } });
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(null); }
  };

  return {
    fullPrep: () => void fullPrep(),
    tracked,
    busy,
    error,
    note,
    fit,
    askApplied,
    /** After Apply opens the post: ask "Did you apply?" (unless it's already marked applied). */
    applied: () => tracked?.status !== "applied" && setAskApplied(true),
    notYet: () => setAskApplied(false),
    track: (status: JobStatus) => void track(status),
    toggleSaved: () => void (tracked ? unsave() : track("saved")),
    checkFit: () => void checkFit(),
    closeFit: () => setFit((f) => ({ ...f, open: false })),
    tailor: () => void tailor(),
    prepare: () => void prepare(),
  };
}

export type JobActions = ReturnType<typeof useJobActions>;
