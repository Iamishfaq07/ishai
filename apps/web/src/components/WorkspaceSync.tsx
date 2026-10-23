import { Button } from "./ui";

export interface WorkspaceSyncProps {
  loaded: boolean; dirty: boolean; saving: boolean; conflict: boolean; error: string; legacy: unknown;
  value: unknown; save: () => Promise<void>; reload: () => Promise<void>;
  dismissLegacy: () => void; importLegacy: () => void;
}
export function WorkspaceSync(state: WorkspaceSyncProps) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "orbit-workspace-draft.json"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section aria-label="Save and recovery" className="mb-4 space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
    <p role="status" className="text-sm">{state.saving ? "Saving…" : !state.loaded ? "Loading your account work…" : state.dirty ? "Unsaved changes · local draft" : "Account version loaded · available on your other devices"}</p>
    {state.dirty && <p className="text-xs text-zinc-500">Save to sync, or download a backup. Browser drafts may be lost if storage is blocked or you sign out.</p>}
    {state.error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{state.error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={!state.loaded || !state.dirty || state.saving || state.conflict} onClick={() => void state.save()}>Save changes</Button>
      {state.dirty && <Button variant="ghost" onClick={download}>Download draft</Button>}
      <Button variant="ghost" disabled={state.saving} onClick={() => {
        if (!state.dirty || window.confirm("Replace this unsaved draft with the account version? Download it first if you want to keep it.")) void state.reload();
      }}>Load account version</Button>
    </div>
    {state.legacy !== null && <details className="text-sm">
      <summary>Review older data saved on this browser</summary>
      <p className="my-2">This data has no account owner recorded. Import it only if it is yours. Import replaces this tool's current draft; save separately after reviewing.</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state.legacy, null, 2)}</pre>
      <div className="mt-2 flex flex-wrap gap-2"><Button variant="secondary" disabled={!state.loaded || state.saving || state.conflict} onClick={state.importLegacy}>Use as my draft</Button><Button variant="ghost" onClick={state.dismissLegacy}>Remove old browser copy</Button></div>
    </details>}
  </section>;
}
