import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams } from "react-router-dom";
import type { AtsCheck, AtsReport, Resume, ResumeData, ResumeDesign, ResumeSuggestion } from "@orbit/types";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Gauge,
  Link2,
  Palette,
  PenLine,
  Plus,
  Save,
  Sparkles,
  Upload,
  Wand2,
  X,
  cx,
  focusRing,
  splitPlaceholders,
} from "@orbit/ui";
import { Button, ErrorNote, Field, Input, Select, Spinner, Textarea, Toggle } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";
import { ContentForm } from "./ContentForm";
import { ACCENTS, FONTS, SPACING, TEMPLATES, getAt, newId, photoToDataUrl, resumeToText, setAt } from "./model";
import { PAGE_MM, ResumePreview } from "./ResumePreview";
import { scoreTone } from "./Resumes";

type Tab = "content" | "score" | "ai" | "design";
const MM_TO_PX = 96 / 25.4;

const TABS: Array<{ id: Tab; label: string; icon: typeof FileText }> = [
  { id: "content", label: "Content", icon: PenLine },
  { id: "score", label: "ATS score", icon: Gauge },
  { id: "ai", label: "AI rewrite", icon: Wand2 },
  { id: "design", label: "Design", icon: Palette },
];

/** The text "Fix with AI" can rewrite: a summary, headline, bullet or project description. */
function rewritable(path: string | null): path is string {
  return Boolean(path && /^(basics\.(summary|headline)|experience\.[^.]+\.bullets\.\d+|projects\.[^.]+\.(description|bullets\.\d+))$/.test(path));
}

export function ResumeEditorPage() {
  const { resumeId = "" } = useParams();
  const location = useLocation();
  const [resume, setResume] = useState<Resume | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("content");
  const [report, setReport] = useState<AtsReport | null>(null);
  const [save, setSave] = useState<{ state: "saved" | "saving" | "dirty" | "error"; error?: string }>({ state: "saved" });
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

  const change = useCallback((fn: (r: Resume) => Resume) => {
    setResume((r) => (r ? fn(r) : r));
    setSave({ state: "dirty" });
  }, []);
  const update = useCallback((fn: (d: ResumeData) => ResumeData) => change((r) => ({ ...r, data: fn(r.data) })), [change]);
  const setDesign = (patch: Partial<ResumeDesign>) => change((r) => ({ ...r, design: { ...r.design, ...patch } }));

  // Autosave, a moment after the last edit.
  const latest = useRef(resume);
  latest.current = resume;
  useEffect(() => {
    if (!resume || save.state !== "dirty") return;
    const t = window.setTimeout(() => {
      setSave({ state: "saving" });
      const { title, data, design, job_text } = resume;
      api
        .updateResume(resume.id, { title: title.trim() || "Untitled resume", data, design, job_text })
        .then(() => setSave((s) => (s.state === "saving" ? { state: "saved" } : s)))
        .catch((err: unknown) => setSave({ state: "error", error: errorText(err) }));
    }, 900);
    return () => window.clearTimeout(t);
  }, [resume, save.state]);

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
          .updateResume(r.id, { title: r.title.trim() || "Untitled resume", data: r.data, design: r.design, job_text: r.job_text })
          .catch(() => undefined);
      }
    },
    [],
  );

  // Re-score as you type (deterministic and cheap on the server).
  useEffect(() => {
    if (!resume) return;
    const t = window.setTimeout(() => {
      api.scoreResume(resume.data, resume.design, resume.job_text).then(setReport).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(t);
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

  const askAi = async (mode: "improve" | "tailor", focus?: string) => {
    if (!resume) return;
    setTab("ai");
    setAiBusy(focus ? "Rewriting that line…" : mode === "tailor" ? "Tailoring to the job…" : "Reading your resume…");
    setAiError(null);
    try {
      const res = await api.suggestResume({ data: resume.data, design: resume.design, job_text: resume.job_text, mode, ...(focus ? { focus } : {}) });
      setQueue(res.suggestions);
      if (!res.suggestions.length) setAiError("Nothing to change: the AI thinks this already reads well.");
    } catch (err) {
      setAiError(errorText(err));
    } finally {
      setAiBusy(null);
    }
  };

  const accept = (s: ResumeSuggestion) => {
    if (!resume) return;
    if (getAt(resume.data, s.path) !== s.before) {
      setAiError("That text changed since the suggestion was made, so it was skipped.");
    } else {
      update((d) => setAt(d, s.path, s.after));
    }
    setQueue((q) => q.filter((x) => x.id !== s.id));
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
          <DownloadWord resume={resume} />
          <Button onClick={() => printResume(resume)}>
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
                type="button"
                onClick={() => setTab(id)}
                className={cx(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium",
                  tab === id ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  focusRing,
                )}
              >
                <Icon className="h-4 w-4" />
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
              onAddSkill={(kw) =>
                update((d) => {
                  if (!d.skills.length) return { ...d, skills: [{ id: newId(), name: "Skills", items: [kw] }] };
                  const [first, ...rest] = d.skills;
                  return { ...d, skills: [{ ...first!, items: [...first!.items, kw] }, ...rest] };
                })
              }
              onShow={showTarget}
              onFixWithAi={(check) => void (rewritable(check.target) ? askAi("improve", check.target) : askAi(check.category === "keywords" ? "tailor" : "improve"))}
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
              onSkip={(s) => setQueue((q) => q.filter((x) => x.id !== s.id))}
              onShowJob={() => setTab("score")}
            />
          )}
          {tab === "design" && <DesignPanel design={resume.design} setDesign={setDesign} />}
        </div>

        <div className="min-w-0">
          <div className="sticky top-20">
            <ScaledPage data={resume.data} design={resume.design} />
          </div>
        </div>
      </div>
      <PrintCopy data={resume.data} design={resume.design} />
    </div>
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
function DownloadWord({ resume }: { resume: Resume }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <Button
      variant="secondary"
      disabled={state === "busy"}
      title="Download a Word copy (.docx): one plain column, no photo, which ATS software reads best"
      onClick={() => {
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

/** Browsers name the saved PDF after the page title, so it's "Sam Lee - Resume.pdf" rather than the app's name. */
function printResume(resume: Resume): void {
  const previous = document.title;
  document.title = fileName(resume);
  window.addEventListener("afterprint", () => (document.title = previous), { once: true });
  window.print();
}

/** "Sam Lee - Resume", from the name on the resume (or its title), safe to use as a file name everywhere. */
function fileName(resume: Resume): string {
  const base = resume.data.basics.name.trim() ? `${resume.data.basics.name.trim()} - Resume` : resume.title.trim();
  return base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Resume";
}

/** The page at real size, scaled down to fit the column. */
function ScaledPage({ data, design }: { data: ResumeData; design: ResumeDesign }) {
  const box = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const pageWidth = PAGE_MM[design.page].w * MM_TO_PX;
    const measure = () => {
      const s = Math.min(1, (box.current?.clientWidth ?? pageWidth) / pageWidth);
      setScale(s);
      setHeight((page.current?.offsetHeight ?? 0) * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (page.current) ro.observe(page.current);
    return () => ro.disconnect();
  }, [design.page]);
  return (
    <div ref={box} className="w-full" aria-label="Resume preview" role="img" style={{ height }}>
      <div ref={page} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }} className="overflow-hidden rounded-sm shadow-xl ring-1 ring-black/5">
        <ResumePreview data={data} design={design} />
      </div>
    </div>
  );
}

/** What "Download PDF" prints: the resume alone, at real size, with the page set to A4 or Letter. */
function PrintCopy({ data, design }: { data: ResumeData; design: ResumeDesign }) {
  const flow = design.template !== "sidebar";
  return createPortal(
    <div className={cx("resume-print", flow && "resume-print-flow")}>
      <style>{`@page { size: ${design.page === "letter" ? "letter" : "A4"}; margin: 0; }`}</style>
      <ResumePreview data={data} design={design} />
    </div>,
    document.body,
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
  onSkip,
  onShowJob,
}: {
  hasJob: boolean;
  busy: string | null;
  error: string | null;
  queue: ResumeSuggestion[];
  onAsk: (mode: "improve" | "tailor") => void;
  onAccept: (s: ResumeSuggestion) => void;
  onSkip: (s: ResumeSuggestion) => void;
  onShowJob: () => void;
}) {
  const current = queue[0];
  return (
    <div className="space-y-4">
      <Panel title="Let the AI rewrite it">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          It rewrites what's already there, one change at a time: you accept or skip each. It never adds facts; where a number would help, it leaves a
          <mark className="mx-1 rounded bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100">[placeholder]</mark>
          for you to fill in.
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
      {current && !busy && (
        <Panel title={`Suggestion 1 of ${queue.length}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{current.label}</p>
          {current.before && <p className="mt-2 rounded-lg bg-rose-500/5 p-2 text-sm text-zinc-500 line-through decoration-rose-400/60 dark:text-zinc-400">{current.before}</p>}
          <p className="mt-2 rounded-lg bg-emerald-500/10 p-2 text-sm text-zinc-900 dark:text-zinc-100">
            <Highlighted text={current.after} />
          </p>
          {current.reason && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{current.reason}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={() => onAccept(current)}>
              <Check className="h-4 w-4" /> Accept
            </Button>
            <Button variant="secondary" onClick={() => onSkip(current)}>
              Skip
            </Button>
          </div>
        </Panel>
      )}
    </div>
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
