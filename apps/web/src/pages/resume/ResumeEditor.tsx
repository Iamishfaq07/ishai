import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Link, useLocation, useParams } from "react-router-dom";
import type { AtsCheck, AtsReport, Resume, ResumeData, ResumeDesign, ResumeSpacing, ResumeSuggestion } from "@orbit/types";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  FileText,
  Gauge,
  Link2,
  Mail,
  Palette,
  PenLine,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
  X,
  ApiError,
  confirmDialog,
  cx,
  focusRing,
  splitPlaceholders,
} from "@orbit/ui";
import { Button, ErrorNote, Field, Input, Select, Spinner, Textarea, Toggle } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";
import { ContentForm } from "./ContentForm";
import { ACCENTS, FONTS, SPACING, TEMPLATES, addSkills, applySuggestion, canApply, isSafeFix, newId, photoToDataUrl, resumeToText, suggestedSkills } from "./model";
import { LetterPreview, MM_TO_PX, PAGE_MM, ResumePreview, pageLayout } from "./ResumePreview";
import { scoreTone } from "./Resumes";

type Tab = "content" | "score" | "ai" | "design" | "letter";

/** What undo/redo restores: everything the user edits. */
type Snapshot = Pick<Resume, "title" | "data" | "design" | "job_text" | "cover_letter">;
const snapshot = (r: Resume): Snapshot => ({ title: r.title, data: r.data, design: r.design, job_text: r.job_text, cover_letter: r.cover_letter });
/** A bracketed cue the AI leaves for the user to fill in ("by [X%]"). */
const FILL = /\[[^\][\n]{1,160}\]/g;
const HISTORY_LIMIT = 100;
/** Edits closer together than this, in the same field, undo as one step (a burst of typing). */
const HISTORY_GROUP_MS = 1200;

const TABS: Array<{ id: Tab; label: string; icon: typeof FileText }> = [
  { id: "content", label: "Content", icon: PenLine },
  { id: "score", label: "ATS score", icon: Gauge },
  { id: "ai", label: "AI fixes", icon: Wand2 },
  { id: "design", label: "Design", icon: Palette },
  { id: "letter", label: "Cover letter", icon: Mail },
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

export function ResumeEditorPage() {
  const { resumeId = "" } = useParams();
  const location = useLocation();
  const [resume, setResume] = useState<Resume | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("content");
  const [report, setReport] = useState<AtsReport | null>(null);
  const [save, setSave] = useState<{ state: "saved" | "saving" | "dirty" | "error"; error?: string; retry?: boolean }>({
    state: "saved",
  });
  // One save at a time: on a slow connection a second PUT could otherwise overtake the first and the older text would
  // land last. When the running one finishes it bumps `flush`, which re-checks whether more edits are waiting.
  const saving = useRef(false);
  const [flush, setFlush] = useState(0);
  const [queue, setQueue] = useState<ResumeSuggestion[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    (location.state as { imported?: boolean } | null)?.imported
      ? "We imported your resume. Check each section: the AI reads most resumes well, but not perfectly."
      : null,
  );
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    api
      .getResume(resumeId)
      .then(setResume)
      .catch((err: unknown) => setLoadError(errorText(err)));
  }, [resumeId]);

  // Undo/redo. Typing in one field is one step; a pause, another field or a button starts the next.
  const latest = useRef(resume);
  latest.current = resume;
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; at: number; el: Element | null }>({ past: [], future: [], at: 0, el: null });
  const [steps, setSteps] = useState({ undo: 0, redo: 0 });
  const apply = useCallback((next: Resume) => {
    latest.current = next;
    setResume(next);
    setSave({ state: "dirty" });
    setSteps({ undo: history.current.past.length, redo: history.current.future.length });
  }, []);
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
  const setDesign = (patch: Partial<ResumeDesign>) => change((r) => ({ ...r, design: { ...r.design, ...patch } }));

  // Autosave, a moment after the last edit.
  useEffect(() => {
    if (!resume || save.state !== "dirty") return;
    const t = window.setTimeout(() => {
      if (saving.current) return;
      saving.current = true;
      setSave({ state: "saving" });
      const { title, data, design, job_text, cover_letter } = resume;
      api
        .updateResume(resume.id, { title: title.trim() || "Untitled resume", data, design, job_text, cover_letter })
        .then(() => setSave((s) => (s.state === "saving" ? { state: "saved" } : s)))
        // A dropped or stalled connection (status 0) is worth trying again on its own; a refusal is not.
        .catch((err: unknown) =>
          setSave({ state: "error", error: errorText(err), retry: err instanceof ApiError && err.status === 0 }),
        )
        .finally(() => {
          saving.current = false;
          setFlush((n) => n + 1);
        });
    }, 900);
    return () => window.clearTimeout(t);
  }, [resume, save.state, flush]);

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
  unsaved.current = save.state === "dirty" || save.state === "error";
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.state === "dirty" || save.state === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);
  useEffect(
    () => () => {
      const r = latest.current;
      if (r && unsaved.current) {
        void api
          .updateResume(r.id, { title: r.title.trim() || "Untitled resume", data: r.data, design: r.design, job_text: r.job_text, cover_letter: r.cover_letter })
          .catch(() => undefined);
      }
    },
    [],
  );

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
      api
        .scoreResume(resume.data, resume.design, resume.job_text, { signal: ctl.signal })
        .then((r) => {
          sentAt = null;
          scoreWait.current = Math.min(2_500, Math.max(450, performance.now() - started));
          setReport(r);
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
    setTab("content");
    setFocusTarget(target);
  };

  const askAi = async (mode: "improve" | "tailor", check?: string) => {
    if (!resume) return;
    setTab("ai");
    setAiBusy((check && FIX_BUSY[check]) || (mode === "tailor" ? "Tailoring to the job…" : check ? "Working on that fix…" : "Reading your resume…"));
    setAiError(null);
    try {
      const res = await api.suggestResume({ data: resume.data, design: resume.design, job_text: resume.job_text, mode, ...(check ? { check } : {}) });
      setQueue(res.suggestions);
      if (!res.suggestions.length) setAiError("Nothing to change: the AI thinks this already reads well.");
    } catch (err) {
      setAiError(errorText(err));
    } finally {
      setAiBusy(null);
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
    setQueue((q) => q.filter((x) => x.id !== s.id));
  };

  /** Every mechanical fix with nothing to confirm (extra skills the resume proves, dates), at once. */
  const acceptSafe = () => {
    const safe = queue.filter(isSafeFix);
    if (!safe.length) return;
    update((d) => safe.reduce((acc, s) => applySuggestion(acc, s, newId), d));
    setQueue((q) => q.filter((x) => !safe.includes(x)));
    setAiError(null);
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
  const printDoc = (kind: "resume" | "letter") => {
    if (!resume) return;
    flushSync(() => setPrinting(kind));
    const previous = document.title;
    document.title = fileName(resume, kind === "letter" ? "Cover letter" : "Resume");
    window.addEventListener(
      "afterprint",
      () => {
        document.title = previous;
        setPrinting("resume");
      },
      { once: true },
    );
    window.print();
  };

  if (loadError) return <ErrorNote>{loadError}</ErrorNote>;
  if (!resume) return <Spinner label="Opening your resume" />;

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/documents/resumes" aria-label="All resumes" className={cx("rounded-lg p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Input
          aria-label="Resume name"
          value={resume.title}
          maxLength={160}
          onChange={(e) => change((r) => ({ ...r, title: e.target.value }))}
          className="max-w-xs font-display text-lg font-semibold"
        />
        <SaveState state={save.state} error={save.error} />
        <div className="flex items-center">
          <HistoryButton label="Undo" shortcut="Ctrl+Z" disabled={!steps.undo} onClick={() => step("undo")}>
            <Undo2 className="h-4 w-4" />
          </HistoryButton>
          <HistoryButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!steps.redo} onClick={() => step("redo")}>
            <Redo2 className="h-4 w-4" />
          </HistoryButton>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {report && (
            <button
              type="button"
              onClick={() => setTab("score")}
              className={cx("flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1", scoreTone(report.score), focusRing)}
              aria-label={`ATS score ${report.score} out of 100, ${report.verdict}. Show details`}
            >
              <span className="font-display text-xl font-semibold tabular-nums">{report.score}</span>
              <span className="text-left text-xs leading-tight">
                ATS score
                <br />
                {report.verdict}
              </span>
            </button>
          )}
          <SaveToDocuments resume={resume} />
          <DownloadWord resume={resume} confirm={okToDownload} />
          <Button onClick={() => void okToDownload().then((ok) => ok && printDoc("resume"))}>
            <Download className="h-4 w-4" /> Download PDF
          </Button>
        </div>
      </div>

      {notice && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-900 dark:text-indigo-200">
          <span className="flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className={cx("rounded p-0.5", focusRing)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-w-0">
          <div role="tablist" aria-label="Resume editor" className="sticky top-16 z-10 mb-4 flex gap-1 rounded-xl bg-zinc-100/90 p-1 backdrop-blur-sm dark:bg-zinc-900/90">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                aria-label={label}
                type="button"
                onClick={() => setTab(id)}
                className={cx(
                  "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium",
                  tab === id ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  focusRing,
                )}
              >
                {/* Icons alone on phones; labels alone where the column is narrow; both when there's room. */}
                <Icon className="h-4 w-4 shrink-0 sm:max-xl:hidden" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
                {id === "ai" && queue.length > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[0.625rem] text-white">{queue.length}</span>}
              </button>
            ))}
          </div>

          {tab === "content" && <ContentForm data={resume.data} update={update} />}
          {tab === "score" && (
            <ScorePanel
              resume={resume}
              report={report}
              onJob={(job_text) => change((r) => ({ ...r, job_text }))}
              onAddSkill={(kw) => update((d) => addSkills(d, [kw], newId))}
              onShow={showTarget}
              onFixWithAi={(check) => void askAi(check.category === "keywords" ? "tailor" : "improve", check.id)}
            />
          )}
          {tab === "ai" && (
            <AiPanel
              hasJob={Boolean(resume.job_text.trim())}
              busy={aiBusy}
              error={aiError}
              queue={queue}
              onAsk={(mode) => void askAi(mode)}
              onAccept={accept}
              onAcceptSafe={acceptSafe}
              onSkip={(s) => setQueue((q) => q.filter((x) => x.id !== s.id))}
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
        </div>

        <div className="min-w-0">
          <div className="sticky top-20 space-y-3">
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
              <ScaledLetter data={resume.data} design={resume.design} text={resume.cover_letter} />
            ) : (
              <ScaledPage data={resume.data} design={resume.design} onFit={(design) => change((r) => ({ ...r, design }))} />
            )}
          </div>
        </div>
      </div>
      <PrintCopy data={resume.data} design={resume.design} letter={printing === "letter" ? resume.cover_letter : null} />
    </div>
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

function SaveState({ state, error }: { state: "saved" | "saving" | "dirty" | "error"; error?: string }) {
  return (
    <span role="status" className={cx("text-xs", state === "error" ? "text-rose-600" : "text-zinc-500 dark:text-zinc-400")}>
      {state === "saved" ? (
        <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved</span>
      ) : state === "error" ? (
        `Not saved: ${error ?? "try again"}`
      ) : (
        "Saving…"
      )}
    </span>
  );
}

function SaveToDocuments({ resume }: { resume: Resume }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  return (
    <Button
      variant="secondary"
      disabled={state === "busy"}
      title="Add this resume to Documents, so live sessions answer from it"
      onClick={() => {
        setState("busy");
        api
          .createTextDocument({ kind: "resume", title: resume.title, text: resumeToText(resume.data) })
          .then(() => setState("done"))
          .catch(() => setState("error"));
      }}
    >
      {state === "done" ? <CircleCheck className="h-4 w-4 text-emerald-600" /> : <Save className="h-4 w-4" />}
      {state === "done" ? "Saved to Documents" : state === "error" ? "Couldn't save, try again" : "Use in Orbit"}
    </Button>
  );
}

/** A Word copy for portals and recruiters that ask for .docx: one plain column, which ATS software reads best. */
function DownloadWord({ resume, confirm }: { resume: Resume; confirm: () => Promise<boolean> }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <Button
      variant="secondary"
      disabled={state === "busy"}
      title="Download a Word copy (.docx): one plain column, no photo, which ATS software reads best"
      onClick={async () => {
        if (!(await confirm())) return;
        setState("busy");
        api
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

function ScaledLetter({ data, design, text }: { data: ResumeData; design: ResumeDesign; text: string }) {
  const { box, page, scale, realHeight } = useScaledPage(design.page);
  return (
    <div ref={box} className="w-full" aria-label="Cover letter preview" role="img" style={{ height: realHeight * scale }}>
      <div ref={page} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }} className="overflow-hidden rounded-sm shadow-xl ring-1 ring-black/5">
        <LetterPreview data={data} design={design} text={text} />
      </div>
    </div>
  );
}

/** The page at real size, scaled down to fit the column, with where page 2 (and 3…) would start when printed. */
function ScaledPage({ data, design, onFit }: { data: ResumeData; design: ResumeDesign; onFit: (design: ResumeDesign) => void }) {
  const { box, page, scale, realHeight } = useScaledPage(design.page);
  const [fitting, setFitting] = useState(false);
  const [fitNote, setFitNote] = useState<string | null>(null);
  const { pages, breaks } = pageLayout(realHeight, design);
  useEffect(() => setFitNote(null), [data]);
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
          <Button size="sm" variant="ghost" disabled={fitting} onClick={() => { setFitNote(null); setFitting(true); }}>
            Fit to one page
          </Button>
        )}
        {fitNote && <span role="status" className="text-xs text-zinc-600 dark:text-zinc-400">{fitNote}</span>}
      </div>
      <div ref={box} className="relative w-full" aria-label={`Resume preview, ${pages} page${pages === 1 ? "" : "s"}`} role="img" style={{ height: realHeight * scale }}>
        <div ref={page} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }} className="overflow-hidden rounded-sm shadow-xl ring-1 ring-black/5">
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
          candidates={fitCandidates(design)}
          onDone={(fit) => {
            setFitting(false);
            if (fit) {
              onFit(fit);
              setFitNote(`Fitted: ${fit.spacing} spacing, ${fit.font_size} pt text.`);
            } else {
              setFitNote("Still over a page at the smallest readable size. Trim older roles or bullets, or keep two pages.");
            }
          }}
        />
      )}
    </div>
  );
}

/** Designs to try, least change first: tighter spacing, then smaller text down to 9.5 pt. */
function fitCandidates(d: ResumeDesign): ResumeDesign[] {
  const order: ResumeSpacing[] = ["relaxed", "normal", "compact"];
  const out: ResumeDesign[] = order.slice(order.indexOf(d.spacing) + 1).map((spacing) => ({ ...d, spacing }));
  for (let size = d.font_size - 0.5; size >= 9.5; size -= 0.5) out.push({ ...d, spacing: "compact", font_size: size });
  return out;
}

/** Lays the candidates out off-screen, once, and reports the first that fits on one page (or null). */
function FitMeasurer({ data, candidates, onDone }: { data: ResumeData; candidates: ResumeDesign[]; onDone: (fit: ResumeDesign | null) => void }) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useLayoutEffect(() => {
    const fit = candidates.find((c, i) => pageLayout(refs.current[i]?.offsetHeight ?? Infinity, c).pages === 1) ?? null;
    onDone(fit);
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
function PrintCopy({ data, design, letter }: { data: ResumeData; design: ResumeDesign; letter: string | null }) {
  const flow = letter !== null || design.template !== "sidebar";
  return createPortal(
    <div className={cx("resume-print", flow && "resume-print-flow")}>
      <style>{`@page { size: ${design.page === "letter" ? "letter" : "A4"}; margin: 0; }`}</style>
      {letter !== null ? <LetterPreview data={data} design={design} text={letter} /> : <ResumePreview data={data} design={design} />}
    </div>,
    document.body,
  );
}

function LetterPanel({ resume, onText, onShowJob, onPrint }: { resume: Resume; onText: (text: string) => void; onShowJob: () => void; onPrint: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [word, setWord] = useState<"idle" | "busy" | "error">("idle");
  const text = resume.cover_letter;
  const hasJob = Boolean(resume.job_text.trim());
  const fills = text.match(FILL) ?? [];

  const write = async () => {
    if (text.trim() && !(await confirmDialog({ title: "Write a new letter?", body: "This replaces the letter below, with your edits. Undo brings it back.", confirmLabel: "Write a new one" }))) return;
    setBusy(true);
    setError(null);
    try {
      onText((await api.coverLetter(resume.data, resume.job_text)).text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
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
      <Panel title="Cover letter">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          Written from your resume and the job post. It never adds facts: where a detail would help, it leaves a
          <mark className="mx-1 rounded bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100">[placeholder]</mark>
          for you to fill in. Edit it freely: it's saved with this resume.
        </p>
        {!hasJob && (
          <p className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">
            Add the job post first for a letter aimed at that job.
            <Button size="sm" variant="secondary" onClick={onShowJob}>
              <Upload className="h-3.5 w-3.5" /> Add a job post
            </Button>
          </p>
        )}
        <Button disabled={busy} onClick={() => void write()}>
          <Sparkles className="h-4 w-4" /> {busy ? "Writing…" : text.trim() ? "Write a new one" : "Write my cover letter"}
        </Button>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </Panel>
      {busy && <Spinner label="Writing your letter" />}
      {(text || !busy) && (
        <Panel title="Your letter" action={fills.length > 0 ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-200">{fills.length} to fill in</span> : undefined}>
          <Textarea aria-label="Letter text" rows={18} maxLength={6000} value={text} onChange={(e) => onText(e.target.value)} placeholder="Write it yourself, or let the AI draft it above." />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!text.trim()}
              onClick={() =>
                void navigator.clipboard
                  .writeText(text)
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  })
                  .catch(() => undefined)
              }
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="secondary"
              disabled={!text.trim() || word === "busy"}
              onClick={async () => {
                if (!(await okToDownload())) return;
                setWord("busy");
                api
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

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
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
  onFixWithAi,
}: {
  resume: Resume;
  report: AtsReport | null;
  onJob: (text: string) => void;
  onAddSkill: (keyword: string) => void;
  onShow: (target: string | null) => void;
  onFixWithAi: (check: AtsCheck) => void;
}) {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);
  if (!report) return <Spinner label="Scoring" />;
  const failed = report.checks.filter((c) => !c.passed).sort((a, b) => b.max_points - b.points - (a.max_points - a.points));
  const passed = report.checks.filter((c) => c.passed);

  return (
    <div className="space-y-4">
      <Panel title="How ATS software reads it">
        <div className="flex items-center gap-4">
          <div className={cx("flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl ring-1", scoreTone(report.score))}>
            <span className="font-display text-3xl font-semibold tabular-nums">{report.score}</span>
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

      <Panel title="Job post">
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
                <p className="mb-1.5 font-medium">Already on your resume</p>
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

      <Panel title={failed.length ? `${failed.length} fix${failed.length === 1 ? "" : "es"} to make` : "Nothing left to fix"}>
        <ul className="space-y-2">
          {failed.map((c) => (
            <li key={c.id} className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
              <div className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {c.label} <span className="font-normal tabular-nums text-zinc-500 dark:text-zinc-400">+{Math.round((c.max_points - c.points) * 10) / 10} pts</span>
                  </p>
                  {c.fix && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{c.fix}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.target && (
                      <Button size="sm" variant="secondary" onClick={() => onShow(c.target)}>
                        Show me
                      </Button>
                    )}
                    {c.ai_fixable && (c.category !== "keywords" || report.has_job) && (
                      <Button size="sm" variant="ghost" onClick={() => onFixWithAi(c)}>
                        <Sparkles className="h-3.5 w-3.5" /> Fix with AI
                      </Button>
                    )}
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
    </div>
  );
}

function AiPanel({
  hasJob,
  busy,
  error,
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
      <Panel title="Let the AI fix it">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          It rewrites weak lines, adds the skills and bullets you're missing, puts numbers where they belong and tidies dates, one change at a time: you accept or skip each. It can't know your real figures, so it leaves a
          <mark className="mx-1 rounded bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100">[placeholder]</mark>
          for you to fill in, and anything it can't prove from your resume comes with a warning to check it's true.
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
      </Panel>
      {busy && <Spinner label={busy} />}
      {error && !busy && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>}
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
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{s.label}</p>
      {s.before && <p className="mt-2 rounded-lg bg-rose-500/5 p-2 text-sm text-zinc-500 line-through decoration-rose-400/60 dark:text-zinc-400">{s.before}</p>}
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
        <p className="mt-2 rounded-lg bg-emerald-500/10 p-2 text-sm text-zinc-900 dark:text-zinc-100">
          <Highlighted text={s.after} />
        </p>
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

function DesignPanel({ design, setDesign }: { design: ResumeDesign; setDesign: (patch: Partial<ResumeDesign>) => void }) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Panel title="Template">
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={design.template === t.id}
              onClick={() => setDesign({ template: t.id })}
              className={cx(
                "rounded-xl border p-3 text-left transition-colors",
                design.template === t.id ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10",
                focusRing,
              )}
            >
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t.note}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Colour & type">
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
      <Panel title="Photo">
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
