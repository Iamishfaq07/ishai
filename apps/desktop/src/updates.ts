import { useSyncExternalStore } from "react";
import { confirmDialog } from "@orbit/ui";
import { API_URL } from "./api";
import { checkUpdate, downloadUpdate, installUpdate, type UpdateInfo } from "./native";

/**
 * The app-wide auto-update state, shared by the banners and the screens that start sessions.
 *
 * Downloading and installing are separate steps (src-tauri/src/updater.rs) because installing closes Orbit. "Update
 * & restart" downloads, then installs — unless a session started meanwhile: starting one while the update is on
 * its way asks first, and "Start now, update later" lets the update wait. After the session, the banner offers
 * "Restart to update". Rust re-checks before installing that nothing is capturing.
 */
export type UpdatePhase = "idle" | "available" | "downloading" | "ready" | "installing";

export interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  downloaded: number;
  /** Size of the download, when the server says. */
  total: number | null;
  /** All bytes are in; checking the signature. */
  verifying: boolean;
  /** Install as soon as the download is verified: the user chose "Update & restart" and hasn't started a session. */
  installWhenReady: boolean;
  error: string | null;
}

let state: UpdateState = {
  phase: "idle",
  info: null,
  downloaded: 0,
  total: null,
  verifying: false,
  installWhenReady: false,
  error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Just the phase: re-renders on phase changes only, not on every download chunk. */
export function useUpdatePhase(): UpdatePhase {
  return useSyncExternalStore(subscribe, () => state.phase);
}

let checked = false;
/** Checks once per run (again later only if it failed). Failures are quiet: an offline check shouldn't nag. */
export function checkForUpdate(): void {
  if (checked) return;
  checked = true;
  checkUpdate(API_URL)
    .then((info) => {
      if (info && state.phase === "idle") set({ phase: "available", info });
    })
    .catch((err: unknown) => {
      checked = false;
      console.info("Update check skipped:", err);
    });
}

let liveSession = false;
/** The live screen is open: no install may start (Rust also refuses while audio is being captured). */
export function setLiveSession(active: boolean): void {
  liveSession = active;
}

/** "Update & restart": download, then install unless a session started meanwhile. */
export function startUpdate(): void {
  if (state.phase !== "available") return;
  set({ phase: "downloading", downloaded: 0, total: null, verifying: false, installWhenReady: true, error: null });
  let shown = 0;
  downloadUpdate((p) => {
    if (p.kind === "verifying") return set({ verifying: true });
    // Progress comes per network chunk: a few updates a second are plenty for the banner.
    if (performance.now() - shown < 200) return;
    shown = performance.now();
    set({ downloaded: p.downloaded, total: p.total });
  })
    .then(() => {
      set({ phase: "ready", verifying: false });
      if (state.installWhenReady) installNow();
    })
    .catch((err: unknown) => {
      console.warn("Update download failed:", err);
      set({
        phase: "available",
        verifying: false,
        installWhenReady: false,
        error: "The update didn't download. Check your connection and try again in a minute.",
      });
    });
}

/** Keep downloading, but install only when asked ("Restart to update"), e.g. after the session. */
export function postponeUpdate(): void {
  if (state.phase === "downloading") set({ installWhenReady: false });
}

/** Runs the downloaded installer: Orbit closes, and the installer reopens it when done. */
export function installNow(): void {
  if (state.phase !== "ready") return;
  if (liveSession) {
    set({ installWhenReady: false });
    return;
  }
  set({ phase: "installing", installWhenReady: false, error: null });
  installUpdate().catch((err: unknown) => {
    console.warn("Update install failed:", err);
    const text = String(err);
    set({
      phase: "ready",
      error: /still listening|Microsoft Store/i.test(text) ? text : "The update didn't install. Try again in a minute.",
    });
  });
}

/** An install is under way, or due the moment the download finishes: a session started now could be cut short. */
export function updateBlocksSessions(s: UpdateState = state): boolean {
  return s.phase === "installing" || (s.phase === "downloading" && s.installWhenReady);
}

/**
 * Call before starting or rejoining a session. While an update is about to restart Orbit, asks whether to start
 * now (the update then waits until after the session) or wait for it. Resolves to whether to go ahead.
 */
export async function confirmSessionDuringUpdate(): Promise<boolean> {
  if (state.phase === "installing") {
    await confirmDialog({
      title: "Orbit is restarting to update",
      body: "It will be back in a moment. Start the session then.",
      confirmLabel: "OK",
    });
    return false;
  }
  if (!updateBlocksSessions()) return true;
  set({ installWhenReady: false }); // don't restart while the question is open
  const go = await confirmDialog({
    title: "Orbit is downloading an update",
    body: "When the download is done, Orbit restarts to install it. Start the session now and update after it instead?",
    confirmLabel: "Start now, update later",
    cancelLabel: "Wait for the update",
  });
  if (!go) {
    set({ installWhenReady: true });
    if (state.phase === "ready") installNow();
  }
  return go;
}
