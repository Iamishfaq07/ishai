import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { DOCUMENT_ACCEPT, type DocumentKind, type OrbitDocument } from "@orbit/types";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { confirmDialog, FileUp, FolderOpen } from "@orbit/ui";
import { api } from "../lib/api";
import { errorText, formatBytes, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const KIND_LABEL: Record<DocumentKind, string> = {
  resume: "Resume",
  job_description: "Job description",
  notes: "Notes",
  other: "Other",
};

const MAX_MB = 10;

export function DocumentsPage() {
  const location = useLocation();
  const onboarding = Boolean((location.state as { onboarding?: boolean } | null)?.onboarding);
  const docs = useAsync(() => api.listDocuments(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>("resume");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pasteTitle, setPasteTitle] = useState("Job description");
  const [pasteKind, setPasteKind] = useState<DocumentKind>("job_description");
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<OrbitDocument | null>(null);

  const add = (doc: OrbitDocument) => docs.setData((prev) => [doc, ...(prev ?? [])]);
  const replace = (doc: OrbitDocument) =>
    docs.setData((prev) => (prev ?? []).map((d) => (d.id === doc.id ? doc : d)));

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      add(await api.uploadDocument(file, kind));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const savePaste = async (e: FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      add(await api.createTextDocument({ title: pasteTitle.trim() || KIND_LABEL[pasteKind], kind: pasteKind, text: pasteText }));
      setPasteText("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: OrbitDocument) => {
    if (!(await confirmDialog({ title: `Delete “${doc.title}”?`, body: "This removes it and its extracted facts permanently.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteDocument(doc.id);
      docs.setData((prev) => (prev ?? []).filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div>
      <PageHeader
        icon={FolderOpen}
        title="Documents"
        subtitle="Your resume, job descriptions, and notes. Pick which ones each session can use."
      />
      {onboarding && (
        <div className="mb-6 rounded-xl bg-indigo-500/10 px-4 py-3 text-sm text-indigo-900 dark:text-indigo-100">
          Start by uploading your resume and pasting the job description — answers get much more specific.
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Upload a file</h2>
          <div className="space-y-4">
            <Field label="Type" htmlFor="upload-kind">
              <Select id="upload-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="File" htmlFor="upload-file" hint={`PDF, DOCX, TXT or MD — up to ${MAX_MB} MB.`}>
              <input
                id="upload-file"
                ref={fileRef}
                type="file"
                accept={DOCUMENT_ACCEPT}
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
              />
            </Field>
            {uploading && <Spinner label="Uploading" />}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Paste text</h2>
          <form onSubmit={(e) => void savePaste(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="paste-title">
                <Input id="paste-title" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="paste-kind">
                <Select id="paste-kind" value={pasteKind} onChange={(e) => setPasteKind(e.target.value as DocumentKind)}>
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Content" htmlFor="paste-text">
              <Textarea
                id="paste-text"
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the job description, company notes, or project notes…"
              />
            </Field>
            <Button type="submit" disabled={saving || !pasteText.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        </Card>
      </div>

      {docs.loading ? (
        <Spinner />
      ) : docs.error ? (
        <ErrorNote onRetry={docs.reload}>{errorText(docs.error)}</ErrorNote>
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState icon={FileUp} title="No documents yet" body="Uploaded documents are parsed into facts Orbit can cite during a session." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wider text-zinc-500 dark:border-white/5">
              <tr>
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="hidden px-5 py-3 font-medium sm:table-cell">Size</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="hidden px-5 py-3 font-medium md:table-cell">Added</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {(docs.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="max-w-[16rem] truncate px-5 py-3 font-medium" title={d.filename ?? d.title}>
                    {d.title}
                  </td>
                  <td className="px-5 py-3 text-zinc-500">{KIND_LABEL[d.kind]}</td>
                  <td className="hidden px-5 py-3 text-zinc-500 sm:table-cell">{formatBytes(d.size_bytes)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge doc={d} />
                  </td>
                  <td className="hidden px-5 py-3 text-zinc-500 md:table-cell">{formatDate(d.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(d)}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void remove(d)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="mt-3 text-right">
        <Button variant="ghost" size="sm" onClick={docs.reload}>
          Refresh
        </Button>
      </div>

      {editing && (
        <EditModal
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            replace(updated);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditModal({
  doc,
  onClose,
  onSaved,
}: {
  doc: OrbitDocument;
  onClose: () => void;
  onSaved: (doc: OrbitDocument) => void;
}) {
  const loaded = useAsync(() => api.getDocumentText(doc.id), [doc.id]);
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState<DocumentKind>(doc.kind);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded.data) {
      setTitle(loaded.data.title);
      setKind(loaded.data.kind);
      setText(loaded.data.text);
    }
  }, [loaded.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const editable = loaded.data?.editable ?? false;

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
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${doc.title}`}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">Edit document</h2>
        {loaded.loading ? (
          <Spinner />
        ) : loaded.error ? (
          <ErrorNote onRetry={loaded.reload}>{errorText(loaded.error)}</ErrorNote>
        ) : (
          <form onSubmit={(e) => void save(e)} className="space-y-4">
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="edit-title">
                <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="edit-kind">
                <Select id="edit-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {editable ? (
              <Field label="Content" htmlFor="edit-text" hint="Saving re-reads this into the facts Orbit can cite.">
                <Textarea id="edit-text" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
            ) : (
              <p className="text-sm text-zinc-500">
                This file was uploaded before in-place editing; its text isn’t stored, so only the title and type can be
                changed here. Re-upload the file to change its content.
              </p>
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

function StatusBadge({ doc }: { doc: OrbitDocument }) {
  if (doc.status === "ready")
    return <span className="text-emerald-600 dark:text-emerald-400">Ready · {doc.chunk_count} sections</span>;
  if (doc.status === "processing") return <span className="text-amber-600 dark:text-amber-400">Processing…</span>;
  return <span className="text-rose-600 dark:text-rose-400">Couldn’t read file</span>;
}
