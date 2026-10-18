import type { ChangeEvent, ReactNode, RefObject } from "react";
import type { DocumentKind, OrbitDocument } from "@orbit/types";
import { Button, ClipboardCheck, FileUp, Input, MAX_SESSION_DOCUMENTS, Select, Spot, Textarea, Trash2, cx, focusRing } from "@orbit/ui";
import { KIND_LABEL, KindMark } from "../../bits";

const DOC_KINDS = Object.entries(KIND_LABEL) as Array<[DocumentKind, string]>;

/** Ready first by kind (resume, job post, notes, other), then newest. */
const KIND_ORDER: Record<DocumentKind, number> = { resume: 0, job_description: 1, notes: 2, other: 3 };

/**
 * Step 3, what answers draw on: each document with its kind's mark and a tick, the session's limit said up front
 * (a session reads at most MAX_SESSION_DOCUMENTS; the API refuses more), and adding a file or pasted text in place.
 */
export function ContextStep({
  docs,
  selected,
  onToggle,
  onDelete,
  uploadKind,
  onUploadKind,
  uploading,
  fileInputRef,
  onFilePicked,
  pasteOpen,
  onPasteOpen,
  pasteTitle,
  onPasteTitle,
  pasteText,
  onPasteText,
  onPasteSave,
  maxUploadMb,
  notes,
}: {
  docs: OrbitDocument[] | null;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  uploadKind: DocumentKind;
  onUploadKind: (kind: DocumentKind) => void;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFilePicked: (e: ChangeEvent<HTMLInputElement>) => void;
  pasteOpen: boolean;
  onPasteOpen: (open: boolean) => void;
  pasteTitle: string;
  onPasteTitle: (v: string) => void;
  pasteText: string;
  onPasteText: (v: string) => void;
  onPasteSave: () => void;
  maxUploadMb: number;
  /** The story bank and Resume AI notes, under the list. */
  notes: ReactNode;
}) {
  const full = selected.size >= MAX_SESSION_DOCUMENTS;
  const sorted = [...(docs ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.created_at.localeCompare(a.created_at));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-zinc-500/[0.05] px-3 py-2 text-xs ring-1 ring-inset ring-zinc-200 dark:bg-white/[0.03] dark:ring-white/10">
        <ClipboardCheck className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">
          A session reads up to {MAX_SESSION_DOCUMENTS} documents, so answers stay about this job. Tick your resume and
          this job's post; leave the rest.
        </span>
        <span aria-live="polite" className={cx("shrink-0 font-medium tabular-nums", full ? "text-amber-700 dark:text-amber-300" : "text-zinc-700 dark:text-zinc-200")}>
          {selected.size} of {MAX_SESSION_DOCUMENTS} picked
        </span>
      </div>

      {docs === null ? (
        <p className="text-xs text-zinc-500">Loading your documents…</p>
      ) : docs.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-3 py-3 dark:border-white/15">
          <Spot kind="context" />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            No documents yet. Add your resume below, and the job description if you have it: answers then use your
            real background.
          </p>
        </div>
      ) : (
        <>
          {full && docs.some((d) => d.status === "ready" && !selected.has(d.id)) && (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
              That's {MAX_SESSION_DOCUMENTS}: untick one to use another.
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {sorted.map((d) => {
              const on = selected.has(d.id);
              const locked = d.status !== "ready" || (full && !on);
              return (
                <li key={d.id} className="relative">
                  <label
                    className={cx(
                      "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border py-2.5 pl-3 pr-10 transition-colors duration-quick",
                      on
                        ? "border-indigo-500 bg-indigo-500/[0.04] dark:border-indigo-400"
                        : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.03]",
                      locked && "cursor-not-allowed opacity-60 hover:border-zinc-200 hover:bg-transparent dark:hover:border-white/10",
                    )}
                  >
                    <input type="checkbox" checked={on} disabled={locked} onChange={() => onToggle(d.id)} aria-label={`Use ${d.title}`} className={cx("h-4 w-4 shrink-0", focusRing)} />
                    <KindMark kind={d.kind} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={d.filename ?? d.title}>
                        {d.title}
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {KIND_LABEL[d.kind]} · {d.status === "ready" ? "Ready" : d.status === "processing" ? "Reading…" : "Couldn't read it"}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onDelete(d.id)}
                    aria-label={`Delete ${d.title}`}
                    title="Delete"
                    className={cx("absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-400 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300", focusRing)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-white/[0.06]">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Add</span>
        <Select value={uploadKind} onChange={(e) => onUploadKind(e.target.value as DocumentKind)} aria-label="Document type" className="!w-auto">
          {DOC_KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={onFilePicked} className="hidden" id="doc-file" />
        <Button size="sm" variant="secondary" loading={uploading} loadingText="Uploading…" onClick={() => fileInputRef.current?.click()}>
          <FileUp className="h-3.5 w-3.5" aria-hidden />
          Upload a file
        </Button>
        <Button size="sm" variant="ghost" disabled={uploading} aria-expanded={pasteOpen} onClick={() => onPasteOpen(!pasteOpen)}>
          Paste text
        </Button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">PDF, DOCX, TXT or MD, up to {maxUploadMb} MB</span>
      </div>
      {pasteOpen && (
        <div className="space-y-2 rounded-xl bg-zinc-500/[0.05] p-3 ring-1 ring-inset ring-zinc-200 dark:bg-white/[0.03] dark:ring-white/10">
          <Input value={pasteTitle} onChange={(e) => onPasteTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" />
          <Textarea value={pasteText} onChange={(e) => onPasteText(e.target.value)} placeholder="Paste the job description, your resume text, or notes…" rows={4} aria-label="Text" />
          <Button size="sm" disabled={uploading || pasteText.trim().length < 20} onClick={onPasteSave}>
            Save
          </Button>
        </div>
      )}
      {notes}
    </div>
  );
}
