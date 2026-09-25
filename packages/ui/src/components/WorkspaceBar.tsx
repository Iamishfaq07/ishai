import { useEffect, useState } from "react";
import type { Workspace, WorkspaceInput } from "@orbit/types";
import type { ApiClient } from "../api/client";
import { Bookmark, Save, Trash2 } from "../icons";
import { cx, focusRing } from "./cx";

type WorkspaceApi = Pick<ApiClient, "listWorkspaces" | "createWorkspace" | "updateWorkspace" | "deleteWorkspace">;

const control =
  "block w-full rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 text-sm transition-colors hover:border-zinc-300 focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-950/60 dark:hover:border-white/20 dark:focus:border-indigo-400";
const small =
  "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/60 px-2.5 py-1 text-xs font-medium hover:border-zinc-300 hover:bg-white disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 dark:hover:bg-white/10";

/**
 * Saved interview setups ("Google — Senior Security Engineer"): pick one to fill in the session (documents, role,
 * answer style, language), or save what's on screen as a new one. Audio devices stay per-machine and aren't part of a
 * setup. Shared by the web and desktop setup screens.
 */
export function WorkspaceBar({
  api,
  current,
  selectedId,
  onSelect,
}: {
  api: WorkspaceApi;
  /** What's on screen now, as a setup. */
  current: Omit<WorkspaceInput, "name">;
  selectedId: string | null;
  onSelect: (ws: Workspace | null) => void;
}) {
  const [list, setList] = useState<Workspace[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = async () => setList(await api.listWorkspaces());
  useEffect(() => {
    api
      .listWorkspaces()
      .then(setList)
      .catch(() => setList([]));
  }, [api]);

  const selected = list.find((w) => w.id === selectedId) ?? null;
  const sameDocs = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  const changed =
    selected !== null &&
    ((selected.role ?? "") !== (current.role ?? "") ||
      selected.session_type !== current.session_type ||
      selected.language !== current.language ||
      (selected.answer_language ?? null) !== (current.answer_language ?? null) ||
      selected.length !== current.length ||
      selected.style !== current.style ||
      selected.auto_answer !== current.auto_answer ||
      !sameDocs(selected.document_ids, current.document_ids));

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote(done);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const ws = await api.createWorkspace({ ...current, name: name.trim() });
      await reload();
      onSelect(ws);
      setNaming(false);
      setName("");
    }, "Saved.");

  const update = () =>
    run(async () => {
      if (!selected) return;
      const ws = await api.updateWorkspace(selected.id, {
        ...current,
        name: selected.name,
        company: selected.company,
        notes: selected.notes,
      });
      await reload();
      onSelect(ws);
    }, "Setup updated.");

  const remove = () =>
    run(async () => {
      if (!selected) return;
      await api.deleteWorkspace(selected.id);
      setConfirmDelete(false);
      onSelect(null);
      await reload();
    }, "Setup deleted. Past sessions are kept.");

  return (
    <section
      aria-label="Saved setup"
      className="space-y-2 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-aurora-400/5 p-3.5 ring-1 ring-indigo-500/20"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Bookmark className="h-3.5 w-3.5 text-indigo-500" />
          Saved setup
        </span>
        {note && (
          <span role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
            {note}
          </span>
        )}
      </div>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(list.find((w) => w.id === e.target.value) ?? null)}
        aria-label="Saved setup"
        className={cx(control, focusRing)}
      >
        <option value="">{list.length ? "None — set up this session by hand" : "No saved setups yet"}</option>
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.session_count ? ` · ${w.session_count} session${w.session_count === 1 ? "" : "s"}` : ""}
          </option>
        ))}
      </select>
      {naming ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                e.preventDefault();
                void save();
              }
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="e.g. Google — Senior Security Engineer"
            maxLength={120}
            aria-label="Setup name"
            className={cx(control, focusRing)}
          />
          <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className={cx(small, focusRing)}>
            Save
          </button>
          <button type="button" onClick={() => setNaming(false)} className={cx(small, focusRing)}>
            Cancel
          </button>
        </div>
      ) : confirmDelete ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="flex-1">Delete “{selected?.name}”? Documents and past sessions stay.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className={cx(small, "text-rose-600 dark:text-rose-400", focusRing)}
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className={cx(small, focusRing)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setNaming(true)} className={cx(small, focusRing)}>
            <Save className="h-3.5 w-3.5" />
            Save as new setup
          </button>
          {selected && (
            <>
              <button
                type="button"
                disabled={busy || !changed}
                onClick={() => void update()}
                className={cx(small, focusRing)}
                title={changed ? "Save the current choices into this setup" : "No changes"}
              >
                Update “{selected.name}”
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className={cx(small, focusRing)}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
