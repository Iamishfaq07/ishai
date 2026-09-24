import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OrbitLogo, cx, focusRing } from "@orbit/ui";

/** What the × / Alt+F4 does. "ask" shows the dialog; the others are a remembered choice. */
export type CloseAction = "ask" | "tray" | "quit";
const KEY = "orbit.closeAction";
const REQUEST_EVENT = "orbit:request-close";

export function loadCloseAction(): CloseAction {
  const v = localStorage.getItem(KEY);
  return v === "tray" || v === "quit" ? v : "ask";
}

export function saveCloseAction(action: CloseAction): void {
  localStorage.setItem(KEY, action);
}

/** Title-bar × buttons call this instead of hiding the window directly. */
export function requestClose(): void {
  window.dispatchEvent(new Event(REQUEST_EVENT));
}

const hideToTray = () => void getCurrentWindow().hide();
const quitApp = () => void invoke("quit_app");

/**
 * Graphical "close Orbit?" dialog for the × button and Alt+F4: hide to tray, quit, or cancel — with
 * "remember my choice". A remembered "quit" still asks while a live session is running.
 */
export function CloseDialog({ liveActive }: { liveActive: boolean }) {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const liveRef = useRef(liveActive);
  liveRef.current = liveActive;
  const hideBtn = useRef<HTMLButtonElement>(null);

  const onRequest = useCallback(() => {
    const action = loadCloseAction();
    if (action === "tray") return hideToTray();
    if (action === "quit" && !liveRef.current) return quitApp();
    setRemember(false);
    setOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(REQUEST_EVENT, onRequest);
    // Alt+F4 / taskbar "Close window" arrive as a native close request.
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      onRequest();
    });
    return () => {
      window.removeEventListener(REQUEST_EVENT, onRequest);
      void unlisten.then((fn) => fn());
    };
  }, [onRequest]);

  useEffect(() => {
    if (!open) return;
    hideBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const choose = (action: Exclude<CloseAction, "ask">) => {
    if (remember) saveCloseAction(action);
    setOpen(false);
    if (action === "tray") hideToTray();
    else quitApp();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-title"
        className="glass-solid w-full max-w-[320px] animate-scale-in rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/10">
            <OrbitLogo size={26} />
          </span>
          <div>
            <h2 id="close-title" className="font-semibold">
              Close Orbit?
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Keep it ready in the tray, or quit completely.</p>
          </div>
        </div>

        {liveActive && (
          <p className="mb-3 animate-fade-up rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            A live session is running. <b>Quit</b> ends it; <b>Hide</b> keeps listening in the background.
          </p>
        )}

        <div className="grid gap-2">
          <button
            ref={hideBtn}
            type="button"
            onClick={() => choose("tray")}
            className={cx(
              "flex items-center gap-3 rounded-xl bg-indigo-600 px-3 py-2.5 text-left text-sm font-medium text-white hover:bg-indigo-500",
              focusRing,
            )}
          >
            <TrayIcon />
            <span>
              Hide to tray
              <span className="block text-xs font-normal text-indigo-100">Reopen from the tray or its shortcut</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => choose("quit")}
            className={cx(
              "group flex items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-300",
              focusRing,
            )}
          >
            <PowerIcon />
            Quit Orbit
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cx("rounded-xl px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800", focusRing)}
          >
            Cancel
          </button>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-indigo-500" />
          Remember my choice (change it in Settings)
        </label>
      </div>
    </div>
  );
}

function TrayIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M3 13h14v3H3z" fill="currentColor" opacity="0.35" />
      <path d="M10 3v7m0 0-3-3m3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M10 3v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 5.5a6 6 0 1 0 8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
