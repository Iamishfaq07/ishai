import { useAsync } from "../../lib/useAsync";
import { resumeReturnJob } from "./returnJob";
import { lazy, Suspense, memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { AtsCheck, AtsReport, CoverLetterLength, EvidenceItem, CoverLetterTone, Resume, ResumeData, ResumeDesign, ResumeFixResponse, ResumeInput, ResumeSpacing, ResumeSuggestion } from "@orbit/types";
import {
  Callout,
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  Check,
  CircleAlert,
  CircleCheck,
  Code2,
  Copy,
  ScanText,
  Download,
  Eye,
  FileText,
  Gauge,
  Link2,
  Mail,
  MessagesSquare,
  Palette,
  PenLine,
  Plus,
  Redo2,
  Send,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
  X,
  LoadGate,
  Skeleton,
  ApiError,
  InlineResumeDiff,
  confirmDialog,
  cx,
  focusRing,
  linesOver,
  splitPlaceholders,
  toast,
  dismissToast,
  updateToast,
  useCountUp,
  WorkingState,
  CosmicEmptyState,
  Spot,
  celebrate,
  SelectCheck,
  type SpotKind,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Spinner, Textarea, Toggle } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, errorText, isNotFound } from "../../lib/format";
import { announceOutOfCredits } from "../../lib/outOfCredits";
import { jobsForResume, outreachPath } from "../jobs/paths";
import { ContentForm } from "./ContentForm";
import { paintKeywords } from "./previewKeywords";
import { atsReading, type Reading } from "./atsReading";
import { ATS_80, ats80Step } from "./atsMilestone";
import { AiCostNote, AiErrorNote, AllowanceBanner, AllowanceContext, isUpgradeError, useAllowance, useResumeAllowance } from "./allowance";
import { saveQueueFor, useBackend } from "./backend";
import { drafts, type Draft } from "./saveQueue";
import { useAuth } from "../../lib/auth";
import { useCountry } from "../../lib/country";
import { FixActions, FixResult, fixKind } from "./FixPanel";
import { InterviewPrep, usePrepState } from "./InterviewPrep";
import { ACCENTS, FONTS, LINE_HEIGHTS, SPACING, addSkills, looksFor, templatesFor, applySuggestion, canApply, isSafeFix, newId, resumeToText, revertSuggestion, photoToDataUrl, suggestedSkills } from "./model";
import { RESUME_AI_HOME, shouldFlushResume } from "./paths";
import { LetterPreview, MM_TO_PX, PAGE_MM, ResumePreview, pageLayout } from "./ResumePreview";
import { scoreTone } from "./Resumes";
import { SaveToDocuments } from "./SaveToDocuments";
import { ResumeCareerActions } from "./ResumeCareerActions";

const Guided = lazy(() => import("./GuidedResume").then((m) => ({ default: m.GuidedResume })));

type Tab = "content" | "score" | "ai" | "design" | "letter" | "prep";

/** What undo/redo restores: everything the user edits. */
type Snapshot = Pick<Resume, "title" | "data" | "design" | "job_text" | "cover_letter" | "pending_suggestions">;
const snapshot = (r: Resume): Snapshot => ({ title: r.title, data: r.data, design: r.design, job_text: r.job_text, cover_letter: r.cover_letter, pending_suggestions: r.pending_suggestions });
/** A bracketed cue the AI leaves for the user to fill in ("by [X%]"). */
const FILL = /\[[^\][\n]{1,160}\]/g;
const HISTORY_LIMIT = 100;
/** Edits closer together than this, in the same field, undo as one step (a burst of typing). */
const HISTORY_GROUP_MS = 1200;

/** `short`: the label where the editor shares the width with the preview. */
const TABS: Array<{ id: Tab; label: string; short?: string; icon: typeof FileText }> = [
  { id: "content", label: "Content", icon: PenLine },
  { id: "score", label: "ATS score", short: "Score", icon: Gauge },
  { id: "ai", label: "AI fixes", icon: Wand2 },
  { id: "design", label: "Design", icon: Palette },
  { id: "letter", label: "Cover letter", short: "Letter", icon: Mail },
  { id: "prep", label: "Interview prep", short: "Prep", icon: MessagesSquare },
];

/** What the spinner says while the AI works on each kind of problem. */
const FIX_BUSY: Record<string, string> = {
  has_skills: "Finding skills to add…",
  skills_count: "Finding skills to add…",
  keywords: "Matching the job post…",
  dates: "Fixing the dates…",
  bullets_per_role: "Drafting bullets…",
  quantified: "Finding where numbers fit…",
};

/** The orb for what the AI is doing, from the words on screen: reading or scanning, combining with a job post, writing. */
function busyState(label: string): "searching" | "weaving" | "composing" {
  return /read|find|match|scor|fix/i.test(label) ? "searching" : /tailor/i.test(label) ? "weaving" : "composing";
}

/** Each ATS check's category, drawn: the list of what to fix reads by kind at a glance. */
const ATS_SPOT: Record<AtsCheck["category"], SpotKind> = {
  contact: "contact",
  sections: "sections",
  summary: "summary",
  experience: "briefcase",
  skills: "skills",
  readability: "readability",
  layout: "design",
  keywords: "keywords",
};

/** The resume editor, for a resume in the signed-in account. */
export function ResumeEditorPage() {
  const { resumeId = "" } = useParams();
  const location = useLocation();
  const job = resumeReturnJob(location.search);
  return job ? <JobResumeGuard key={`${job}:${resumeId}`} job={job} resumeId={resumeId} /> : <ResumeEditor />;
}

function JobResumeGuard({ job, resumeId }: { job: string; resumeId: string }) {
  const context = useAsync(() => api.jobMission(job), [job, resumeId]);
  if (context.loading) return <p role="status">Checking this opportunity’s selected resume…</p>;
  if (context.data?.resume?.id === resumeId && context.data.resume_requires_copy === false) {
    return <><p className="mb-4 text-sm text-indigo-700 dark:text-indigo-300">Job-specific resume · edits stay with this opportunity.</p><ResumeEditor /></>;
  }
  return <Card><h1 className="font-display text-xl font-semibold">Review this job’s resume first</h1><p className="mt-3 text-sm">This link does not identify an independent resume for this opportunity. Choose its current copy or create a separate one before editing for the job.</p>{context.error && <ErrorNote onRetry={context.reload}>{errorText(context.error)}</ErrorNote>}<Link className="mt-4 inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300" to={`/jobs/mission/${encodeURIComponent(job)}?tab=resume`}>Review opportunity materials</Link><Link className="ml-4 inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300" to={`/resume-ai/${encodeURIComponent(resumeId)}?guide=1`}>Edit this resume independently</Link></Card>;
}

function ResumeEditor() {
  const backend = useBackend();
  const { resumeId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const guided = new URLSearchParams(location.search).get("guide") === "1";
  const returnJob = resumeReturnJob(location.search);
  const [resume, setResume] = useState<Resume | null>(null);
  const [loadError, setLoadError] = useState<{ text: string; missing: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("content");
  const [report, setReport] = useState<AtsReport | null>(null);
  // The first time an edit takes the score past 80 on this device: a success moment (celebrate shows it once). While
  // it's up it says the score the header shows: fixes landing in a row (82, 97, 99) don't leave it on the first.
  const lastScore = useRef<number | null>(null);
  useEffect(() => {
    const now = report?.score ?? null;
    const step = ats80Step(lastScore.current, now);
    if (step?.do === "celebrate") celebrate(ATS_80, { id: ATS_80, message: step.message });
    else if (step?.do === "update") updateToast(ATS_80, { message: step.message });
    else if (step?.do === "close") dismissToast(ATS_80);
    lastScore.current = now; // null between resumes, so opening another doesn't count as a rise
  }, [report?.score]);
  // The resume the report scored: a line's writing issues show only while that line still reads the same.
  const [scored, setScored] = useState<ResumeData | null>(null);
  const [save, setSave] = useState<{ state: SaveStatus; error?: string; retry?: boolean }>({
    state: "saved",
  });
  // Saves go through one queue per resume (saveQueue.ts), shared with the save this editor makes as it closes and the
  // next editor's: a resume never has two PUTs in flight, so an older one can't land last (V3-06). Each save names the
  // revision it was based on; a save from another tab or device since then makes this one a conflict, not an overwrite.
  // `saving` keeps one autosave per editor at a time; when it finishes it bumps `flush` to pick up newer edits.
  const saves = saveQueueFor(backend);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Confirmed evidence vault claims, to mark the bullets they back (signed in, with the vault switched on). A
  // failure only means no marks.
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const vault = Boolean(user?.evidence_vault);
  useEffect(() => {
    if (!vault) return;
    let live = true;
    api.listEvidence().then((items) => live && setEvidence(items.filter((i) => i.status === "confirmed")), () => undefined);
    return () => {
      live = false;
    };
  }, [vault, userId]);
  const saving = useRef(false);
  const present = useRef(false);
  useEffect(() => { present.current = true; return () => { present.current = false; }; }, []);
  const [flush, setFlush] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Edits this browser kept because the server never confirmed them (a failed save, a tab closed mid-save).
  const [draft, setDraft] = useState<Draft<ResumeInput> | null>(null);
  const [queue, setQueue] = useState<ResumeSuggestion[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  // Bumped when an AI change lands: a laser line sweeps down the preview once (base.css .laser-scan).
  const [scan, setScan] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  // The free AI use is spent: the AI panel offers the upgrade with its message.
  const [aiUpgrade, setAiUpgrade] = useState(false);
  const allowance = useResumeAllowance();
  const prep = usePrepState(); // the Interview prep tab's results, kept while the editor is open
  const [notice, setNotice] = useState<string | null>(
    (location.state as { imported?: boolean } | null)?.imported
      ? "We imported your resume. Check each section: the AI reads most resumes well, but not perfectly."
      : null,
  );
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  // What the preview marks: the field being edited, or what's hovered on the ATS tab (a check's lines, a question).
  const [editing, setEditing] = useState<string | null>(null);
  const [pointing, setPointing] = useState<string[]>([]);

  useEffect(() => {
    const requested = resumeId;
    let cancel = false;
    setResume(null);
    setLoadError(null);
    setReport(null);
    setScored(null);
    history.current = { past: [], future: [], at: 0, el: null };
    setSteps({ undo: 0, redo: 0 });
    setDraft(null);
    // A save of this resume still on its way (from the editor just left, A → B → A) lands before it's read, or the
    // editor would open the text from before it.
    saves
      .idle(requested)
      .then(() => backend.get(requested))
      .then((loaded) => {
        // A slow fetch for the resume we left must not land on the one we opened, or its save would write the old text.
        if (cancel || loaded.id !== requested) return;
        saves.setRevision(requested, loaded.revision);
        setResume(loaded);
        setQueue(loaded.pending_suggestions ?? []);
        if (loaded.pending_suggestions?.length) setTab("ai");
        setSave({ state: "saved" });
        const kept = drafts.load<ResumeInput>(userId, requested);
        if (kept && sameText(kept.payload, payloadOf(loaded))) drafts.clear(userId, requested);
        else if (kept) setDraft(kept);
      })
      .catch((err: unknown) => {
        if (!cancel) setLoadError({ text: errorText(err), missing: isNotFound(err) });
      });
    return () => {
      cancel = true;
    };
  }, [backend, resumeId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Undo/redo. Typing in one field is one step; a pause, another field or a button starts the next.
  const latest = useRef(resume);
  latest.current = resume;
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; at: number; el: Element | null }>({ past: [], future: [], at: 0, el: null });
  const [steps, setSteps] = useState({ undo: 0, redo: 0 });
  const apply = useCallback((next: Resume) => {
    saves.supersede(next.id);
    latest.current = next;
    setResume(next);
    setSave({ state: "dirty" });
    setSteps({ undo: history.current.past.length, redo: history.current.future.length });
  }, [saves]);
  const change = useCallback(
    (fn: (r: Resume) => Resume) => {
      const r = latest.current;
      if (!r) return;
      const next = fn(r);
      if (next === r) return;
      const h = history.current;
      const now = Date.now();
      const el = document.activeElement;
      if (!h.past.length || now - h.at > HISTORY_GROUP_MS || el !== h.el) {
        h.past.push(snapshot(r));
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
      }
      h.at = now;
      h.el = el;
      h.future = [];
      apply(next);
    },
    [apply],
  );
  const step = useCallback(
    (from: "undo" | "redo") => {
      const r = latest.current;
      const h = history.current;
      const target = (from === "undo" ? h.past : h.future).pop();
      if (!r || !target) return;
      (from === "undo" ? h.future : h.past).push(snapshot(r));
      h.at = 0; // the next edit is a new step
      apply({ ...r, ...target });
    },
    [apply],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      // Inside a text field the browser's own undo edits that field; elsewhere it's the whole resume.
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      step(key === "y" || e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);
  const update = useCallback((fn: (d: ResumeData) => ResumeData) => change((r) => ({ ...r, data: fn(r.data) })), [change]);
  const setSuggestions = (next: ResumeSuggestion[]) => {
    setQueue(next);
    change((r) => ({ ...r, pending_suggestions: next }));
  };
  const setDesign = (patch: Partial<ResumeDesign>) => change((r) => ({ ...r, design: { ...r.design, ...patch } }));

  // Autosave, a moment after the last edit.
  useEffect(() => {
    if (!resume || save.state !== "dirty") return;
    const t = window.setTimeout(() => {
      if (saving.current || resume.id !== resumeId) return;
      saving.current = true;
      setSave({ state: "saving" });
      const id = resume.id;
      const payload = payloadOf(resume);
      drafts.keep(userId, id, payload, saves.revision(id));
      saves
        .save(id, payload)
        .then(() => {
          drafts.clear(userId, id);
          setSave((s) => (s.state === "saving" ? { state: "saved" } : s));
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            setSave((s) => s.state === "saving" ? { state: "dirty" } : s);
            return;
          }
          if (err instanceof ApiError && err.status === 409) {
            setSave({ state: "conflict" });
            return;
          }
          // A dropped or stalled connection (status 0) is worth trying again on its own; a refusal is not.
          setSave({ state: "error", error: errorText(err), retry: err instanceof ApiError && err.status === 0 });
        })
        .finally(() => {
          saving.current = false;
          setFlush((n) => n + 1);
        });
    }, 900);
    return () => window.clearTimeout(t);
  }, [backend, resume, resumeId, save.state, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a dropped connection, save again in a few seconds, or the moment the phone is back online.
  useEffect(() => {
    if (save.state !== "error" || !save.retry) return;
    const again = () => setSave((s) => (s.state === "error" ? { state: "dirty" } : s));
    const t = window.setTimeout(again, 5_000);
    window.addEventListener("online", again);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("online", again);
    };
  }, [save]);

  // Don't lose the last edits when leaving mid-save.
  const unsaved = useRef(false);
  unsaved.current = save.state === "dirty" || save.state === "error" || save.state === "saving";
  const routeId = useRef(resumeId);
  useEffect(() => {
    const previous = routeId.current;
    routeId.current = resumeId;
    const leaving = latest.current;
    if (!shouldFlushResume(leaving?.id, resumeId, unsaved.current) || !leaving || leaving.id !== previous) return;
    // The autosave timer is cleared by the route change, so write this resume before the next one replaces it. It
    // goes through the queue, after any autosave of it still in flight; the draft stays until the server confirms.
    flushResume(leaving);
  }, [backend, resumeId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function saveAndContinue() {
    const current = latest.current;
    if (!current || current.id !== resumeId) throw new Error("Wait for your resume to finish opening.");
    const startingPath = window.location.pathname + window.location.search;
    const payload = payloadOf(current);
    drafts.keep(userId, current.id, payload, saves.revision(current.id));
    try { await saves.save(current.id, payload); }
    catch (error) { setSave({ state: error instanceof ApiError && error.status === 409 ? "conflict" : "error", error: errorText(error) }); throw error; }
    if (!present.current || routeId.current !== current.id
        || window.location.pathname + window.location.search !== startingPath) return;
    if (!latest.current || latest.current.id !== current.id || !sameText(payloadOf(latest.current), payload)) {
      setSave({ state: "dirty" });
      throw new Error("Your resume changed while saving. Review the latest edits and continue again.");
    }
    drafts.clear(userId, current.id);
    setSave({ state: "saved" });
    navigate(returnJob ? `/jobs/mission/${returnJob}?guide=1&tab=resume` : `/jobs?start=1&resume_id=${encodeURIComponent(current.id)}`);
  }
  function setGuided(next: boolean) {
    const query = new URLSearchParams(location.search);
    if (next) query.set("guide", "1"); else { query.delete("guide"); query.delete("section"); }
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true });
    setTab("content");
  }
  function flushResume(r: Resume) {
    const payload = payloadOf(r);
    drafts.keep(userId, r.id, payload, saves.revision(r.id));
    void saves
      .save(r.id, payload)
      .then(() => drafts.clear(userId, r.id))
      .catch(() => undefined);
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      // "error" too: a phone that went offline would otherwise close the tab on edits that never reached the server.
      if (save.state !== "saved") {
        const r = latest.current;
        if (r) drafts.keep(userId, r.id, payloadOf(r), saves.revision(r.id)); // kept if the tab does close
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      const r = latest.current;
      if (r && unsaved.current) flushResume(r);
    },
    [backend], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Another tab or device saved this resume since it was opened: show theirs (this browser keeps a copy of these
   *  edits, offered back on reopening), or save these over it. */
  const loadLatest = () => {
    const r = latest.current;
    if (r) drafts.keep(userId, r.id, payloadOf(r), saves.revision(r.id));
    setReloadKey((n) => n + 1);
  };
  const keepMine = () => {
    const r = latest.current;
    if (r) saves.setRevision(r.id, undefined); // the next save lands whatever was saved meanwhile
    setSave({ state: "dirty" });
  };
  const restoreDraft = () => {
    const r = latest.current;
    if (!r || !draft) return;
    change((cur) => ({ ...cur, ...draft.payload, cover_letter: draft.payload.cover_letter ?? cur.cover_letter }));
    setDraft(null);
  };
  const discardDraft = () => {
    if (resume) drafts.clear(userId, resume.id);
    setDraft(null);
  };

  // Re-score as you type (deterministic and cheap on the server). Only the latest edit's score matters: a new edit
  // cancels the request still running, so slow replies can't pile up or land after a newer one. After a slow (or failed)
  // score, wait longer before the next, so a poor connection isn't hammered with a request per pause.
  const scoreWait = useRef(450);
  useEffect(() => {
    if (!resume) return;
    const ctl = new AbortController();
    let sentAt: number | null = null;
    const t = window.setTimeout(() => {
      const started = (sentAt = performance.now());
      backend.tools
        .scoreResume(resume.data, resume.design, resume.job_text, { signal: ctl.signal })
        .then((r) => {
          if (ctl.signal.aborted) return;
          sentAt = null;
          scoreWait.current = Math.min(2_500, Math.max(450, performance.now() - started));
          setReport(r);
          setScored(resume.data);
        })
        .catch(() => {
          sentAt = null;
          if (!ctl.signal.aborted) scoreWait.current = 2_500;
        });
    }, scoreWait.current);
    return () => {
      window.clearTimeout(t);
      // Cancelled while still waiting on the server: the connection is slow, so wait longer before the next one.
      if (sentAt !== null) {
        scoreWait.current = Math.min(2_500, Math.max(scoreWait.current * 1.6, performance.now() - sentAt));
      }
      ctl.abort();
    };
  }, [resume?.data, resume?.design, resume?.job_text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to the text a fix is about, once its tab is showing.
  useEffect(() => {
    if (!focusTarget) return;
    const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(focusTarget)}"]`);
    if (el) {
      // A folded form section keeps its fields hidden: open it so there's something to scroll to.
      el.closest<HTMLElement>("[data-collapsed]")?.querySelector<HTMLElement>("[data-collapse-toggle]")?.click();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
      el.classList.add("ring-2", "ring-amber-400");
      window.setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 1800);
    }
    setFocusTarget(null);
  }, [focusTarget, tab]);

  const showTarget = (target: string | null) => {
    if (!target) return;
    if (target.startsWith("design.")) {
      setTab("design");
      return;
    }
    if (guided) setGuided(false);
    setTab("content");
    setFocusTarget(target);
  };

  /** `focus`: rewrite just that one field (a bullet's ✨, the summary's "Rewrite with AI"). "shorten": the longest
   *  lines, to fit one page, `linesOver` printed lines too long at the most compact layout. */
  const askAi = async (mode: "improve" | "tailor" | "shorten", check?: string, focus?: string, linesOver?: number) => {
    if (!resume) return;
    setTab("ai");
    setAiBusy(
      focus
        ? focus === "basics.summary" ? "Writing your summary…" : "Rewriting that line…"
        : mode === "shorten"
          ? "Shortening your longest lines…"
          : (check && FIX_BUSY[check]) || (mode === "tailor" ? "Tailoring to the job…" : check ? "Working on that fix…" : "Reading your resume…"),
    );
    setAiError(null);
    setAiUpgrade(false);
    try {
      const res = await backend.tools.suggestResume({
        data: resume.data,
        design: resume.design,
        job_text: resume.job_text,
        mode: focus && resume.job_text.trim() ? "tailor" : mode,
        ...(check ? { check } : {}),
        ...(focus ? { focus } : {}),
        ...(mode === "shorten" && linesOver ? { lines_over: linesOver } : {}),
      });
      if (latest.current?.id !== resume.id) return;
      setSuggestions(res.suggestions);
      if (res.suggestions.length) setScan((n) => n + 1);
      if (res.upgrade_required) {
        setAiUpgrade(true);
        setAiError("These are the fixes that need no AI. AI rewrites, new bullets and tailoring need resume credits: you're out.");
        announceOutOfCredits({ kind: "resume", offer: allowance.allowance?.upgrade ?? undefined, note: "The fixes that need no AI are ready." });
      } else if (mode === "shorten") {
        setAiError(
          res.suggestions.length
            ? "Shorter versions of your longest lines, every number and tool kept. Accept the ones you like, then press Fit to one page again."
            : "The AI couldn't shorten these lines without losing a number or a tool, so nothing changed and no credit was used.",
        );
      } else if (!res.suggestions.length) setAiError("Nothing to change: the AI thinks this already reads well.");
    } catch (err) {
      setAiError(errorText(err));
      setAiUpgrade(isUpgradeError(err));
    } finally {
      setAiBusy(null);
      allowance.refresh();
    }
  };

  /** Apply one suggestion; `picked` narrows an add_skill to the skills the candidate ticked. */
  const accept = (s: ResumeSuggestion, picked?: string[]) => {
    if (!resume) return;
    const chosen = picked ? { ...s, after: picked.join(", ") } : s;
    if (!canApply(resume.data, s)) {
      setAiError("That part of the resume changed since the suggestion was made, so it was skipped.");
    } else {
      update((d) => applySuggestion(d, chosen, newId));
    }
    // Picking one draft of a line retires the other drafts (and fixes) of that line: they'd replace the text just set.
    const replaces = s.kind === "rewrite" || s.kind === "set";
    setSuggestions(queue.filter((x) => x.id !== s.id && !(replaces && x.path === s.path && (x.kind === "rewrite" || x.kind === "set"))));
  };

  /** Every mechanical fix with nothing to confirm (extra skills the resume proves, dates), at once. */
  const acceptSafe = () => {
    const safe = queue.filter(isSafeFix);
    if (!safe.length) return;
    update((d) => safe.reduce((acc, s) => applySuggestion(acc, s, newId), d));
    setSuggestions(queue.filter((x) => !safe.includes(x)));
    setAiError(null);
  };

  // "Fix with AI" on the ATS score: fixed, applied and re-checked on the server, landing here as one undo step.
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<ResumeFixResponse | null>(null);
  const [fixError, setFixError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const runFix = async (check: string | null, facts?: Record<string, string>, followup?: string | null) => {
    const r = latest.current;
    if (!r || fixing) return;
    setFixing(check ?? "all");
    setFixError(null);
    try {
      const out = await backend.tools.fixResume({
        data: r.data,
        design: r.design,
        job_text: r.job_text,
        ...(check ? { check } : {}),
        ...(facts ? { facts } : {}),
        ...(followup ? { followup } : {}),
      });
      const rank = new Map((out.order ?? []).map((id, i) => [id, i]));
      change((cur) => {
        // Each change names the text it replaces: a line edited while the AI worked is left as the user wrote it.
        let data = out.suggestions.reduce((d, sug) => applySuggestion(d, sug, newId), cur.data);
        if (out.order) {
          data = { ...data, experience: [...data.experience].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)) };
        }
        return { ...cur, data, design: { ...cur.design, ...out.design } };
      });
      setScan((n) => n + 1);
      // Answers to a fix's questions finish that fix: keep what it still offers for review, and its starting score.
      setFixResult((prev) =>
        facts && prev
          ? {
              ...out,
              score_before: prev.score_before,
              review: [...prev.review, ...out.review],
              remaining: [...prev.remaining.filter((c) => !out.remaining.some((o) => o.id === c.id)), ...out.remaining],
            }
          : out,
      );
      if (out.upgrade_required) {
        setFixError({ text: "The fixes that need no AI are done. Rewriting lines needs resume credits: you're out.", upgrade: true });
        announceOutOfCredits({ kind: "resume", offer: allowance.allowance?.upgrade ?? undefined, note: "The fixes that need no AI are done." });
      } else if (out.ai_error) setFixError({ text: out.ai_error, upgrade: false });
    } catch (err) {
      setFixError({ text: errorText(err), upgrade: isUpgradeError(err) });
    } finally {
      setFixing(null);
      allowance.refresh();
    }
  };
  const dropReview = (s: ResumeSuggestion) =>
    setFixResult((res) => (res ? { ...res, review: res.review.filter((x) => x.id !== s.id) } : res));
  const keepReview = (s: ResumeSuggestion, picked?: string[]) => {
    const chosen = picked ? { ...s, after: picked.join(", ") } : s;
    update((d) => applySuggestion(d, chosen, newId));
    dropReview(s);
  };

  const placeholders = report?.checks.find((c) => c.id === "placeholders" && !c.passed) ?? null;
  /** Downloading with an unfilled [placeholder] prints it as-is: say so first. */
  const okToDownload = () =>
    placeholders
      ? confirmDialog({
          title: "Some placeholders aren't filled in",
          body: `${placeholders.fix ?? ""} Download anyway?`,
          confirmLabel: "Download anyway",
        })
      : Promise.resolve(true);

  // "Download PDF" prints the resume, or the cover letter from its tab; the browser names the file after the title.
  const [printing, setPrinting] = useState<"resume" | "letter">("resume");
  // The job post's keywords marked on the on-screen preview (never the printed copy).
  const [showKeywords, setShowKeywords] = useState(true);
  // The preview and the print copy draw the resume a moment behind the form (React's deferred value): a keystroke
  // repaints the field at once, and the two full-page renders (and the preview's layout measuring) follow when the
  // browser is free, instead of every keystroke waiting for them (~340 ms a key on a mid-range phone).
  const previewData = useDeferredValue(resume?.data ?? null);
  const previewDesign = useDeferredValue(resume?.design ?? null);
  const previewLetter = useDeferredValue(resume?.cover_letter ?? "");
  // Printing draws the copy from the resume as it is this instant, not the deferred one.
  const [printFresh, setPrintFresh] = useState(false);
  const onFit = useLatestCallback((design: ResumeDesign) => change((r) => ({ ...r, design })));
  const onShorten = useLatestCallback((linesOver: number) => void askAi("shorten", undefined, undefined, linesOver));
  const printDoc = (kind: "resume" | "letter") => {
    if (!resume) return;
    flushSync(() => {
      setPrinting(kind);
      setPrintFresh(true);
    });
    const previous = document.title;
    document.title = fileName(resume, kind === "letter" ? "Cover letter" : "Resume");
    window.addEventListener(
      "afterprint",
      () => {
        document.title = previous;
        setPrinting("resume");
        setPrintFresh(false);
      },
      { once: true },
    );
    window.print();
  };

  if (loadError) {
    // A deleted resume (or an old link) gets a way back, not just the error.
    return loadError.missing ? (
      <CosmicEmptyState
        variant="no-results"
        title="That resume isn't here"
        body="It may have been deleted."
        action={<Link to={RESUME_AI_HOME} className="text-indigo-700 underline dark:text-indigo-300">See your resumes</Link>}
      />
    ) : (
      <div className="space-y-4">
        <ErrorNote onRetry={() => setReloadKey((n) => n + 1)}>{loadError.text}</ErrorNote>
        <Link to={RESUME_AI_HOME} className="text-sm text-indigo-700 underline dark:text-indigo-300">All resumes</Link>
      </div>
    );
  }
  if (!resume) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <LoadGate loading variant="card" count={2} label="Opening your resume">{null}</LoadGate>
        <div className="hidden lg:block">
          <Skeleton variant="resume-card" count={1} ghost />
        </div>
      </div>
    );
  }

  const editorForm = <ContentForm data={resume.data} update={update}
    onRewrite={(path) => void askAi("improve", undefined, path)} issues={report?.issues ?? []}
    scored={scored} evidence={evidence} checks={report?.checks ?? []} />;
  return (
    <AllowanceContext.Provider value={allowance}>
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to={RESUME_AI_HOME} aria-label="All resumes" className={cx("rounded-lg p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Input
          aria-label="Resume name"
          value={resume.title}
          maxLength={160}
          onChange={(e) => change((r) => ({ ...r, title: e.target.value }))}
          // A page title (PageHeader's 24 px, semibold, tight) in a field the row's 38 px high. The field's own text-sm
          // and py-2 would otherwise win the cascade, so these are marked important.
          className="min-w-0 flex-1 basis-48 font-display !py-0.5 !text-2xl font-semibold tracking-tight sm:max-w-[20rem]"
        />
        {/* The save state and undo/redo wrap together, so a phone never strands undo on a line of its own. */}
        <div className="flex flex-wrap items-center gap-2">
          <SaveState state={save.state} revision={saves.revision(resume.id)} error={save.error} onRetry={() => setSave({ state: "dirty" })} onLoadLatest={loadLatest} onKeepMine={keepMine} />
          <div className="flex items-center">
            <HistoryButton label="Undo" shortcut="Ctrl+Z" disabled={!steps.undo} onClick={() => step("undo")}>
              <Undo2 className="h-4 w-4" />
            </HistoryButton>
            <HistoryButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!steps.redo} onClick={() => step("redo")}>
              <Redo2 className="h-4 w-4" />
            </HistoryButton>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {report && (
            <button
              type="button"
              onClick={() => setTab("score")}
              className={cx("relative flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1", scoreTone(report.score), focusRing)}
              aria-label={`${report.score} ATS score, ${report.verdict}, out of 100. Show details`}
            >
              <ScoreCount score={report.score} className="font-display text-xl font-semibold" />{" "}
              <span className="text-left text-xs leading-tight">
                ATS score{" "}
                <br />
                {report.verdict}
              </span>
            </button>
          )}
          <SaveToDocuments resume={resume} />
          <DownloadWord resume={resume} confirm={okToDownload} />
          <Button
            variant="ghost"
            title="Download as JSON Resume (jsonresume.org): take your resume to other tools, or bring it back here exactly"
            aria-label="Download as JSON Resume"
            onClick={() => { void import("./jsonResume").then(({ toJsonResume }) => downloadText(`${fileName(resume)}.json`, JSON.stringify(toJsonResume(resume.data), null, 2), "application/json")).catch((error: unknown) => setNotice(errorText(error))); }}
          >
            <Code2 className="h-4 w-4" /> JSON
          </Button>
          <Button onClick={() => void okToDownload().then((ok) => ok && printDoc("resume"))}>
            <Download className="h-4 w-4" /> Download PDF
          </Button>
        </div>
      </div>

      <AllowanceBanner />

      {draft && (
        <div role="alert" className="mb-4">
          <Callout
            tone="warning"
            title="Unsaved edits found"
            action={
              <>
                <Button size="sm" variant="ghost" onClick={discardDraft}>
                  Discard
                </Button>
                <Button size="sm" onClick={restoreDraft}>
                  Restore them
                </Button>
              </>
            }
          >
            This browser kept edits to this resume from {new Date(draft.savedAt).toLocaleString()} that weren't saved.
            {draft.baseRevision !== undefined && draft.baseRevision !== resume.revision ? " It has been saved elsewhere since; restoring puts your edits over that." : ""}
          </Callout>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setGuided(!guided)}>{guided ? "Full editor" : "Edit step by step"}</Button>
        {guided && tab !== "content" && <Button variant="secondary" onClick={() => setTab("content")}>Back to guided steps</Button>}
        {guided && <p className="text-xs text-zinc-600 dark:text-zinc-400">Your existing resume and autosave, one section at a time.</p>}
      </div>
      {!guided && <ResumeCareerActions resume={resume} />}
      {notice && (
        <div role="status" className="mb-4">
          <Callout tone="info" onDismiss={() => setNotice(null)}>
            {notice}
          </Callout>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-w-0">
          {(!guided || tab !== "content") && <div className="sticky top-16 z-10 mb-4 flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
            <div role="tablist" aria-label="Resume editor" className="flex min-w-0 flex-1 flex-wrap gap-1">
              {TABS.map(({ id, label, short, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  aria-label={label}
                  title={short ? label : undefined}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cx(
                    "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1 py-1.5 xl:px-2 text-sm font-medium",
                    tab === id ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                    focusRing,
                  )}
                >
                  {/* Icons alone on phones, labels from there up (seven items leave no room for both), short ones where
                      the editor sits beside the preview; a column too narrow even for those wraps onto a second row. */}
                  <Icon className="h-4 w-4 shrink-0 sm:hidden" aria-hidden />
                  <span className={cx("hidden sm:inline", short && "lg:hidden")}>{label}</span>
                  {short && <span className="hidden lg:inline">{short}</span>}
                  {id === "ai" && queue.length > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[0.625rem] text-white">{queue.length}</span>}
                </button>
              ))}
            </div>
            {/* Where the "Profiles & outreach" tab was: it's Jobs's Outreach page now, opened on this resume. */}
            <Link
              to={outreachPath({ resume: resume.id })}
              aria-label="Outreach is now in Jobs: open it for this resume"
              title="Outreach is now in Jobs"
              className={cx(
                "flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                focusRing,
              )}
            >
              <Send className="h-4 w-4 shrink-0 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">Outreach</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </Link>
          </div>}

          {tab === "content" && (
            <div
              onFocus={(e) => setEditing((e.target as HTMLElement).closest("[data-path]")?.getAttribute("data-path") ?? null)}
              onBlur={() => setEditing(null)}
            >
              {guided ? <Suspense fallback={<p role="status">Opening guided editing…</p>}><Guided continueLabel={returnJob ? "Save & return to job" : undefined} data={resume.data} saveState={save.state} onContinue={saveAndContinue} onReview={() => setTab("score")}>{editorForm}</Guided></Suspense> : editorForm}
            </div>
          )}
          {tab === "score" && (
            <ScorePanel
              resume={resume}
              report={report}
              onJob={(job_text) => change((r) => ({ ...r, job_text }))}
              onAddSkill={(kw) =>
                // A keyword from the job post isn't proof: the candidate says they have it, as with the AI's job-post skills.
                void confirmDialog({
                  title: `Add “${kw}” to your skills?`,
                  body: "It comes from the job post, not your resume. Add it only if you've really used it: interviewers ask about every skill you list.",
                  confirmLabel: "I have it, add it",
                }).then((ok) => ok && update((d) => addSkills(d, [kw], newId)))
              }
              onShow={showTarget}
              fixing={fixing}
              onFix={(check) => void runFix(check)}
              showKeywords={showKeywords}
              onShowKeywords={setShowKeywords}
              onPoint={setPointing}
              result={
                <FixResult
                  result={fixResult}
                  report={report}
                  busy={fixing}
                  error={fixError}
                  onUndo={() => {
                    step("undo");
                    setFixResult(null);
                  }}
                  onKeep={keepReview}
                  onSkip={dropReview}
                  data={resume.data}
                  onRevert={(s) => update((d) => revertSuggestion(d, s))}
                  onAnswer={(facts) => void runFix("quantified", facts, fixResult?.followup)}
                  onShow={showTarget}
                  onPoint={setPointing}
                  onDismiss={() => {
                    setFixResult(null);
                    setFixError(null);
                  }}
                />
              }
            />
          )}
          {tab === "ai" && (
            <AiPanel
              hasJob={Boolean(resume.job_text.trim())}
              busy={aiBusy}
              error={aiError}
              upgrade={aiUpgrade}
              queue={queue}
              onAsk={(mode) => void askAi(mode)}
              onAccept={accept}
              onAcceptSafe={acceptSafe}
              onSkip={(s) => setSuggestions(queue.filter((x) => x.id !== s.id))}
              onShowJob={() => setTab("score")}
            />
          )}
          {tab === "design" && <DesignPanel design={resume.design} setDesign={setDesign} />}
          {tab === "letter" && (
            <LetterPanel
              resume={resume}
              onText={(cover_letter) => change((r) => ({ ...r, cover_letter }))}
              onShowJob={() => setTab("score")}
              onPrint={() => printDoc("letter")}
            />
          )}
          {tab === "prep" && <InterviewPrep resume={resume} prep={prep} onShowJob={() => setTab("score")} />}
        </div>

        <PreviewJump letter={tab === "letter"} />
        <div className="min-w-0">
          <div
            id="resume-preview"
            data-preview-scroll=""
            // It scrolls on its own on wide screens, so the keyboard can reach and scroll it too (WCAG 2.1.1).
            tabIndex={0}
            role="region"
            aria-label="Resume preview"
            className={cx("sticky top-20 scroll-mt-20 space-y-3 rounded-2xl lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4", focusRing)}
          >
            {placeholders && tab !== "letter" && (
              <div role="status" className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1">{placeholders.fix} They're highlighted below.</span>
                <Button size="sm" variant="secondary" onClick={() => showTarget(placeholders.target)}>
                  Show me
                </Button>
              </div>
            )}
            {tab === "letter" ? (
              <ScaledLetter data={previewData ?? resume.data} design={previewDesign ?? resume.design} text={previewLetter} />
            ) : (
              <div className="relative">
                {scan > 0 && <span key={scan} aria-hidden="true" className="laser-scan absolute inset-0 z-10" />}
                <ScaledPage
                  data={previewData ?? resume.data}
                  design={previewDesign ?? resume.design}
                  onFit={onFit}
                  onShorten={onShorten}
                  shortening={aiBusy !== null}
                  highlight={tab === "ai" ? (queue[0] ? [queue[0].path] : []) : tab === "content" ? (editing ? [editing] : []) : tab === "score" ? pointing : []}
                  keywords={showKeywords ? (report?.keywords?.matched ?? []) : []}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <PrintCopy
        data={printFresh ? resume.data : (previewData ?? resume.data)}
        design={printFresh ? resume.design : (previewDesign ?? resume.design)}
        letter={printing === "letter" ? (printFresh ? resume.cover_letter : previewLetter) : null}
      />
    </div>
    </AllowanceContext.Provider>
  );
}

/**
 * The ATS score, counted up from its last value (from 0 on first show). A rise also sends an emerald pulse round the
 * badge it sits in (the parent is `relative`). Screen readers get the final number only.
 */
function ScoreCount({ score, className }: { score: number; className?: string }) {
  const [range, setRange] = useState({ from: 0, to: score });
  if (range.to !== score) setRange({ from: range.to, to: score });
  const value = useCountUp(range.to, true, { from: range.from, duration: 700 });
  return (
    <>
      {range.to > range.from && <span key={range.to} aria-hidden="true" className="pulse-ring pointer-events-none absolute inset-0 rounded-[inherit]" />}
      <span className={cx("tabular-nums", className)}>
        <span aria-hidden="true">{Math.round(value)}</span>
        <span className="sr-only">{score}</span>
      </span>
    </>
  );
}

function HistoryButton({ label, shortcut, disabled, onClick, children }: { label: string; shortcut: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${shortcut})`}
      disabled={disabled}
      onClick={onClick}
      className={cx("rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white", focusRing)}
    >
      {children}
    </button>
  );
}

type SaveStatus = "saved" | "saving" | "dirty" | "error" | "conflict";

/** What's saved: the fields a save sends. */
function payloadOf(r: Resume): ResumeInput {
  return { title: r.title.trim() || "Untitled resume", data: r.data, design: r.design, job_text: r.job_text, cover_letter: r.cover_letter, pending_suggestions: r.pending_suggestions };
}

function sameText(a: ResumeInput, b: ResumeInput): boolean {
  const pick = (x: ResumeInput) => JSON.stringify([x.title, x.data, x.design, x.job_text, x.cover_letter ?? ""]);
  return pick(a) === pick(b);
}

function SaveState({
  state,
  revision,
  error,
  onRetry,
  onLoadLatest,
  onKeepMine,
}: {
  state: SaveStatus;
  /** The revision the server confirmed: shown as "Saved • v3". */
  revision?: number;
  error?: string;
  onRetry: () => void;
  onLoadLatest: () => void;
  onKeepMine: () => void;
}) {
  if (state === "conflict") {
    return (
      <span role="alert" className="inline-flex flex-wrap items-center gap-1.5 text-xs text-amber-800 dark:text-amber-200">
        Saved in another tab or device since you opened it. Not saved here:
        <button type="button" onClick={onLoadLatest} className={cx("rounded font-medium underline", focusRing)}>
          Load the latest
        </button>
        or
        <button type="button" onClick={onKeepMine} className={cx("rounded font-medium underline", focusRing)}>
          Keep mine
        </button>
      </span>
    );
  }
  if (state === "saved" || state === "saving" || state === "dirty") {
    // One pill that changes in place: "Saving…" (a breathing dot), then "Saved • v3" as the check draws in. Typing
    // ("dirty") keeps the last confirmed look until the save starts, so the bar doesn't flicker on every key.
    const saved = state !== "saving";
    return (
      <span
        role="status"
        aria-live="polite"
        className={cx(
          "save-pill inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium tabular-nums ring-1 transition-colors duration-quick",
          saved
            ? "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-200"
            : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
        )}
      >
        {saved ? (
          <svg key={revision ?? 0} viewBox="0 0 16 16" className="save-check h-3.5 w-3.5" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="save-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        )}
        {saved ? <>Saved{revision ? <span> • v{revision}</span> : null}</> : "Saving…"}
      </span>
    );
  }
  return (
    <span role="status" className={cx("text-xs", state === "error" ? "text-rose-600" : "text-zinc-500 dark:text-zinc-400")}>
      {state === "error" ? (
        <span className="inline-flex items-center gap-1.5">
          Not saved: {error ?? "try again"}
          <button type="button" onClick={onRetry} className={cx("rounded font-medium underline", focusRing)}>
            Retry
          </button>
        </span>
      ) : (
        "Saving…"
      )}
    </span>
  );
}

/** A Word copy for portals and recruiters that ask for .docx: one plain column, which ATS software reads best. */
function DownloadWord({ resume, confirm }: { resume: Resume; confirm: () => Promise<boolean> }) {
  const backend = useBackend();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <Button
      variant="secondary"
      disabled={state === "busy"}
      title="Download a Word copy (.docx): one plain column, no photo, which ATS software reads best"
      onClick={async () => {
        if (!(await confirm())) return;
        setState("busy");
        backend.tools
          .resumeDocx(resume.data, resume.design)
          .then((blob) => {
            downloadText(`${fileName(resume)}.docx`, blob, blob.type);
            setState("idle");
          })
          .catch(() => setState("error"));
      }}
    >
      <FileText className="h-4 w-4" />
      {state === "busy" ? "Preparing…" : state === "error" ? "Couldn't download, try again" : "Word"}
    </Button>
  );
}

/** "Sam Lee - Resume" (or "- Cover letter"), from the name on the resume or its title, safe as a file name. */
function fileName(resume: Resume, kind: "Resume" | "Cover letter" = "Resume"): string {
  const name = resume.data.basics.name.trim();
  const base = name ? `${name} - ${kind}` : kind === "Resume" ? resume.title.trim() : `${resume.title.trim()} - ${kind}`;
  return base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || kind;
}

/** A page drawn at real size and scaled to fit its column: the refs to attach, the scale, and its real height. */
function useScaledPage(size: ResumeDesign["page"]) {
  const box = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [realHeight, setRealHeight] = useState(0);
  useLayoutEffect(() => {
    const pageWidth = PAGE_MM[size].w * MM_TO_PX;
    const measure = () => {
      setScale(Math.min(1, (box.current?.clientWidth ?? pageWidth) / pageWidth));
      setRealHeight(page.current?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (page.current) ro.observe(page.current);
    return () => ro.disconnect();
  }, [size]);
  return { box, page, scale, realHeight };
}

const ScaledLetter = memo(function ScaledLetter({ data, design, text }: { data: ResumeData; design: ResumeDesign; text: string }) {
  const { box, page, scale, realHeight } = useScaledPage(design.page);
  return (
    <div ref={box} className="w-full" aria-label="Cover letter preview" role="img" style={{ height: realHeight * scale }}>
      <div ref={page} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }} className="overflow-hidden rounded-sm shadow-xl ring-1 ring-black/5">
        <LetterPreview data={data} design={design} text={text} />
      </div>
    </div>
  );
});

/** The page at real size, scaled down to fit the column, with where page 2 (and 3…) would start when printed. */
/** The preview element for a path: the line itself, else what it's part of ("experience.<id>.bullets.+" -> the role). */
function previewTarget(root: Element, path: string): HTMLElement | null {
  for (let p = path; p; p = p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "") {
    const el = root.querySelector<HTMLElement>(`[data-rpath="${CSS.escape(p)}"]`);
    if (el) return el;
  }
  return null;
}

/** Re-drawn only when what it shows changes: its callbacks are stable (useLatestCallback) and the marked paths and
 *  keywords are compared by value, as the editor builds new arrays every render. */
const ScaledPage = memo(function ScaledPage({
  data,
  design,
  onFit,
  onShorten,
  shortening = false,
  highlight = [],
  keywords = [],
}: {
  data: ResumeData;
  design: ResumeDesign;
  /** The job post's keywords on the resume, marked on the page (previewKeywords.ts; screen only). */
  keywords?: string[];
  onFit: (design: ResumeDesign) => void;
  /** When the layout alone can't fit one page: shorten the longest lines with AI, this many printed lines over. */
  onShorten?: (linesOver: number) => void;
  shortening?: boolean;
  highlight?: string[];
}) {
  const { box, page, scale, realHeight } = useScaledPage(design.page);
  // Mark what's being looked at, and bring the first one into view inside the preview column (not the whole page).
  const marked = highlight.join("|");
  useLayoutEffect(() => {
    const root = page.current;
    if (!root) return;
    const els = [...new Set(highlight.map((p) => previewTarget(root, p)).filter((el): el is HTMLElement => Boolean(el)))];
    els.forEach((el) => el.classList.add("resume-hl"));
    const first = els[0];
    const scroller = root.closest<HTMLElement>("[data-preview-scroll]");
    if (first && scroller && scroller.scrollHeight > scroller.clientHeight) {
      const r = first.getBoundingClientRect();
      const c = scroller.getBoundingClientRect();
      if (r.top < c.top || r.bottom > c.bottom) {
        scroller.scrollTo({ top: scroller.scrollTop + r.top - c.top - c.height / 3, behavior: "smooth" });
      }
    }
    return () => els.forEach((el) => el.classList.remove("resume-hl"));
  }, [marked, data, design, scale]); // eslint-disable-line react-hooks/exhaustive-deps -- `marked` stands for `highlight`
  const kw = keywords.join("|");
  useLayoutEffect(() => {
    const root = page.current;
    return root ? paintKeywords(root, keywords) : undefined;
  }, [kw, data, design, scale]); // eslint-disable-line react-hooks/exhaustive-deps -- `kw` stands for `keywords`
  const [fitting, setFitting] = useState(false);
  const [fitNote, setFitNote] = useState<string | null>(null);
  // Printed lines still over one page at the most compact layout, once Fit to one page has tried them all.
  const [over, setOver] = useState(0);
  const { pages, breaks } = pageLayout(realHeight, design);
  useEffect(() => {
    setFitNote(null);
    setOver(0);
  }, [data]);
  // Printing keeps each role, project and school whole, so a break inside one moves to its top: show it there.
  const [guides, setGuides] = useState<number[]>([]);
  const breakKey = breaks.join(",");
  useLayoutEffect(() => {
    const root = page.current?.firstElementChild;
    if (!root || !breaks.length) {
      setGuides([]);
      return;
    }
    const top = root.getBoundingClientRect().top;
    const entries = [...root.querySelectorAll(".break-inside-avoid")].map((el) => {
      const r = el.getBoundingClientRect();
      return [(r.top - top) / scale, (r.bottom - top) / scale] as const;
    });
    setGuides(breaks.map((y) => entries.find(([a, b]) => a < y && y < b)?.[0] ?? y));
  }, [breakKey, scale, data]); // eslint-disable-line react-hooks/exhaustive-deps -- breaks is new each render; breakKey tracks it
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", pages === 1 ? "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300" : pages === 2 ? "bg-sky-500/10 text-sky-800 ring-sky-500/25 dark:text-sky-300" : "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200")}>
          <FileText className="h-3.5 w-3.5" /> {pages} page{pages === 1 ? "" : "s"}
        </span>
        {pages > 2 && <span className="text-xs text-zinc-600 dark:text-zinc-400">Recruiters rarely read past page 2: trim older roles.</span>}
        {pages > 1 && (
          <Button size="sm" variant="ghost" disabled={fitting} onClick={() => { setFitNote(null); setOver(0); setFitting(true); }}>
            Fit to one page
          </Button>
        )}
        {fitNote && <span role="status" className="text-xs text-zinc-600 dark:text-zinc-400">{fitNote}</span>}
        {over > 0 && pages > 1 && onShorten && (
          <Button size="sm" variant="secondary" disabled={shortening} onClick={() => onShorten(over)} title="The AI tightens your longest lines, keeping every number and tool. You accept or skip each. Uses 1 resume credit.">
            <Sparkles className="h-3.5 w-3.5" /> Shorten with AI
          </Button>
        )}
      </div>
      <div ref={box} className="relative w-full" aria-label={`Resume preview, ${pages} page${pages === 1 ? "" : "s"}`} role="img" style={{ height: realHeight * scale }}>
        <div ref={page} data-resume-preview="" inert style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }} className="overflow-hidden rounded-sm shadow-xl ring-1 ring-black/5">
          <ResumePreview data={data} design={design} />
        </div>
        {guides.map((y, i) => (
          <div key={i} aria-hidden className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-sky-500/70" style={{ top: Math.max(0, y * scale - 3) }}>
            <span className="absolute right-1 top-0 -translate-y-full rounded-t bg-sky-500 px-1.5 py-px text-[0.625rem] font-medium text-white">Page {i + 2} starts</span>
          </div>
        ))}
      </div>
      {fitting && (
        <FitMeasurer
          data={data}
          candidates={fitCandidates(design).length ? fitCandidates(design) : [design]}
          onDone={(fit, linesOver) => {
            setFitting(false);
            if (fit) {
              onFit(fit);
              setFitNote(`Fitted: ${fit.spacing} spacing, ${fit.font_size} pt text.`);
            } else {
              setOver(linesOver);
              setFitNote(
                onShorten
                  ? `Still about ${linesOver} line${linesOver === 1 ? "" : "s"} over at the smallest readable size. Shorten the longest lines with AI (every number and tool kept), trim older roles, or keep two pages.`
                  : "Still over a page at the smallest readable size. Trim older roles or bullets, or keep two pages.",
              );
            }
          }}
        />
      )}
    </div>
  );
}, (a, b) =>
  a.data === b.data && a.design === b.design && a.onFit === b.onFit && a.onShorten === b.onShorten &&
  a.shortening === b.shortening && (a.highlight ?? []).join("|") === (b.highlight ?? []).join("|") &&
  (a.keywords ?? []).join("|") === (b.keywords ?? []).join("|"));

/** A callback that is the same function every render but always runs the latest one it was given (so a memoized
 *  child can take it without re-rendering, and never calls an outdated closure). */
function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Designs to try, least change first: tighter spacing, then smaller text down to 9.5 pt. */
function fitCandidates(d: ResumeDesign): ResumeDesign[] {
  const order: ResumeSpacing[] = ["relaxed", "normal", "compact"];
  const out: ResumeDesign[] = order.slice(order.indexOf(d.spacing) + 1).map((spacing) => ({ ...d, spacing }));
  for (let size = d.font_size - 0.5; size >= 9.5; size -= 0.5) out.push({ ...d, spacing: "compact", font_size: size });
  return out;
}

/** How many printed lines a resume `heightPx` tall is over one page in `design` (at least 1). */
function overflowLines(heightPx: number, design: ResumeDesign): number {
  const pageH = PAGE_MM[design.page].h * MM_TO_PX;
  const pad = Math.max(0, pageH - (pageLayout(Math.max(heightPx, 2 * pageH), design).breaks[0] ?? pageH)); // break 1 = pageH - pad
  const lineHeight = LINE_HEIGHTS.find((l) => l.id === (design.line_height ?? "normal"))?.value ?? 1.4;
  return linesOver(heightPx - 2 * pad, pageH - 2 * pad, design.font_size, lineHeight);
}

/** Lays the candidates out off-screen, once, and reports the first that fits on one page (or null, with how many
 *  lines the last, most compact one is still over). */
function FitMeasurer({ data, candidates, onDone }: { data: ResumeData; candidates: ResumeDesign[]; onDone: (fit: ResumeDesign | null, linesOver: number) => void }) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useLayoutEffect(() => {
    const fit = candidates.find((c, i) => pageLayout(refs.current[i]?.offsetHeight ?? Infinity, c).pages === 1) ?? null;
    const last = candidates.length - 1;
    const tightest = candidates[last];
    onDone(fit, fit || !tightest ? 0 : overflowLines(refs.current[last]?.offsetHeight ?? 0, tightest));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- measured once, on mount
  return createPortal(
    <div aria-hidden className="print:hidden" style={{ position: "fixed", left: -100_000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
      {candidates.map((c, i) => (
        <div key={i} ref={(el) => { refs.current[i] = el; }} style={{ width: "max-content" }}>
          <ResumePreview data={data} design={c} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** What "Download PDF" prints: the resume (or the cover letter) alone, at real size, on A4 or Letter. */
const PrintCopy = memo(function PrintCopy({ data, design, letter }: { data: ResumeData; design: ResumeDesign; letter: string | null }) {
  const flow = letter !== null || design.template !== "sidebar";
  return createPortal(
    <div className={cx("resume-print", flow && "resume-print-flow")}>
      <style>{`@page { size: ${design.page === "letter" ? "letter" : "A4"}; margin: 0; }`}</style>
      {letter !== null ? <LetterPreview data={data} design={design} text={letter} /> : <ResumePreview data={data} design={design} />}
    </div>,
    document.body,
  );
});

const LETTER_TONES: ReadonlyArray<{ id: CoverLetterTone; label: string }> = [
  { id: "professional", label: "Professional" },
  { id: "warm", label: "Warm" },
  { id: "confident", label: "Confident" },
];
const LETTER_LENGTHS: ReadonlyArray<{ id: CoverLetterLength; label: string }> = [
  { id: "short", label: "Short · 150-200 words" },
  { id: "standard", label: "Standard · 250-350" },
];

function LetterPanel({ resume, onText, onShowJob, onPrint }: { resume: Resume; onText: (text: string) => void; onShowJob: () => void; onPrint: () => void }) {
  const backend = useBackend();
  const { refresh } = useAllowance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [word, setWord] = useState<"idle" | "busy" | "error">("idle");
  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [length, setLength] = useState<CoverLetterLength>("standard");
  const text = resume.cover_letter;
  const hasJob = Boolean(resume.job_text.trim());
  const fills = text.match(FILL) ?? [];

  const write = async () => {
    if (text.trim() && !(await confirmDialog({ title: "Write a new letter?", body: "This replaces the letter below, with your edits. Undo brings it back.", confirmLabel: "Write a new one" }))) return;
    setBusy(true);
    setError(null);
    setUpgrade(false);
    try {
      onText((await backend.tools.coverLetter(resume.data, resume.job_text, { tone, length })).text);
    } catch (err) {
      setError(errorText(err));
      setUpgrade(isUpgradeError(err));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const okToDownload = () =>
    fills.length
      ? confirmDialog({
          title: "Some placeholders aren't filled in",
          body: `${fills.length} placeholder${fills.length === 1 ? "" : "s"} like ${fills[0]} would print as-is. Download anyway?`,
          confirmLabel: "Download anyway",
        })
      : Promise.resolve(true);

  return (
    <div className="space-y-4">
      <Panel title="Cover letter" spot="letter">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          Written from your resume and the job post, ready to send. It never invents facts or numbers: it uses what your
          resume says. Edit it freely: it's saved with this resume.
        </p>
        {!hasJob && (
          <p className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
            Add the job post first for a letter aimed at that job.
            <Button size="sm" variant="secondary" onClick={onShowJob}>
              <Upload className="h-3.5 w-3.5" /> Add a job post
            </Button>
          </p>
        )}
        <div className="mb-3 flex flex-wrap gap-4">
          <Segmented label="Tone" options={LETTER_TONES} value={tone} onChange={setTone} />
          <Segmented label="Length" options={LETTER_LENGTHS} value={length} onChange={setLength} />
        </div>
        <Button disabled={busy} onClick={() => void write()}>
          <Sparkles className="h-4 w-4" /> {busy ? "Writing…" : text.trim() ? "Write a new one" : "Write my cover letter"}
        </Button>
        <AiCostNote className="mt-2" />
        {error && (upgrade ? <AiErrorNote className="mt-2" error={error} upgrade /> : <p className="mt-2 text-sm text-rose-600">{error}</p>)}
      </Panel>
      {busy && <WorkingState compact kind="writing" label="Writing your letter" />}
      {(text || !busy) && (
        <Panel title="Your letter" action={fills.length > 0 ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">{fills.length} to fill in</span> : undefined}>
          <Textarea aria-label="Letter text" rows={18} maxLength={6000} value={text} onChange={(e) => onText(e.target.value)} placeholder="Write it yourself, or let the AI draft it above." />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!text.trim()}
              onClick={() =>
                void navigator.clipboard.writeText(text).then(
                  () => toast("Copied"),
                  () => toast({ message: "Couldn't copy", tone: "error" }),
                )
              }
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
            <Button
              variant="secondary"
              disabled={!text.trim() || word === "busy"}
              onClick={async () => {
                if (!(await okToDownload())) return;
                setWord("busy");
                backend.tools
                  .coverLetterDocx(text, resume.data, resume.design)
                  .then((blob) => {
                    downloadText(`${fileName(resume, "Cover letter")}.docx`, blob, blob.type);
                    setWord("idle");
                  })
                  .catch(() => setWord("error"));
              }}
            >
              <FileText className="h-4 w-4" /> {word === "busy" ? "Preparing…" : word === "error" ? "Couldn't download, try again" : "Word"}
            </Button>
            <Button disabled={!text.trim()} onClick={() => void okToDownload().then((ok) => ok && onPrint())}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((part, i) =>
        part.kind === "fill" ? (
          <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100">[{part.text}]</mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Panel({ title, children, action, spot }: { title: string; children: ReactNode; action?: ReactNode; spot?: SpotKind }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-3 font-display text-base font-semibold">{spot && <Spot kind={spot} />}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ScorePanel({
  resume,
  report,
  onJob,
  onAddSkill,
  onShow,
  fixing,
  onFix,
  result,
  onPoint,
  showKeywords,
  onShowKeywords,
}: {
  resume: Resume;
  report: AtsReport | null;
  onJob: (text: string) => void;
  onAddSkill: (keyword: string) => void;
  onShow: (target: string | null) => void;
  /** The check being fixed ("all" for everything), while it runs. */
  fixing: string | null;
  /** Fix one check by id, or everything (null). */
  onFix: (check: string | null) => void;
  /** What the last fix did and what it needs from the candidate. */
  result: ReactNode;
  /** The lines a hovered check is about, for the preview to mark (empty: none). */
  onPoint: (paths: string[]) => void;
  /** The job's keywords marked on the preview. */
  showKeywords: boolean;
  onShowKeywords: (on: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);
  if (!report) return <Spinner label="Scoring" state="searching" />;
  const failed = report.checks.filter((c) => !c.passed).sort((a, b) => b.max_points - b.points - (a.max_points - a.points));
  const passed = report.checks.filter((c) => c.passed);
  const fixable = failed.filter((c) => fixKind(c) !== "you" && (c.category !== "keywords" || report.has_job)).length;

  return (
    <div className="space-y-4">
      <Panel title="How ATS software reads it" spot="ats">
        <div className="flex items-center gap-4">
          <div className={cx("relative flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl ring-1", scoreTone(report.score))}>
            <ScoreCount score={report.score} className="font-display text-3xl font-semibold" />
            <span className="text-xs">of 100</span>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            {report.categories.map((c) => (
              <div key={c.id} className="text-xs">
                <div className="flex justify-between">
                  <span>{c.label}</span>
                  <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                    {Math.round(c.points)}/{c.max_points}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-zinc-500/15" aria-hidden>
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(100 * c.points) / c.max_points}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {!report.has_job && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Add the job post below to also check its keywords, which is a quarter of the score.</p>}
      </Panel>

      <Panel title="Job post" spot="jobpost">
        <Field label="Paste the job post to tailor the resume to it" htmlFor="job">
          <Textarea id="job" rows={5} maxLength={20_000} value={resume.job_text} onChange={(e) => onJob(e.target.value.slice(0, 20_000))} placeholder="Paste the job description…" />
        </Field>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setImporting(true);
            setImportError(null);
            api
              .importJobLink(url.trim())
              .then((job) => {
                onJob(job.text.slice(0, 20_000));
                setUrl("");
              })
              .catch((err: unknown) => setImportError(errorText(err)))
              .finally(() => setImporting(false));
          }}
        >
          <Input aria-label="Job post link" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or import it from a link: https://" className="flex-1" />
          <Button type="submit" variant="secondary" disabled={importing || url.trim().length < 8}>
            <Link2 className="h-4 w-4" /> {importing ? "Importing…" : "Import"}
          </Button>
        </form>
        {importError && <p className="mt-2 text-sm text-rose-600">{importError}</p>}
        {!resume.job_text.trim() && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            No job in mind yet?{" "}
            <Link to={jobsForResume(resume.id)} className={cx("inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              <Briefcase className="h-3.5 w-3.5" aria-hidden /> Find jobs that match this resume
            </Link>{" "}
            in Jobs.
          </p>
        )}
        {report.keywords && (
          <div className="mt-4 space-y-3 text-sm">
            {report.keywords.missing.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium">Missing keywords: add the ones you really have</p>
                <ul className="flex flex-wrap gap-1.5">
                  {report.keywords.missing.map((k) => (
                    <li key={k}>
                      <button
                        type="button"
                        onClick={() => onAddSkill(k)}
                        title={`Add “${k}” to your skills`}
                        className={cx("inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-900 ring-1 ring-amber-500/25 hover:bg-amber-500/20 dark:text-amber-200", focusRing)}
                      >
                        <Plus className="h-3 w-3" /> {k}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.keywords.matched.length > 0 && (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Already on your resume</p>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    <input type="checkbox" checked={showKeywords} onChange={(e) => onShowKeywords(e.target.checked)}
                           className="h-3.5 w-3.5 accent-emerald-600" />
                    Highlight them on the preview
                  </label>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {report.keywords.matched.map((k) => (
                    <li key={k} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-800 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                      <Check className="h-3 w-3" /> {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title={failed.length ? `${failed.length} fix${failed.length === 1 ? "" : "es"} to make` : "Nothing left to fix"}
        action={
          fixable > 0 ? (
            <Button size="sm" disabled={Boolean(fixing)} onClick={() => onFix(null)}>
              <Sparkles className="h-3.5 w-3.5" /> Fix everything with AI
            </Button>
          ) : undefined
        }
      >
        {fixable > 0 && (
          <p className="-mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Rewrites every flagged line, adds what's missing, then checks the score again. One resume credit for the whole
            resume; fixing a single check costs only a fraction of one, and fixes that need no AI are free. Anything not
            in your resume yet is shown for you to keep or skip.
          </p>
        )}
        {fixable > 0 && <AiCostNote fix className="-mt-2 mb-3" />}
        <div className="mb-3 empty:hidden">{result}</div>
        <ul className="space-y-2">
          {failed.map((c) => (
            <li
              key={c.id}
              onMouseEnter={() => onPoint(c.paths?.length ? c.paths : c.target ? [c.target] : [])}
              onMouseLeave={() => onPoint([])}
              onFocus={() => onPoint(c.paths?.length ? c.paths : c.target ? [c.target] : [])}
              onBlur={() => onPoint([])}
              className="rounded-xl border border-zinc-200 p-3 transition-colors hover:border-indigo-400/50 dark:border-white/10"
            >
              <div className="flex items-start gap-2">
                <Spot kind={ATS_SPOT[c.category]} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {c.label} <span className="font-normal tabular-nums text-zinc-500 dark:text-zinc-400">+{Math.round((c.max_points - c.points) * 10) / 10} pts</span>
                  </p>
                  {c.fix && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{c.fix}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <FixActions check={c} report={report} busy={Boolean(fixing)} onFix={onFix} onShow={onShow} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {passed.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setShowPassed((v) => !v)} className={cx("text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              {showPassed ? "Hide" : "Show"} {passed.length} passed check{passed.length === 1 ? "" : "s"}
            </button>
            {showPassed && (
              <ul className="mt-2 space-y-1 text-sm">
                {passed.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                    <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" /> {c.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
      <AtsReadingPanel data={resume.data} />
    </div>
  );
}

/**
 * "How an ATS reads it" (after OpenResume's parser test): the page's text in the order a parser gets it, and what it
 * would trip on: contact details it can't find, headings it doesn't know, dates it can't read, a sidebar read first,
 * icon characters. Read from the on-screen preview when opened, so it's the real layout's order.
 */
function AtsReadingPanel({ data }: { data: ResumeData }) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [copied, setCopied] = useState(false);
  const read = () => {
    const el = document.querySelector<HTMLElement>("[data-resume-preview]");
    setReading(atsReading(el?.innerText ?? resumeToText(data), data));
  };
  useEffect(() => {
    if (reading) read();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read an open view when the resume changes
  const ok = (good: boolean, yes: string, no: string) => (
    <li className="flex items-start gap-2">
      {good ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />}
      <span>{good ? yes : no}</span>
    </li>
  );
  return (
    <Panel title="How an ATS reads it" spot="readability">
      {!reading ? (
        <div className="space-y-2 text-sm">
          <p className="text-zinc-600 dark:text-zinc-300">
            Applicant tracking software reads your resume as plain text before anyone sees the design. See exactly what it gets, and what it might miss.
          </p>
          <Button size="sm" variant="secondary" onClick={read}>
            <ScanText className="h-3.5 w-3.5" /> Read it like an ATS
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <ul className="space-y-1.5">
            {ok(reading.nameFirst, "Your name comes first, so it's read as your name.", "Your name isn't the first thing on the page: a parser may take another line for your name. A one-column template fixes it.")}
            {ok(reading.found.email && reading.found.phone, `Email and phone found${reading.found.links ? `, and ${reading.found.links} link${reading.found.links === 1 ? "" : "s"}` : ""}.`,
              `${[!reading.found.email && "No email", !reading.found.phone && "no phone number"].filter(Boolean).join(" and ")} found in the text. Recruiters can't reach you without them.`)}
            {ok(reading.headings.every((h) => h.recognized), "Every section heading is one parsers know.",
              `Parsers may not know ${reading.headings.filter((h) => !h.recognized).map((h) => `“${h.heading}”`).join(", ")}: use a standard name like Experience, Education, Skills or Projects.`)}
            {ok(!reading.unreadableDates.length, "Every role's dates read as dates.",
              `Dates a parser can't read for ${reading.unreadableDates.join(", ")}: write them like “Jan 2021 – Present”.`)}
            {ok(!reading.oddCharacters.length, "No icons or symbols that parsers drop.",
              `Symbols parsers drop or garble: ${reading.oddCharacters.join(" ")}. Use plain words instead.`)}
          </ul>
          <details>
            <summary className={cx("cursor-pointer select-none text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              The text it gets
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-500/[0.06] p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              {reading.text}
            </pre>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => void navigator.clipboard?.writeText(reading.text).then(() => setCopied(true))}>
              <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy the plain text"}
            </Button>
          </details>
        </div>
      )}
    </Panel>
  );
}

function AiPanel({
  hasJob,
  busy,
  error,
  upgrade,
  queue,
  onAsk,
  onAccept,
  onAcceptSafe,
  onSkip,
  onShowJob,
}: {
  hasJob: boolean;
  busy: string | null;
  error: string | null;
  upgrade: boolean;
  queue: ResumeSuggestion[];
  onAsk: (mode: "improve" | "tailor") => void;
  onAccept: (s: ResumeSuggestion, picked?: string[]) => void;
  onAcceptSafe: () => void;
  onSkip: (s: ResumeSuggestion) => void;
  onShowJob: () => void;
}) {
  const current = queue[0];
  const safe = queue.filter(isSafeFix).length;
  return (
    <div className="space-y-4">
      <Panel title="Let the AI fix it" spot="rewrite">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          It rewrites weak lines, adds the skills and bullets you're missing, makes the impact of each line clear and tidies dates, one change at a time: you accept or skip each. Every suggestion is finished, ready-to-use text. It never makes up numbers: it uses the ones in your resume, and where there are none it shows the impact in words. Anything it can't prove from your resume comes with a warning to check it's true.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={Boolean(busy)} onClick={() => onAsk("improve")}>
            <Wand2 className="h-4 w-4" /> Improve my resume
          </Button>
          <Button variant="secondary" disabled={Boolean(busy) || !hasJob} onClick={() => onAsk("tailor")} title={hasJob ? undefined : "Add the job post first"}>
            <Sparkles className="h-4 w-4" /> Tailor to the job
          </Button>
          {!hasJob && (
            <Button variant="ghost" onClick={onShowJob}>
              <Upload className="h-4 w-4" /> Add a job post
            </Button>
          )}
        </div>
        <AiCostNote className="mt-2" />
      </Panel>
      {busy && <WorkingState compact kind={({ searching: "reading", weaving: "matching", composing: "writing" } as const)[busyState(busy)]} label={busy} />}
      {error && !busy && <AiErrorNote error={error} upgrade={upgrade} />}
      {safe > 0 && !busy && (
        <Button variant="secondary" onClick={onAcceptSafe}>
          <Check className="h-4 w-4" /> Apply the {safe} safe fix{safe === 1 ? "" : "es"} at once
        </Button>
      )}
      {current && !busy && <SuggestionCard key={current.id} s={current} total={queue.length} onAccept={onAccept} onSkip={onSkip} />}
    </div>
  );
}

const ACCEPT_LABEL = { rewrite: "Accept", set: "Accept", add_skill: "Add skills", add_bullet: "Add bullet" } as const;

function SuggestionCard({ s, total, onAccept, onSkip }: { s: ResumeSuggestion; total: number; onAccept: (s: ResumeSuggestion, picked?: string[]) => void; onSkip: (s: ResumeSuggestion) => void }) {
  const kind = s.kind ?? "rewrite";
  const skills = kind === "add_skill" ? suggestedSkills(s) : [];
  const [off, setOff] = useState<Set<string>>(new Set());
  const picked = skills.filter((x) => !off.has(x));
  const toggle = (skill: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (!next.delete(skill)) next.add(skill);
      return next;
    });
  return (
    <Panel title={`Suggestion 1 of ${total}`}>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{s.label}</p>
      {kind === "add_skill" ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Skills to add">
          {skills.map((skill) => (
            <button
              key={skill}
              type="button"
              aria-pressed={!off.has(skill)}
              onClick={() => toggle(skill)}
              className={cx(
                "rounded-full border px-2.5 py-1 text-sm transition-colors",
                off.has(skill)
                  ? "border-zinc-200 text-zinc-400 line-through dark:border-white/10 dark:text-zinc-500"
                  : "border-emerald-500/40 bg-emerald-500/10 text-zinc-900 dark:text-zinc-100",
                focusRing,
              )}
            >
              {off.has(skill) ? <X className="mr-1 inline h-3 w-3" aria-hidden /> : <Plus className="mr-1 inline h-3 w-3" aria-hidden />}
              {skill}
            </button>
          ))}
        </div>
      ) : (
        <InlineResumeDiff before={s.before ?? ""} after={s.after} afterContent={<Highlighted text={s.after} />} />
      )}
      {s.reason && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{s.reason}</p>}
      {s.confirm && (
        <p role="note" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-950 dark:text-amber-100">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {s.confirm}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button disabled={kind === "add_skill" && !picked.length} onClick={() => onAccept(s, kind === "add_skill" ? picked : undefined)}>
          <Check className="h-4 w-4" /> {ACCEPT_LABEL[kind]}
          {kind === "add_skill" && picked.length !== 1 ? ` (${picked.length})` : ""}
        </Button>
        <Button variant="secondary" onClick={() => onSkip(s)}>
          Skip
        </Button>
      </div>
    </Panel>
  );
}

/** A small segmented control for one design choice. */
function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div role="group" aria-label={label} className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            className={cx("rounded-lg px-3 py-1 text-sm", value === o.id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500", focusRing)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A thumbnail of a template's layout, in the chosen colour: header shape, headings, columns. */
function TemplateSketch({ template, accent }: { template: ResumeDesign["template"]; accent: string }) {
  const line = (w: string, extra = "") => <span className={cx("block h-[3px] rounded-full bg-zinc-300 dark:bg-zinc-600", extra)} style={{ width: w }} />;
  const heading =
    template === "minimal" ? (
      <span className="block h-[3px] w-1/4 rounded-full bg-zinc-400" />
    ) : template === "executive" ? (
      <span className="block h-[5px] w-full rounded-sm" style={{ background: accent, opacity: 0.25, borderLeft: `2px solid ${accent}` }} />
    ) : template === "campus" || template === "harvard" ? (
      // A short heading over a hairline: left for Campus, centred for Harvard.
      <span className={cx("block border-b pb-0.5", template === "harvard" && "flex justify-center")} style={{ borderColor: accent }}>
        <span className="block h-[3px] w-1/4 rounded-full" style={{ background: accent }} />
      </span>
    ) : (
      <span className="block h-[3px] w-1/3 rounded-full" style={{ background: accent }} />
    );
  const body = (
    <span className="block space-y-1">
      {heading}
      {line("90%")}
      {line("75%")}
      {heading}
      {line("85%")}
      {line("60%")}
    </span>
  );
  return (
    <span aria-hidden className="block h-24 overflow-hidden rounded-lg bg-white p-2 ring-1 ring-black/5 dark:bg-zinc-100">
      {template === "sidebar" ? (
        <span className="flex h-full gap-1.5">
          <span className="block w-1/3 space-y-1 rounded p-1" style={{ background: accent, opacity: 0.18 }} />
          <span className="block flex-1">{body}</span>
        </span>
      ) : (
        <>
          {template === "bold" ? (
            <span className="-mx-2 -mt-2 mb-1.5 block px-2 py-1.5" style={{ background: accent }}>
              <span className="block h-[5px] w-1/2 rounded-full bg-white/90" />
            </span>
          ) : (
            <span className={cx("mb-1.5 block", ["classic", "elegant", "campus", "harvard"].includes(template) && "flex flex-col items-center")}>
              <span className="block h-[5px] w-1/2 rounded-full" style={{ background: ["modern", "executive"].includes(template) ? accent : "#3f3f46" }} />
              {template === "elegant" && <span className="mt-1 block h-[2px] w-full border-y border-zinc-400" />}
              {(template === "campus" || template === "harvard") && <span className="mt-1 block h-[2px] w-3/4 rounded-full bg-zinc-300" />}
            </span>
          )}
          {body}
        </>
      )}
    </span>
  );
}

function DesignPanel({ design, setDesign }: { design: ResumeDesign; setDesign: (patch: Partial<ResumeDesign>) => void }) {
  const country = useCountry();
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Panel title="Quick looks" spot="design">
        <p className="-mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">One click sets the template, colour and font together. Fine-tune below.</p>
        <div className="flex flex-wrap gap-2">
          {looksFor(country).map((look) => {
            const on = look.design.template === design.template && look.design.accent === design.accent && look.design.font === design.font;
            return (
              <button
                key={look.label}
                type="button"
                aria-pressed={on}
                onClick={() => setDesign(look.design)}
                className={cx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  on ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10",
                  focusRing,
                )}
              >
                <span aria-hidden className="h-3.5 w-3.5 rounded-full" style={{ background: look.design.accent }} />
                {look.label}
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title="Template" spot="sections">
        <div className="grid grid-cols-2 gap-2">
          {templatesFor(country).map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={design.template === t.id}
              onClick={() => setDesign({ template: t.id })}
              className={cx(
                "relative rounded-xl border p-3 text-left transition-colors",
                design.template === t.id ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10 dark:hover:border-white/20",
                focusRing,
              )}
            >
              <SelectCheck on={design.template === t.id} />
              <TemplateSketch template={t.id} accent={design.accent} />
              <span className="mt-2 block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t.note}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Colour & type" spot="colour">
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Accent colour</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Accent ${c}`}
                  aria-pressed={design.accent === c}
                  onClick={() => setDesign({ accent: c })}
                  style={{ background: c }}
                  className={cx(
                    "h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-zinc-950",
                    design.accent === c ? "ring-2 ring-zinc-900 dark:ring-white" : "ring-1 ring-black/10 dark:ring-white/25",
                    focusRing,
                    "focus-visible:outline-offset-4",
                  )}
                />
              ))}
              <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="color" value={design.accent} onChange={(e) => setDesign({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" />
                Custom
              </label>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Font" htmlFor="font">
              <Select id="font" value={design.font} onChange={(e) => setDesign({ font: e.target.value as ResumeDesign["font"] })}>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Page size" htmlFor="page">
              <Select id="page" value={design.page} onChange={(e) => setDesign({ page: e.target.value as ResumeDesign["page"] })}>
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
              </Select>
            </Field>
          </div>
          <Field label={`Text size: ${design.font_size} pt`} htmlFor="size">
            <input id="size" type="range" min={9} max={12.5} step={0.5} value={design.font_size} onChange={(e) => setDesign({ font_size: Number(e.target.value) })} className="w-full accent-indigo-600" />
          </Field>
          <Segmented
            label="Line spacing"
            options={LINE_HEIGHTS}
            value={design.line_height ?? "normal"}
            onChange={(line_height) => setDesign({ line_height })}
          />
          <Segmented
            label="Skills"
            options={[{ id: "list", label: "Comma list" }, { id: "tags", label: "Tags" }] as const}
            value={design.skills_style ?? "list"}
            onChange={(skills_style) => setDesign({ skills_style })}
          />
          <div>
            <p className="mb-1.5 text-sm font-medium">Spacing</p>
            <div className="inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
              {SPACING.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={design.spacing === s.id}
                  onClick={() => setDesign({ spacing: s.id })}
                  className={cx("rounded-lg px-3 py-1 text-sm", design.spacing === s.id ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500", focusRing)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="Photo" spot="photo">
        <div className="flex items-center gap-3">
          {design.photo ? <img src={design.photo} alt="Your photo" className="h-16 w-16 rounded-full object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-500/10 text-xs text-zinc-500">No photo</span>}
          <div className="flex flex-wrap gap-2">
            <input
              ref={photoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Choose a photo"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setPhotoError(null);
                photoToDataUrl(f)
                  .then((photo) => setDesign({ photo, show_photo: true }))
                  .catch((err: unknown) => setPhotoError(errorText(err)));
              }}
            />
            <Button size="sm" variant="secondary" onClick={() => photoRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {design.photo ? "Change" : "Add photo"}
            </Button>
            {design.photo && (
              <Button size="sm" variant="ghost" onClick={() => setDesign({ photo: null, show_photo: false })}>
                Remove
              </Button>
            )}
          </div>
        </div>
        {design.photo && (
          <div className="mt-3">
            <Toggle checked={design.show_photo} onChange={(show_photo) => setDesign({ show_photo })} label="Show photo on the resume" />
          </div>
        )}
        {photoError && <p className="mt-2 text-sm text-rose-600">{photoError}</p>}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Most ATS software ignores photos, and US, UK and Canadian employers often prefer none. Common in much of Europe and Asia.
        </p>
      </Panel>
    </div>
  );
}

/**
 * Below 1024 px the preview sits under the whole form, a long scroll away: a floating "Preview" button jumps there,
 * and hides while the preview is on screen. Wide screens show the two side by side, so it never appears there.
 */
function PreviewJump({ letter }: { letter: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = document.getElementById("resume-preview");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShown(Boolean(entry?.isIntersecting)), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (shown) return null;
  // Portalled: the page's entrance animation leaves a transform on an ancestor, which would pin a fixed element to
  // that ancestor instead of the screen.
  return createPortal(
    <button
      type="button"
      onClick={() => document.getElementById("resume-preview")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className={cx(
        "fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mx-auto inline-flex w-fit items-center gap-2 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-popover ring-1 ring-black/10 motion-ok:animate-fade-up md:bottom-6 lg:hidden dark:bg-white dark:text-zinc-900",
        focusRing,
      )}
    >
      <Eye className="h-4 w-4" aria-hidden="true" /> {letter ? "Preview letter" : "Preview"}
    </button>,
    document.body,
  );
}
