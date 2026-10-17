import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { DOCUMENT_ACCEPT, type DocumentKind, type OrbitDocument } from "@orbit/types";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { Badge, Briefcase, CosmicEmptyState, DialogActions, LoadGate, Skeleton, THead, Table, Td, Th, Tr, confirmDialog, cx, FileIcon, FileText, FileUp, FolderOpen, NotebookPen, type LucideIcon } from "@orbit/ui";
import { PRODUCTS } from "../components/products";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { errorText, formatBytes, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { LibraryTabs } from "./Stories";

const KIND_LABEL: Record<DocumentKind, string> = {
  resume: "Resume",
  job_description: "Job description",
  notes: "Notes",
  other: "Other",
};

// Each kind of document gets its own icon and colour in the list: a resume in Resume AI's green, a job description
// in Jobs AI's blue, notes in amber, anything else neutral. Decorative: the Type column (or the line under the title
// on phones) names it.
const KIND_MARK: Record<DocumentKind, { icon: LucideIcon; tile: string }> = {
  resume: { icon: FileText, tile: PRODUCTS.resume.tile },
  job_description: { icon: Briefcase, tile: PRODUCTS.jobs.tile },
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

// The API's limit (max_upload_bytes, at most 5 MB). A bigger file is turned away before it reaches the route,
// without CORS headers, so the browser would only say "Can't reach Orbit" instead of "too large".
const MAX_MB = 5;

export function DocumentsPage() {
  const location = useLocation();
  const onboarding = Boolean((location.state as { onboarding?: boolean } | null)?.onboarding);
  const docs = useAsync(() => api.listDocuments(), [], "documents");
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>("resume");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
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
            <div>
              <span className="mb-1.5 block text-sm font-medium">File</span>
              <input
                id="upload-file"
                ref={fileRef}
                type="file"
                accept={DOCUMENT_ACCEPT}
                disabled={uploading}
                aria-describedby="upload-file-hint"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
                className="peer sr-only"
              />
              {/* The drop zone is the input's label: a click or Enter opens the file picker, a drop uploads. */}
              <label
                htmlFor="upload-file"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!uploading) setDragging(true);
                }}
                onDragLeave={(e) => {
                  // Moving onto the zone's own icon or text fires a leave too; only leaving the zone counts.
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && !uploading) void upload(file);
                }}
                className={cx(
                  "group flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-zinc-950",
                  dragging
                    ? "border-indigo-500 bg-indigo-500/10 dark:border-indigo-400"
                    : "border-zinc-300 bg-zinc-50/60 hover:border-indigo-400 hover:bg-indigo-500/[0.04] dark:border-white/15 dark:bg-white/[0.02] dark:hover:border-indigo-400/60",
                  uploading && "pointer-events-none",
                )}
              >
                {uploading ? (
                  <Spinner label="Uploading" state="weaving" />
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className={cx(
                        "flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10 transition-transform",
                        dragging ? "motion-ok:-translate-y-1" : "motion-ok:group-hover:-translate-y-0.5",
                      )}
                    >
                      <FileUp className="h-6 w-6" />
                    </span>
                    <span className="text-sm">
                      <span className="font-medium">{dragging ? "Drop it here" : "Drop a file here"}</span>
                      {!dragging && (
                        <>
                          {" "}
                          or <span className="font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300">browse</span>
                        </>
                      )}
                    </span>
                    <span id="upload-file-hint" className="text-xs text-zinc-500">
                      PDF, DOCX, TXT or MD, up to {MAX_MB} MB
                    </span>
                  </>
                )}
              </label>
            </div>
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
        <Skeleton variant="session-row" count={4} label="Loading documents" />
      ) : docs.error ? (
        <ErrorNote onRetry={docs.reload}>{errorText(docs.error)}</ErrorNote>
      ) : (docs.data ?? []).length === 0 ? (
        <CosmicEmptyState variant="documents" title="No documents yet" body="Uploaded documents are parsed into facts Orbit can cite during a session." />
      ) : (
        <Table label="Your documents">
          <THead>
            <tr>
              <Th>Title</Th>
              <Th className="hidden sm:table-cell">Type</Th>
              <Th className="hidden sm:table-cell" align="right">Size</Th>
              <Th className="hidden sm:table-cell">Status</Th>
              <Th className="hidden md:table-cell">Added</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {(docs.data ?? []).map((d) => (
              <Tr key={d.id}>
                <Td primary title={d.filename ?? d.title}>
                  <div className="flex items-center gap-3">
                    <KindMark kind={d.kind} />
                    <div className="min-w-0">
                      <div className="max-w-[11rem] truncate sm:max-w-[16rem]">{d.title}</div>
                      {/* Phones: type and status fold under the title instead of their own columns. */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-normal text-zinc-500 sm:hidden">
                        <span>{KIND_LABEL[d.kind]}</span>
                        <StatusBadge doc={d} />
                      </div>
                    </div>
                  </div>
                </Td>
                <Td className="hidden sm:table-cell">{KIND_LABEL[d.kind]}</Td>
                <Td className="hidden sm:table-cell" align="right">{formatBytes(d.size_bytes)}</Td>
                <Td className="hidden sm:table-cell">
                  <StatusBadge doc={d} />
                </Td>
                <Td className="hidden whitespace-nowrap md:table-cell">{formatDate(d.created_at)}</Td>
                <Td align="right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(d)}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void remove(d)}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
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
      <LibraryTabs />
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

  const editable = loaded.data?.editable ?? false;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = text.trim();
      const prev = (loaded.data?.text ?? "").trim();
      // An empty or tiny save used to be skipped, so the old text stayed and interviews kept using it.
      if (editable && next !== prev && next.length < 20) {
        setError("Keep at least a few lines. Shorter than that leaves the old text in place.");
        return;
      }
      const updated = await api.updateDocument(doc.id, {
        title: title.trim() || doc.title,
        kind,
        ...(editable && next !== prev ? { text: next } : {}),
      });
      onSaved(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit document"
      size="2xl"
      footer={
        !loaded.loading && !loaded.error ? (
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="edit-document" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogActions>
        ) : undefined
      }
    >
      <div className="px-5 py-4">
        {loaded.loading ? (
          <LoadGate loading variant="line" count={6} label="Opening the document">{null}</LoadGate>
        ) : loaded.error ? (
          <ErrorNote onRetry={loaded.reload}>{errorText(loaded.error)}</ErrorNote>
        ) : (
          <form id="edit-document" onSubmit={(e) => void save(e)} className="space-y-4">
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
          </form>
        )}
      </div>
    </Sheet>
  );
}

/** A document's state as a status badge (the words say it; the colour agrees). */
function StatusBadge({ doc }: { doc: OrbitDocument }) {
  if (doc.status === "ready")
    return <Badge tone="success" dot>Ready · {doc.chunk_count} {doc.chunk_count === 1 ? "section" : "sections"}</Badge>;
  if (doc.status === "processing") return <Badge tone="warning" dot>Processing…</Badge>;
  return <Badge tone="danger" dot>Couldn’t read file</Badge>;
}
