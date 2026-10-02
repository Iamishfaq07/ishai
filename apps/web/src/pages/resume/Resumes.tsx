import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ResumeData, ResumeSummary } from "@orbit/types";
import {
  ArrowLeft,
  ClipboardCheck,
  Copy,
  FileText,
  FileUp,
  FolderOpen,
  Plus,
  ScanText,
  Trash2,
  UserRound,
  X,
  confirmDialog,
  cx,
  focusRing,
} from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, Field, PageHeader, Select, Spinner, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, formatDate } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { LibraryTabs } from "../Stories";
import { newResume } from "./model";

export function scoreTone(score: number): string {
  return score >= 80
    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
    : score >= 65
      ? "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300"
      : score >= 45
        ? "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300"
        : "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300";
}

/** Resume maker: your resumes, each with its ATS score, and the ways to start a new one. */
export function ResumesPage() {
  const navigate = useNavigate();
  const list = useAsync(() => api.listResumes(), [], "resumes");
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** A copy to tailor for another job, without touching the original. */
  const duplicate = async (r: ResumeSummary) => {
    setCopying(r.id);
    setActionError(null);
    try {
      const full = await api.getResume(r.id);
      const copy = await api.createResume({ title: `${full.title} (copy)`.slice(0, 160), data: full.data, design: full.design, job_text: full.job_text, cover_letter: full.cover_letter });
      navigate(`/documents/resumes/${copy.id}`);
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

  return (
    <>
      <LibraryTabs />
      <PageHeader
        title="Resume maker"
        subtitle="Most resumes are read by software before a person sees them. Score yours the way it's read, and fix it until it passes."
        icon={FileText}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New resume
          </Button>
        }
      />
      {creating && <NewResume onClose={() => setCreating(false)} />}
      {actionError && <div className="mb-4"><ErrorNote>{actionError}</ErrorNote></div>}
      {list.loading && !list.data ? (
        <Spinner label="Loading your resumes" />
      ) : list.error ? (
        <ErrorNote onRetry={list.reload}>{errorText(list.error)}</ErrorNote>
      ) : !list.data?.length ? (
        !creating && (
          <EmptyState
            icon={FileText}
            title="Build a resume that gets past the screen"
            body="Start from scratch or import your PDF, LinkedIn profile or text. You get an ATS score out of 100, with a fix for every missing point."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New resume
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((r) => (
            <li key={r.id}>
              <Card interactive className="relative h-full">
                <Link to={`/documents/resumes/${r.id}`} className={cx("block rounded-lg", focusRing)}>
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
    </>
  );
}

type Source = "scratch" | "file" | "linkedin" | "text" | "document";

const SOURCES: Array<{ id: Source; label: string; hint: string; icon: typeof FileText }> = [
  { id: "scratch", label: "Start from scratch", hint: "A blank resume, section by section.", icon: Plus },
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

function NewResume({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [text, setText] = useState("");
  const [docId, setDocId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docs = useAsync(() => api.listDocuments(), [], "documents");
  const resumeDocs = (docs.data ?? []).filter((d) => d.kind === "resume" && d.status === "ready");

  const create = async (title: string, data?: ResumeData) => {
    const r = await api.createResume(newResume(title, data));
    navigate(`/documents/resumes/${r.id}`, { state: { imported: Boolean(data) } });
  };

  // The running import, so "Cancel" can stop waiting on a slow connection.
  const running = useRef<AbortController | null>(null);
  const run = async (job: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(null);
    try {
      await job(controller.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err)); // a cancel is silent
      setBusy(false);
    }
  };
  const cancel = () => running.current?.abort();

  const importFile = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is over 10 MB. Export a smaller PDF, or paste the text instead.");
      return;
    }
    void run(async (signal) => {
      const res = await api.importResumeFile(file, file.name, { signal });
      await create(res.title, res.data);
    });
  };

  const importText = (kind: "text" | "linkedin") =>
    void run(async (signal) => {
      const res = await api.importResume({ source: kind, text }, { signal });
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
          {source ? SOURCES.find((s) => s.id === source)!.label : "New resume"}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className={cx("rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {busy && source && source !== "scratch" && <BusyNote onCancel={cancel} />}
      {source ? (
        body
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map(({ id, label, hint, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (id === "scratch" ? void run(() => create("My resume")) : setSource(id))}
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
