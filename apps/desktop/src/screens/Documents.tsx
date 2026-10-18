import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DOCUMENT_ACCEPT, type DocumentKind, type OrbitDocument } from "@orbit/types";
import {
  Badge,
  Button,
  Card,
  CosmicEmptyState,
  DocumentsScene,
  Dropzone,
  ErrorNote,
  Field,
  Input,
  LoadGate,
  MAX_SESSION_DOCUMENTS,
  SearchInput,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Textarea,
  confirmDialog,
  toast,
} from "@orbit/ui";
import { api } from "../api";
import { KIND_LABEL, KindMark } from "../bits";
import { TitleBar } from "../TitleBar";
import type { Chrome } from "./Home";

const MAX_MB = 10;
type KindFilter = "all" | DocumentKind;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sizeText(bytes: number): string | null {
  if (!bytes) return null;
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Documents (DESIGN.md "The desktop app"): add a file or pasted text, then the list, filtered by kind and searched
 * by title, each with its kind's mark and state; edit (the text is read again) and delete. The documents scene heads
 * the page once there's a list (the empty state carries its own).
 */
export function DocumentsScreen({ chrome }: { chrome: Chrome }) {
  const [docs, setDocs] = useState<OrbitDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("resume");
  const [uploading, setUploading] = useState(false);

  const [pasteTitle, setPasteTitle] = useState("Job description");
  const [pasteKind, setPasteKind] = useState<DocumentKind>("job_description");
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<OrbitDocument | null>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");

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

  const upload = async (file: File) => {
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      add(await api.uploadDocument(file, kind, file.name));
      toast({ message: `Added ${file.name}`, tone: "success" });
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
      toast({ message: "Saved to Documents", tone: "success" });
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

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, resume: 0, job_description: 0, notes: 0, other: 0 };
    for (const d of docs ?? []) {
      c.all += 1;
      c[d.kind] += 1;
    }
    return c;
  }, [docs]);
  const shown = (docs ?? []).filter(
    (d) => (filter === "all" || d.kind === filter) && (!query.trim() || d.title.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="flex h-full flex-col">
      <TitleBar current="documents" {...chrome} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-5 py-5 sm:px-6">
          <header className="scene-host flex items-center gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
              <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
                Your resume, job descriptions and notes: answers quote them, so they're about you. Pick up to{" "}
                {MAX_SESSION_DOCUMENTS} for each session in New session.
              </p>
            </div>
            {docs && docs.length > 0 && <DocumentsScene className="-my-4 hidden w-36 shrink-0 md:block" />}
          </header>

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h2 className="text-[15px] font-semibold">Add a file</h2>
              <p className="mb-3 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">PDF, DOCX, TXT or MD, up to {MAX_MB} MB.</p>
              <div className="space-y-3">
                <SegmentedControl
                  label="What it is"
                  size="sm"
                  options={(Object.keys(KIND_LABEL) as DocumentKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                  value={kind}
                  onChange={setKind}
                />
                {/* Dropping needs the window's own drop handler off (dragDropEnabled: false in tauri.conf.json). */}
                <Dropzone accept={DOCUMENT_ACCEPT} busy={uploading} file={null} onFile={(f) => f && void upload(f)} hint={`It's saved as ${KIND_LABEL[kind].toLowerCase()}.`} />
              </div>
            </Card>

            <Card>
              <h2 className="text-[15px] font-semibold">Paste text</h2>
              <p className="mb-3 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">A job post from a page, company notes, project notes.</p>
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
                  <Textarea id="p-text" rows={3} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the job description, company notes, or project notes…" />
                </Field>
                <Button type="submit" loading={saving} loadingText="Saving…" disabled={pasteText.trim().length < 20}>
                  Save
                </Button>
              </form>
            </Card>
          </div>

          {docs === null ? (
            loadError ? (
              <ErrorNote onRetry={reload}>{loadError}</ErrorNote>
            ) : (
              <Card>
                <Skeleton variant="line" count={4} label="Loading your documents" />
              </Card>
            )
          ) : docs.length === 0 ? (
            <CosmicEmptyState variant="documents" title="No documents yet" body="Add your resume and paste the job description so answers are specific to you." />
          ) : (
            <section aria-labelledby="docs-title" className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="docs-title" className="text-[15px] font-semibold">
                  Your documents <span className="font-normal text-zinc-500 dark:text-zinc-400">· {docs.length}</span>
                </h2>
                <span className="flex-1" />
                <SegmentedControl
                  label="Show"
                  size="sm"
                  options={(["all", "resume", "job_description", "notes", "other"] as KindFilter[])
                    .filter((k) => k === "all" || counts[k] > 0)
                    .map((k) => ({ value: k, label: k === "all" ? `All ${counts.all}` : `${KIND_LABEL[k]} ${counts[k]}` }))}
                  value={filter}
                  onChange={setFilter}
                />
                <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles" aria-label="Search documents" className="w-48" />
              </div>
              <Card className="p-0">
                {shown.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No documents match.</p>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                    {shown.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                        <KindMark kind={d.kind} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={d.filename ?? d.title}>
                            {d.title}
                          </p>
                          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {[KIND_LABEL[d.kind], d.filename && d.filename !== d.title ? d.filename : null, sizeText(d.size_bytes), new Date(d.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <StatusBadge doc={d} />
                        <div className="flex shrink-0 gap-1">
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
                )}
              </Card>
            </section>
          )}
        </div>
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

function StatusBadge({ doc }: { doc: OrbitDocument }) {
  if (doc.status === "ready") return <Badge tone="success">Ready</Badge>;
  if (doc.status === "processing") return <Badge tone="warning">Reading…</Badge>;
  return <Badge tone="danger">Couldn’t read it</Badge>;
}

function EditModal({ doc, onClose, onSaved }: { doc: OrbitDocument; onClose: () => void; onSaved: (d: OrbitDocument) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState<DocumentKind>(doc.kind);
  const [text, setText] = useState("");
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Sheet
      open
      onClose={onClose}
      title="Edit document"
      titleId="edit-doc-title"
      size="2xl"
      footer={
        !loading ? (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="edit-document" loading={saving} loadingText="Saving…">
              Save changes
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="px-5 py-4">
        {loading ? (
          <LoadGate loading variant="line" count={6} label="Opening the document">
            {null}
          </LoadGate>
        ) : (
          <form id="edit-document" onSubmit={(e) => void save(e)} className="space-y-4">
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
          </form>
        )}
      </div>
    </Sheet>
  );
}
