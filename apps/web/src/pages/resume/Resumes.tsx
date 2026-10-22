import { SpotArt } from "../../components/SpotArt";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ResumeData, ResumeInput, ResumeSummary } from "@orbit/types";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Briefcase,
  IdCard,
  Reveal,
  Search,
  useInView,
  ClipboardCheck,
  Copy,
  FileText,
  FileUp,
  FolderOpen,
  GraduationCap,
  Plus,
  ScanText,
  ResumeScene,
  Sparkles,
  Trash2,
  UserRound,
  X,
  CosmicEmptyState,
  LoadGate,
  WorkingScene,
  confirmDialog,
  cx,
  focusRing,
  isIndia,
  regionWords,
  Wand2,
  Code2,
} from "@orbit/ui";
import { Button, Card, ErrorNote, Field, IconButton, Input, Select, Textarea } from "../../components/ui";
import { Stat, Tool, type ToolCard } from "../prepare/parts";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { useCountry } from "../../lib/country";
import { JOBS_AI_HOME } from "../jobs/paths";
import { AllowanceBanner, AllowanceContext, isUpgradeError, priceText, useResumeAllowance } from "./allowance";
import { guestResume } from "./backend";
import { fresherResume, newId, newResume } from "./model";
import { resumePath } from "./paths";
import { ResumeAiTabs, resumeAiFeatures, scoreTone } from "./product";
import type { fromJsonResume } from "./jsonResume";
import { TailorQueue } from "./TailorQueue";
export { scoreTone };

type Sort = "edited" | "score" | "name";

/** An ATS score as a ring that fills to the score the first time it's in view (motion-safe). */
function ScoreRing({ score }: { score: number }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const r = 20, c = 2 * Math.PI * r;
  const stroke = score >= 80 ? "stroke-emerald-500" : score >= 65 ? "stroke-sky-500" : score >= 45 ? "stroke-amber-500" : "stroke-rose-500";
  return <span ref={ref} className="relative grid h-14 w-14 shrink-0 place-items-center" aria-label={`ATS score ${score} out of 100`}>
    <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-zinc-200 dark:stroke-white/10" />
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className={cx(stroke, "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-out")}
        strokeDasharray={c} strokeDashoffset={inView ? c * (1 - Math.max(0, Math.min(100, score)) / 100) : c} />
    </svg>
    <span className="relative text-center leading-none" aria-hidden><span className="block font-display text-base font-semibold tabular-nums">{score}</span><span className="text-[0.55rem] text-zinc-500">ATS</span></span>
  </span>;
}

const RESUME_TOOLS: ToolCard[] = [
  { title: "Find jobs that fit", detail: "Match your resume to live openings and save a shortlist.", icon: Search, to: JOBS_AI_HOME + "/matches", ai: true },
  { title: "LinkedIn profile", detail: "Bring your profile in line with your resume, reviewed before anything changes.", icon: IdCard, to: "/linkedin", ai: true },
  { title: "GitHub projects", detail: "Your public repositories as resume projects, skills and interview stories.", icon: Code2, to: "/github-projects" },
  { title: "Bullet builder", detail: "Result, number and how: resume lines recruiters read in seconds.", icon: Wand2, to: "/bullet-builder" },
  { title: "Story bank", detail: "Turn resume bullets into interview stories.", icon: BookOpen, to: "/documents/stories" },
  { title: "Documents", detail: "Cover letters and files you saved from your resumes.", icon: FolderOpen, to: "/documents" },
];

/**
 * Orbit Resume's home: what it does, the ways to start a resume, your resume credits, and your resumes, each with
 * its ATS score. Signed out, the same address shows the public product page (ResumeAiPublic.tsx) instead.
 */
export function ResumeAiHomePage() {
  const navigate = useNavigate();
  const country = useCountry();
  const allowance = useResumeAllowance();
  const list = useAsync(() => api.listResumes(), [], "resumes");
  // A queued job finished: its new resume goes in the list, and the credits it used come off the banner.
  const { reload: reloadList } = list;
  const { refresh: refreshAllowance } = allowance;
  const afterTailoring = useCallback(() => {
    reloadList();
    refreshAllowance();
  }, [reloadList, refreshAllowance]);
  // Which way of starting is open: the list of sources, or straight to importing a file.
  const [start] = useSearchParams();
  const [creating, setCreating] = useState<"new" | "import" | null>(() => start.get("start") === "import" ? "import" : start.get("start") === "new" ? "new" : null);
  const [copying, setCopying] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // A resume made on the free signed-out maker, still in this browser: offered once, then kept or dropped.
  const [fromBefore, setFromBefore] = useState(() => guestResume.load());
  const saveFromBefore = async () => {
    if (!fromBefore) return;
    setActionError(null);
    try {
      const { title, data, design, job_text, cover_letter } = fromBefore;
      const r = await api.createResume({ title, data, design, job_text, cover_letter });
      guestResume.clear();
      setFromBefore(null);
      navigate(resumePath(r.id));
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  /** A copy to tailor for another job, without touching the original. */
  const duplicate = async (r: ResumeSummary) => {
    setCopying(r.id);
    setActionError(null);
    try {
      const full = await api.getResume(r.id);
      const copy = await api.createResume({ title: `${full.title} (copy)`.slice(0, 160), data: full.data, design: full.design, job_text: full.job_text, cover_letter: full.cover_letter });
      navigate(resumePath(copy.id));
    } catch (err) {
      setActionError(errorText(err));
      setCopying(null);
    }
  };

  const remove = async (r: ResumeSummary) => {
    const ok = await confirmDialog({
      title: `Delete “${r.title}”?`,
      body: "The resume and its design are deleted for good. Documents you saved from it stay.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    list.setData((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
    await api.deleteResume(r.id).catch(() => list.reload());
  };

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("edited");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (list.data ?? []).filter((r) => !q || `${r.title} ${r.name} ${r.headline}`.toLowerCase().includes(q));
    return [...rows].sort((a, b) => sort === "score" ? b.score - a.score : sort === "name" ? a.title.localeCompare(b.title) : b.updated_at.localeCompare(a.updated_at));
  }, [list.data, query, sort]);
  const count = list.data?.length ?? 0;
  const intro = Boolean(list.data && count === 0) || Boolean(list.error && !list.data);
  return (
    <AllowanceContext.Provider value={allowance}>
      <ResumeAiTabs />
      {/* The full introduction is for someone starting out; once there are resumes (or while they load) a compact
          header with the two ways to start puts the list straight under it, where a returning visit is headed. */}
      {intro ? (
        <section aria-labelledby="resume-ai-title" className="glass-panel relative mb-6 overflow-hidden rounded-3xl p-5 sm:p-8">
          <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div>
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                <Sparkles className="h-4 w-4" aria-hidden />
                Orbit Resume
              </p>
              <h1 id="resume-ai-title" className="mt-4 max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Build a resume that <span className="text-gradient">gets interviews.</span>
              </h1>
              <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">
                ATS score, AI rewrites for every job, and interview prep from your own resume.
              </p>
              <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
                <Button size="lg" onClick={() => setCreating("new")}>
                  <Plus className="h-4 w-4" /> Create a resume
                </Button>
                <Button size="lg" variant="secondary" onClick={() => setCreating("import")}>
                  <FileUp className="h-4 w-4" /> Import my resume
                </Button>
              </div>
              <ul aria-label="What Resume does" className="mt-6 flex flex-wrap gap-1.5 sm:mt-7 sm:gap-2">
                {resumeAiFeatures(country).map(({ icon: Icon, short }) => (
                  <li
                    key={short}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-500/15 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
                  >
                    <Icon className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" aria-hidden />
                    {short}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden lg:block">
              <ResumeScene className="mx-auto max-w-[18rem]" />
            </div>
          </div>
        </section>
      ) : (
        <div className="mb-6 space-y-6">
        <header className="workspace-heading">
          <div>
            <h1 id="resume-ai-title">Your resumes</h1>
            <p className="workspace-description">Every version with its ATS score. Make a copy to tailor one for each job.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <SpotArt kind="resume" className="mr-2 hidden w-28 lg:block" />
            <Button variant="secondary" onClick={() => setCreating("import")}><FileUp className="h-4 w-4" /> Import</Button>
            <Button onClick={() => setCreating("new")}><Plus className="h-4 w-4" /> Create a resume</Button>
          </div>
        </header>
        <Reveal stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Resumes" value={list.data ? count : null} hint="Master and job copies" />
          <Stat label="Best ATS score" value={list.data?.length ? Math.max(...list.data.map((r) => r.score)) : list.data ? 0 : null} hint="Out of 100" />
          <Stat label="Average ATS score" value={list.data?.length ? Math.round(list.data.reduce((n, r) => n + r.score, 0) / list.data.length) : list.data ? 0 : null} hint="Across all versions" />
          <Stat label="Tailored to a job" value={list.data ? list.data.filter((r) => r.has_job).length : null} hint="Copies with a job post" />
        </Reveal>
        </div>
      )}
      <AllowanceBanner />
      {fromBefore && (
        <Card className="mb-4 flex flex-wrap items-center gap-3">
          <FileText className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <strong className="font-medium">You made a resume before signing in</strong>
            {fromBefore.data.basics.name ? ` (${fromBefore.data.basics.name})` : ""}. Save it to your account to keep it safe and use it in interviews.
          </p>
          <Button onClick={() => void saveFromBefore()}>Save to my account</Button>
          <Button
            variant="ghost"
            onClick={() => {
              guestResume.clear();
              setFromBefore(null);
            }}
          >
            Discard
          </Button>
        </Card>
      )}
      {creating && <NewResume key={creating} initial={creating === "import" ? "file" : null} onClose={() => setCreating(null)} />}
      {actionError && <div className="mb-4"><ErrorNote>{actionError}</ErrorNote></div>}
      <div className={cx("mb-3 flex flex-wrap items-end justify-between gap-3", intro ? "mt-8" : "mt-6")}>
        <h2 className="font-display text-lg font-semibold tracking-tight">
          All versions
          {count > 0 && <span className="ml-2 text-sm font-normal tabular-nums text-zinc-500 dark:text-zinc-400">{count}</span>}
        </h2>
        {count > 1 && <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none"><span className="sr-only">Search resumes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="pl-9" /></label>
          <label><span className="sr-only">Sort resumes</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="edited">Recently edited</option><option value="score">Highest ATS score</option><option value="name">Name</option>
            </Select></label>
        </div>}
      </div>
      <LoadGate
        loading={list.loading && !list.data}
        variant="resume-card"
        count={3}
        label="Loading your resumes"
        className="sm:grid sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 sm:space-y-0"
      >
      {list.error ? (
        <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>
      ) : !list.data?.length ? (
        !creating && (
          <CosmicEmptyState
            variant="resume"
            title="No resumes yet"
            body="Start from scratch or import your PDF, Word file or LinkedIn profile. You get an ATS score out of 100, with a fix for every missing point."
            action={
              <Button onClick={() => setCreating("new")}>
                <Plus className="h-4 w-4" /> Create a resume
              </Button>
            }
          />
        )
      ) : (
        <Reveal as="ul" stagger key={`${sort}|${query}`} className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!shown.length && <li className="text-sm text-zinc-600 dark:text-zinc-400">No resumes match “{query}”.</li>}
          {shown.map((r) => (
            <li key={r.id}>
              <Card interactive className="relative h-full">
                <Link to={resumePath(r.id)} className={cx("block rounded-lg", focusRing)}>
                  <div className="flex items-start gap-3">
                    <ScoreRing score={r.score} />
                    <span className="min-w-0 pr-16">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {[r.name, r.headline].filter(Boolean).join(" · ") || "No name yet"}
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                        Edited {formatDate(r.updated_at)}
                      </span>
                      {r.has_job && <span className="mt-2 inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">Tailored to a job</span>}
                    </span>
                  </div>
                </Link>
                <div className="absolute right-3 top-3 flex">
                  <IconButton
                    size="sm"
                    icon={Copy}
                    onClick={() => void duplicate(r)}
                    disabled={copying !== null}
                    loading={copying === r.id}
                    label={`Make a copy of ${r.title}`}
                    title="Make a copy (to tailor for another job)"
                    className="text-zinc-500"
                  />
                  <IconButton size="sm" icon={Trash2} onClick={() => void remove(r)} label={`Delete ${r.title}`} className="text-zinc-500 hover:!bg-rose-500/10 hover:!text-rose-700 dark:hover:!text-rose-300" />
                </div>
              </Card>
            </li>
          ))}
        </Reveal>
      )}
      </LoadGate>
      {list.data && list.data.length > 0 && <TailorQueue resumes={list.data} onMade={afterTailoring} />}
      {count > 0 && <section aria-labelledby="resume-tools" className="mt-8">
        <h2 id="resume-tools" className="font-display text-lg font-semibold tracking-tight">Put your resume to work</h2>
        <Reveal as="ul" stagger className="-mx-3 mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">{RESUME_TOOLS.map((t) => <li key={t.title}><Tool t={t} /></li>)}</Reveal>
      </section>}
      {count > 0 && <FindJobs />}
    </AllowanceContext.Provider>
  );
}

/**
 * The way over to Jobs, Orbit's product for finding the jobs a resume fits and writing to them (each editor has
 * one for its resume).
 */
function FindJobs() {
  return (
    <Link
      to={JOBS_AI_HOME}
      className={cx(
        "glass-panel lift group mt-8 flex items-center gap-4 rounded-2xl p-4 hover:border-indigo-400/40 sm:p-5 dark:hover:border-indigo-400/30",
        focusRing,
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
        <Briefcase className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display font-semibold">Find jobs that match your resume</span>
        <span className="block text-sm text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">Jobs</span>{" "}
          shows the latest openings, ranked by how well they match you, with a free AI fit check and outreach for each job.
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" aria-hidden />
    </Link>
  );
}

type Source ="scratch" | "fresher" | "file" | "linkedin" | "text" | "document";

const SOURCES: Array<{ id: Source; label: string; hint: string; icon: typeof FileText }> = [
  { id: "scratch", label: "Start from scratch", hint: "A blank resume, section by section.", icon: Plus },
  { id: "fresher", label: "Student / fresher", hint: "One page for campus placements: education first, then projects.", icon: GraduationCap },
  { id: "file", label: "Import a PDF or Word file", hint: "We read it into editable sections. A JSON Resume file (from Orbit or another tool) comes in exactly, free.", icon: FileUp },
  { id: "linkedin", label: "Import your LinkedIn profile", hint: "From LinkedIn's “Save to PDF”, or pasted.", icon: UserRound },
  { id: "text", label: "Paste text", hint: "Copy from anywhere and paste it in.", icon: ClipboardCheck },
  { id: "document", label: "From your documents", hint: "A resume you already gave Orbit.", icon: FolderOpen },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // the server's limit, checked before uploading over a phone connection

/** Shown while a file or text is being read: says it's still going, and lets the person stop waiting. */
function BusyNote({ onCancel }: { onCancel: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-900 dark:text-indigo-200">
      <WorkingScene kind="reading" className="w-24 shrink-0" />
      <span className="min-w-0 flex-1">
        {slow
          ? "Still working. Scanned PDFs, long resumes and slow connections can take up to a minute or two."
          : "Reading your resume…"}
      </span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** The ways to start a resume; `initial` opens one of them straight away ("Import my resume"). */
export function NewResume({ onClose, initial = null }: { onClose?: () => void; initial?: Source | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tools = api;
  const country = useCountry();
  // The student resume, as it's called where the user applies (campus placements in India).
  const sources = isIndia(country)
    ? SOURCES
    : SOURCES.map((x) => (x.id === "fresher" ? { ...x, label: regionWords(country).student, hint: "One page for graduate jobs and internships: education first, then projects." } : x));
  const [source, setSource] = useState<Source | null>(initial);
  const [text, setText] = useState("");
  const [docId, setDocId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  // Importing is an AI action: say whether it spends a resume credit (or needs a pack) before it's spent.
  const allowance = useAsync(() => tools.resumeAllowance().catch(() => null), [], "resume-allowance");
  const ai = allowance.data;
  const fileRef = useRef<HTMLInputElement>(null);
  const docs = useAsync(() => api.listDocuments(), [], "documents");
  const resumeDocs = (docs.data ?? []).filter((d) => d.kind === "resume" && d.status === "ready");

  const open = async (input: ResumeInput, imported: boolean) => {
    const r = await api.createResume(input);
    navigate(resumePath(r.id) + (params.get("guide") === "1" ? "?guide=1" : ""), { state: { imported } });
  };
  const create = (title: string, data?: ResumeData) => open(newResume(title, data, country), Boolean(data));

  // The running import, so "Cancel" can stop waiting on a slow connection.
  const running = useRef<AbortController | null>(null);
  const run = async (job: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(null);
    setUpgrade(false);
    try {
      await job(controller.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err)); // a cancel is silent
      setUpgrade(isUpgradeError(err));
      setBusy(false);
      allowance.reload();
    }
  };
  const cancel = () => running.current?.abort();

  const importFile = (file: File) => {
    if (/\.json$/i.test(file.name) || file.type === "application/json") {
      // A JSON Resume file (jsonresume.org, or one exported from Orbit): read here, exactly, free (no AI).
      void run(async () => {
        if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 5 MB.");
        let parsed: ReturnType<typeof fromJsonResume>;
        try {
          const { fromJsonResume: readJsonResume } = await import("./jsonResume");
          parsed = readJsonResume(JSON.parse(await file.text()));
        } catch {
          throw new Error("That isn't a JSON Resume file. Export one from Orbit or another resume tool (jsonresume.org).");
        }
        await create(parsed.title, parsed.data);
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 5 MB. Export a smaller PDF, or paste the text instead.");
      return;
    }
    void run(async (signal) => {
      const res = await tools.importResumeFile(file, file.name, { signal });
      await create(res.title, res.data);
    });
  };

  const importText = (kind: "text" | "linkedin") =>
    void run(async (signal) => {
      const res = await tools.importResume({ source: kind, text }, { signal });
      await create(res.title, res.data);
    });

  let body: ReactNode = null;
  if (source === "file" || source === "linkedin") {
    body = (
      <div className="space-y-4">
        {source === "linkedin" && (
          <p className="rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-900 dark:text-indigo-200">
            On LinkedIn, open your profile, choose <strong>More → Save to PDF</strong>, and upload that file here. Or
            copy the profile text and paste it below.
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          aria-label="Choose your resume file"
          accept=".pdf,.docx,.txt,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
        <Button disabled={busy} onClick={() => fileRef.current?.click()} className="w-full">
          <FileUp className="h-4 w-4" /> {busy ? "Reading your resume…" : "Choose a file (PDF, DOCX or TXT)"}
        </Button>
        {source === "linkedin" && (
          <>
            <Field label="…or paste your profile" htmlFor="li-text">
              <Textarea id="li-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="About, Experience, Education, Skills…" />
            </Field>
            <Button variant="secondary" disabled={busy || text.trim().length < 80} onClick={() => importText("linkedin")}>
              <ScanText className="h-4 w-4" /> Import pasted profile
            </Button>
          </>
        )}
      </div>
    );
  }
  if (source === "text") {
    body = (
      <div className="space-y-4">
        <Field label="Your resume" htmlFor="paste" hint="Paste the whole thing: we sort it into sections.">
          <Textarea id="paste" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button disabled={busy || text.trim().length < 80} onClick={() => importText("text")}>
          <ScanText className="h-4 w-4" /> {busy ? "Reading…" : "Import"}
        </Button>
      </div>
    );
  }
  if (source === "document") {
    body = (
      <LoadGate loading={docs.loading && !docs.data} variant="line" count={3} label="Loading documents">
        {!resumeDocs.length ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        You haven't added a resume to <Link to="/documents" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Documents</Link> yet.
      </p>
    ) : (
      <div className="space-y-4">
        <Field label="Resume" htmlFor="doc">
          <Select id="doc" value={docId || resumeDocs[0]!.id} onChange={(e) => setDocId(e.target.value)}>
            {resumeDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              const res = await api.importResume({ source: "document", document_id: docId || resumeDocs[0]!.id }, { signal });
              await create(res.title, res.data);
            })
          }
        >
          <ScanText className="h-4 w-4" /> {busy ? "Reading…" : "Import"}
        </Button>
      </div>
        )}
      </LoadGate>
    );
  }

  return (
    <Card className="mb-8 animate-fade-up">
      <div className="mb-4 flex items-center gap-2">
        {source && (
          <button type="button" onClick={() => { setSource(null); setError(null); }} aria-label="Back" className={cx("rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="flex-1 font-display text-lg font-semibold">
          {source ? sources.find((s) => s.id === source)!.label : "New resume"}
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className={cx("rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && !upgrade && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {error && upgrade && (
        <div role="status" className="mb-4 space-y-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-950 ring-1 ring-amber-500/30 dark:text-amber-100">
          <p>{error} Starting from scratch is always free.</p>
          <Link
            to={`/billing?pack=${ai?.upgrade?.pack ?? ""}`}
            className={cx("inline-flex rounded-xl bg-amber-500 px-3 py-1.5 font-medium text-white hover:bg-amber-600", focusRing)}
          >
            {ai?.upgrade ? `Get credits · ${(ai.upgrade.price_text ?? priceText(ai.upgrade.price_inr))}` : "Get credits"}
          </Link>
        </div>
      )}
      {ai && !ai.unlimited && !error && source && source !== "scratch" && (
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
          {ai.credits_left > 0
            ? `Importing uses 1 resume credit (you have ${ai.credits_left}). Starting from scratch is always free.`
            : "You're out of resume credits, so importing needs a credit pack. Starting from scratch is always free."}
        </p>
      )}
      {busy && source && source !== "scratch" && <BusyNote onCancel={cancel} />}
      {source ? (
        body
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {sources.map(({ id, label, hint, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  id === "scratch" ? void run(() => create("My resume")) : id === "fresher" ? void run(() => open(fresherResume(newId, country), false)) : setSource(id)
                }
                className={cx(
                  "flex w-full items-start gap-3 rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-500/5 dark:border-white/10",
                  focusRing,
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
