import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, safeLocal } from "@orbit/ui";
import { api } from "./api";
import { useAuth } from "./auth";
import { readWorkspaceDraft, workspaceKey, type WorkspaceKind } from "./careerWorkspace";

interface Stored<T> { revision: number; data: T | null }
export function useCareerWorkspace<T>(kind: WorkspaceKind, empty: T, valid: (v: unknown) => v is T, legacyKey: string) {
  const { user } = useAuth();
  const owner = user?.id ?? "";
  const identity = useRef(owner); identity.current = owner;
  const [value, setValue] = useState<T>(empty);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [legacy, setLegacy] = useState<T | null>(null);
  const generation = useRef(0);
  const path = `/v1/career/workspace/${kind}`;

  const load = useCallback(async (discardDraft = false) => {
    if (!owner) return;
    const request = ++generation.current;
    setError(""); setLoaded(false);
    const draft = discardDraft ? null : readWorkspaceDraft(owner, kind, valid);
    if (draft) { setValue(draft.data); setRevision(draft.revision); setDirty(true); }
    try {
      const remote = await api.call<Stored<T>>(path);
      if (identity.current !== owner || generation.current !== request) return;
      if (remote.data !== null && !valid(remote.data)) throw new Error("Stored work could not be read. Export your account data before making changes.");
      if (draft) {
        setConflict(draft.revision !== remote.revision);
        if (draft.revision !== remote.revision) setError("Your account has a newer version. Download your draft before loading it.");
      } else {
        setValue(remote.data ?? empty); setRevision(remote.revision); setDirty(false); setConflict(false);
        safeLocal.removeItem(workspaceKey(owner, kind));
      }
      setLoaded(true);
    } catch (e) {
      if (identity.current === owner && generation.current === request) {
        setLoaded(Boolean(draft));
        setError(e instanceof Error ? e.message : "Could not load your work.");
      }
    }
  }, [owner, kind, valid, path, empty]);

  useEffect(() => {
    setLoaded(false); setSaving(false); setValue(empty); setDirty(false); setConflict(false); setRevision(0);
    try { const raw: unknown = JSON.parse(safeLocal.getItem(legacyKey) ?? "null"); setLegacy(valid(raw) ? raw : null); }
    catch { setLegacy(null); }
    void load();
    const pending = generation;
    return () => { pending.current++; };
  }, [load, empty, legacyKey, valid]);

  const change = (next: T) => {
    if (!owner || !loaded || saving || conflict) return;
    setValue(next); setDirty(true);
    safeLocal.setItem(workspaceKey(owner, kind), JSON.stringify({ revision, data: next }));
  };
  const save = async () => {
    if (!owner || !loaded || saving || conflict || !dirty) return;
    const request = generation.current;
    setSaving(true); setError("");
    try {
      const result = await api.call<Stored<T>>(path, { method: "PUT", body: JSON.stringify({ revision, data: value }) });
      if (identity.current !== owner || generation.current !== request) return;
      setRevision(result.revision); setDirty(false); safeLocal.removeItem(workspaceKey(owner, kind));
    } catch (e) {
      if (identity.current !== owner || generation.current !== request) return;
      setConflict(e instanceof ApiError && e.status === 409);
      setError(e instanceof Error ? e.message : "Could not save. Your draft stays on this device.");
    } finally { if (identity.current === owner && generation.current === request) setSaving(false); }
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return { value, change, save, loaded, dirty, saving, error, conflict, legacy,
    reload: () => load(true),
    dismissLegacy: () => { safeLocal.removeItem(legacyKey); setLegacy(null); },
    importLegacy: () => { if (legacy) change(legacy); },
  };
}
