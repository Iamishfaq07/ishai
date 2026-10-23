import { safeLocal } from "@orbit/ui";

export type WorkspaceKind = "readiness" | "campus" | "priority" | "projects";
export interface WorkspaceDraft<T> { revision: number; data: T }
export const workspaceKey = (account: string, kind: WorkspaceKind) => `orbit.workspace.${account}.${kind}`;
export function readWorkspaceDraft<T>(account: string, kind: WorkspaceKind, valid: (value: unknown) => value is T): WorkspaceDraft<T> | null {
  try {
    const raw: unknown = JSON.parse(safeLocal.getItem(workspaceKey(account, kind)) ?? "null");
    if (!raw || typeof raw !== "object" || !("revision" in raw) || !("data" in raw)) return null;
    return typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 0 && valid(raw.data)
      ? { revision: raw.revision, data: raw.data } : null;
  } catch { return null; }
}
export function clearWorkspaceDrafts(): void {
  for (const key of safeLocal.keys()) if (key.startsWith("orbit.workspace.")) safeLocal.removeItem(key);
}
