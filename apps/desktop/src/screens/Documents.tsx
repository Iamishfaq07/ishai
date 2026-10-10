import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { DOCUMENT_ACCEPT, type DocumentKind, type OrbitDocument } from "@orbit/types";
import {
  ArrowLeft,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  confirmDialog,
  useFocusTrap,
  Briefcase,
  FileIcon,
  FileText,
  NotebookPen,
  cx,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../api";
import { TitleBar } from "../TitleBar";

// Each kind of document's icon and colour in the list (the same as the web app's): a resume green, a job
// description blue, notes amber. Decorative: the line under the title names the kind.
const KIND_MARK: Record<DocumentKind, { icon: LucideIcon; tile: string }> = {
  resume: { icon: FileText, tile: "bg-emerald-500/15 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-300/20" },
  job_description: { icon: Briefcase, tile: "bg-sky-500/15 text-sky-800 ring-sky-600/25 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-300/20" },
  notes: { icon: NotebookPen, tile: "bg-amber-500/15 text-amber-800 ring-amber-600/25 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20" },
  other: { icon: FileIcon, tile: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10" },
};

function KindMark({ kind }: { kind: DocumentKind }) {
  const { icon: Icon, tile } = KIND_MARK[kind];
  return (
    <span aria-hidden="true" className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1", tile)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

const KIND_LABEL: Record<DocumentKind, string> = {
  resume: "Resume",
  job_description: "Job description",
  notes: "Notes",
  other: "Other",
};
const MAX_MB = 10;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Full document manager for the desktop app: upload, paste, edit (re-chunk), delete. */
export function DocumentsScreen({ onBack }: { onBack: () => void }) {
  const [docs, setDocs] = useState<OrbitDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>("resume");
  const [uploading, setUploading] = useState(false);

  const [pasteTitle, setPasteTitle] = useState("Job description");
  const [pasteKind, setPasteKind] = useState<DocumentKind>("job_description");
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<OrbitDocument | null>(null);

  const reload = () => {
    setLoadError(null);
    api
      .listDocuments()
      .then(setDocs)
      .catch((e) => setLoadError(errText(e)));
  };
  useEffect(reload, []);

  const add = (doc: OrbitDocument) => setDocs((prev) => [doc, ...(prev ?? [])]);
  const replace = (doc: OrbitDocument) => setDocs((prev) => (prev ?? []).map((d) => (d.id === doc.id ? doc : d)));

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      add(await api.uploadDocument(file, kind, file.name));
    } catch (err) {
      setError(errText(err));
    } finally {
      setUploading(false);
    }
  };

  const savePaste = async (e: FormEvent) => {
    e.preventDefault();
    if (pasteText.trim().length < 20) {
      setError("Paste at least a couple of sentences (20+ characters).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      add(await api.createTextDocument({ title: pasteTitle.trim() || KIND_LABEL[pasteKind], kind: pasteKind, text: pasteText }));
      setPasteText("");
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: OrbitDocument) => {
    if (!(await confirmDialog({ title: `Delete “${doc.title}”?`, body: "This removes it and its extracted facts permanently.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteDocument(doc.id);
      setDocs((prev) => (prev ?? []).filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar title="Documents">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </TitleBar>
      <div className="flex-1 overflow-y-auto p-6">
        <PageHeader title="Documents" subtitle="Your resume, job descriptions, and notes — used to ground answers." />
        {error && (
          <div className="mb-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-semibold">Upload a file</h2>
            <div className="space-y-3">
              <Field label="Type" htmlFor="up-kind">
                <Select id="up-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                  {Object.entries(KIND_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <input ref={fileRef} type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={(e) => void onFilePicked(e)} />
              <Button variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "Choose file"}
              </Button>
              <p className="text-xs text-zinc-500">PDF, DOCX, TXT or MD — up to {MAX_MB} MB.</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Paste text</h2>
            <form onSubmit={(e) => void savePaste(e)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title" htmlFor="p-title">
                  <Input id="p-title" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} />
                </Field>
                <Field label="Type" htmlFor="p-kind">
                  <Select id="p-kind" value={pasteKind} onChange={(e) => setPasteKind(e.target.value as DocumentKind)}>
                    {Object.entries(KIND_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Content" htmlFor="p-text">
                <Textarea id="p-text" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the job description, company notes, or project notes…" />
              </Field>
              <Button type="submit" disabled={saving || pasteText.trim().length < 20}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </form>
          </Card>
        </div>

        {docs === null ? (
          loadError ? (
            <ErrorNote onRetry={reload}>{loadError}</ErrorNote>
          ) : (
            <Spinner />
          )
        ) : docs.length === 0 ? (
          <EmptyState title="No documents yet" body="Upload your resume and paste the job description so answers are specific to you." />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <KindMark kind={d.kind} />
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={d.filename ?? d.title}>
                        {d.title}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {KIND_LABEL[d.kind]} · <StatusText doc={d} />
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(d)}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void remove(d)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {editing && (
        <EditModal
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            replace(u);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function StatusText({ doc }: { doc: OrbitDocument }) {
  if (doc.status === "ready") return <span className="text-emerald-600 dark:text-emerald-400">Ready</span>;
  if (doc.status === "processing") return <span className="text-amber-600 dark:text-amber-400">Processing…</span>;
  return <span className="text-rose-600 dark:text-rose-400">Couldn’t read file</span>;
}

function EditModal({ doc, onClose, onSaved }: { doc: OrbitDocument; onClose: () => void; onSaved: (d: OrbitDocument) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState<DocumentKind>(doc.kind);
  const [text, setText] = useState("");
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });

  useEffect(() => {
    api
      .getDocumentText(doc.id)
      .then((t) => {
        setTitle(t.title);
        setKind(t.kind);
        setText(t.text);
        setEditable(t.editable);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, [doc.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateDocument(doc.id, {
        title: title.trim() || doc.title,
        kind,
        ...(editable && text.trim() ? { text } : {}),
      });
      onSaved(updated);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-doc-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-doc-title" className="mb-4 text-lg font-semibold">Edit document</h2>
        {loading ? (
          <Spinner />
        ) : (
          <form onSubmit={(e) => void save(e)} className="space-y-4">
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="e-title">
                <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="e-kind">
                <Select id="e-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                  {Object.entries(KIND_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {editable ? (
              <Field label="Content" htmlFor="e-text" hint="Saving re-reads this into the facts Orbit can cite.">
                <Textarea id="e-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
            ) : (
              <p className="text-sm text-zinc-500">This file’s text isn’t stored, so only the title and type can be changed. Re-upload it to change its content.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
