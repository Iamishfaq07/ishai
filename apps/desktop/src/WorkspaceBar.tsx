import type { Workspace, WorkspaceInput } from "@orbit/types";
import { WorkspaceBar as SharedWorkspaceBar } from "@orbit/ui";
import { api } from "./api";

/** Saved interview setups — the shared picker (packages/ui), bound to the desktop API client. */
export function WorkspaceBar(props: {
  current: Omit<WorkspaceInput, "name">;
  selectedId: string | null;
  onSelect: (ws: Workspace | null) => void;
}) {
  return <SharedWorkspaceBar api={api} {...props} />;
}
