import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ResumeData, ResumeInput, ResumeSummary } from "@orbit/types";
import {
  ArrowLeft,
  ClipboardCheck,
  Copy,
  FileText,
  FileUp,
  FolderOpen,
  GraduationCap,
  Plus,
  ScanText,
  Sparkles,
  SpotIllustration,
  Trash2,
  UserRound,
  X,
  Orb,
  confirmDialog,
  cx,
  focusRing,
} from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, Select, Spinner, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { AllowanceBanner, AllowanceContext, isUpgradeError, priceText, useResumeAllowance } from "./allowance";
import { guestResume } from "./backend";
import { fresherResume, newResume } from "./model";
import { resumePath } from "./paths";
import { RESUME_AI_FEATURES, ResumeAiTabs, scoreTone } from "./product";

export { scoreTone };

/**
 * Orbit Resume AI's home: what it does, the ways to start a resume, your resume credits, and your resumes, each with
 * its ATS score. Signed out, the same address shows the public product page (ResumeAiPublic.tsx) instead.
 */
export function ResumeAiHomePage() {
  const navigate = useNavigate();
  const allowance = useResumeAllowance();
  const list = useAsync(() => api.listResumes(), [], "resumes");
  // Which way of starting is open: the list of sources, or straight to importing a file.
  const [creating, setCreating] = useState<"new" | "import" | null>(null);
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

  const count = list.data?.length ?? 0;
  return (
    <AllowanceContext.Provider value={allowance}>
      <ResumeAiTabs />
      <section aria-labelledby="resume-ai-title" className="glass-panel gradient-border relative mb-6 overflow-hidden rounded-3xl p-5 sm:p-8">
        <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-aurora-400/15 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute right-8 top-1/2 hidden -translate-y-1/2 lg:block xl:right-14">
          <SpotIllustration icon={Sparkles} size={176} />
        </div>
        <div className="relative lg:pr-56">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Orbit Resume AI
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
          <ul aria-label="What Resume AI does" className="mt-6 flex flex-wrap gap-1.5 sm:mt-7 sm:gap-2">
            {RESUME_AI_FEATURES.map(({ icon: Icon, short }) => (
              <li
                key={short}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-500/15 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
              >
                <Icon className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" aria-hidden />
                {short}
              </li>
            ))}
          </ul>
        </div>
      </section>
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
      <div className="mb-3 mt-8 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Your resumes
          {count > 0 && <span className="ml-2 text-sm font-normal tabular-nums text-zinc-500 dark:text-zinc-400">{count}</span>}
        </h2>
        {count > 0 && <p className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">Make a copy to tailor one for another job.</p>}
      </div>
      {list.loading && !list.data ? (
        <Spinner label="Loading your resumes" state="searching" />
      ) : list.error ? (
        <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>
      ) : !list.data?.length ? (
        !creating && (
          <EmptyState
            icon={FileText}
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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((r) => (
            <li key={r.id}>
              <Card interactive className="relative h-full">
                <Link to={resumePath(r.id)} className={cx("block rounded-lg", focusRing)}>
                  <div className="flex items-start gap-3">
                    <span
                      className={cx("flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl ring-1", scoreTone(r.score))}
                      aria-label={`ATS score ${r.score} out of 100`}
                    >
                      <span className="font-display text-lg font-semibold leading-none tabular-nums">{r.score}</span>
                      <span className="text-[0.625rem] leading-none opacity-80">ATS</span>
                    </span>
                    <span className="min-w-0 pr-16">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {[r.name, r.headline].filter(Boolean).join(" · ") || "No name yet"}
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                        Edited {formatDate(r.updated_at)}
                        {r.has_job ? " · tailored to a job" : ""}
                      </span>
                    </span>
                  </div>
                </Link>
                <div className="absolute right-3 top-3 flex">
                  <button
                    type="button"
                    onClick={() => void duplicate(r)}
                    disabled={copying !== null}
                    aria-label={`Make a copy of ${r.title}`}
                    title="Make a copy (to tailor for another job)"
                    className={cx("rounded-md p-1.5 text-zinc-400 hover:bg-indigo-500/10 hover:text-indigo-600 disabled:opacity-40", focusRing)}
                  >
                    <Copy className={cx("h-4 w-4", copying === r.id && "animate-pulse")} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r)}
                    aria-label={`Delete ${r.title}`}
                    className={cx("rounded-md p-1.5 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-600", focusRing)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AllowanceContext.Provider>
  );
}

type Source ="scratch" | "fresher" | "file" | "linkedin" | "text" | "document";

const SOURCES: Array<{ id: Source; label: string; hint: string; icon: typeof FileText }> = [
  { id: "scratch", label: "Start from scratch", hint: "A blank resume, section by section.", icon: Plus },
  { id: "fresher", label: "Student / fresher", hint: "One page for campus placements: education first, then projects.", icon: GraduationCap },
  { id: "file", label: "Import a PDF or Word file", hint: "We read it into editable sections.", icon: FileUp },
  { id: "linkedin", label: "Import your LinkedIn profile", hint: "From LinkedIn's “Save to PDF”, or pasted.", icon: UserRound },
  { id: "text", label: "Paste text", hint: "Copy from anywhere and paste it in.", icon: ClipboardCheck },
  { id: "document", label: "From your documents", hint: "A resume you already gave Orbit.", icon: FolderOpen },
];

const MAX_FILE_BYTES = 10 * 1024 * 1024; // the server's limit, checked before uploading over a phone connection

/** Shown while a file or text is being read: says it's still going, and lets the person stop waiting. */
function BusyNote({ onCancel }: { onCancel: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-900 dark:text-indigo-200">
      <Orb state="searching" />
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
  const tools = api;
  const sources = SOURCES;
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
    navigate(resumePath(r.id), { state: { imported } });
  };
  const create = (title: string, data?: ResumeData) => open(newResume(title, data), Boolean(data));

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
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 10 MB. Export a smaller PDF, or paste the text instead.");
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
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
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
    body = docs.loading && !docs.data ? (
      <Spinner label="Loading documents" />
    ) : !resumeDocs.length ? (
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
            {ai?.upgrade ? `Get credits · ${priceText(ai.upgrade.price_inr)}` : "Get credits"}
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
                  id === "scratch" ? void run(() => create("My resume")) : id === "fresher" ? void run(() => open(fresherResume(), false)) : setSource(id)
                }
                className={cx(
                  "flex w-full items-start gap-3 rounded-xl border border-zinc-200 p-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-500/5 dark:border-white/10",
                  focusRing,
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
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
