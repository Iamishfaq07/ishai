import { useEffect, useState } from "react";
import type { Workspace, WorkspaceInput } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { api } from "./api";

const control =
  "block w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900";
const small = "rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:hover:bg-zinc-900";

/**
 * Saved interview setups: pick one to fill in the session (documents, role, answer style), or save what's on
 * screen as a new one. Audio devices stay per-machine and aren't part of a setup.
 */
export function WorkspaceBar({
  current,
  selectedId,
  onSelect,
}: {
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
    reload().catch(() => setList([]));
  }, []);

  const selected = list.find((w) => w.id === selectedId) ?? null;
  const sameDocs = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  const changed =
    selected !== null &&
    ((selected.role ?? "") !== (current.role ?? "") ||
      selected.session_type !== current.session_type ||
      selected.language !== current.language ||
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
      const ws = await api.updateWorkspace(selected.id, { ...current, name: selected.name, company: selected.company, notes: selected.notes });
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
    <div className="space-y-1.5 rounded-xl border border-indigo-200/60 bg-indigo-50/40 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Saved setup</span>
        {note && <span className="text-[11px] text-zinc-500">{note}</span>}
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
          <button type="button" disabled={busy} onClick={() => void remove()} className={cx(small, "text-rose-600", focusRing)}>
            Delete
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className={cx(small, focusRing)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setNaming(true)} className={cx(small, focusRing)}>
            Save as new setup
          </button>
          {selected && (
            <>
              <button type="button" disabled={busy || !changed} onClick={() => void update()} className={cx(small, focusRing)}
                      title={changed ? "Save the current choices into this setup" : "No changes"}>
                Update “{selected.name}”
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className={cx(small, focusRing)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
