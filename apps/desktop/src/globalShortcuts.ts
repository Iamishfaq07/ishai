import { useEffect, useState } from "react";
import { register, unregister, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { safeLocal } from "@orbit/ui";

/**
 * System-wide shortcuts (they work while another app — Zoom, Teams, the browser — is focused).
 *
 * Registered once for the whole app; a press is broadcast as an `orbit:shortcut` window event. The App handles
 * window/transparency actions itself; the live screen handles the session ones.
 *
 * A global shortcut takes its combo away from every other app, so the defaults avoid all the shortcuts Microsoft
 * Teams (desktop and web), Zoom and Google Meet document, and combos people rely on everywhere (Ctrl+Shift+←/→
 * selects words…). They're Ctrl+Shift + a digit, and Ctrl+Alt + a key that types nothing (Space, arrows, Page Up/
 * Down): Ctrl+Alt + a letter or digit is AltGr on many keyboard layouts (AltGr+Q = @, AltGr+E = €) and would block
 * typing. One overlap is left: Teams *in a browser* jumps between its app-bar apps with Ctrl+Shift+1…9 (navigation,
 * not call controls). The old defaults collided with calls: Ctrl+Shift+O (Teams: camera on/off; Zoom: AI panel),
 * Ctrl+Shift+Y (Teams: admit from the lobby; Zoom: reactions), Ctrl+Alt+P (Meet: participants), and Teams'
 * Ctrl+Shift+Enter and Ctrl+Alt+←/→. Whoever still has those is moved to the new ones (`migrateShortcuts`).
 * Chosen for Windows; a macOS build needs its own (Cmd+Shift+3/4 take screenshots there).
 */
export type GlobalAction =
  | "toggleWindow"
  | "answer"
  | "screenshot"
  | "prevAnswer"
  | "nextAnswer"
  | "copyAnswer"
  | "togglePause"
  | "moreTransparent"
  | "lessTransparent";

export const GLOBAL_DEFAULTS: Record<GlobalAction, string> = {
  toggleWindow: "CommandOrControl+Shift+1",
  answer: "CommandOrControl+Alt+Space",
  screenshot: "CommandOrControl+Shift+2",
  prevAnswer: "CommandOrControl+Alt+PageUp",
  nextAnswer: "CommandOrControl+Alt+PageDown",
  copyAnswer: "CommandOrControl+Shift+3",
  togglePause: "CommandOrControl+Shift+4",
  moreTransparent: "CommandOrControl+Alt+Down",
  lessTransparent: "CommandOrControl+Alt+Up",
};

/** The defaults these replaced (see above). An action still bound to its old default was never changed by the user. */
const OLD_DEFAULTS: Partial<Record<GlobalAction, string>> = {
  toggleWindow: "CommandOrControl+Shift+O",
  answer: "CommandOrControl+Shift+Enter",
  prevAnswer: "CommandOrControl+Alt+Left",
  nextAnswer: "CommandOrControl+Alt+Right",
  copyAnswer: "CommandOrControl+Shift+Y",
  togglePause: "CommandOrControl+Alt+P",
};

/**
 * Saved bindings with the old defaults moved to the new ones: only actions still on their old default move (a combo
 * the user picked stays), and never onto a combo another action is already bound to.
 */
export function migrateShortcuts(saved: Partial<Record<GlobalAction, string>>): Partial<Record<GlobalAction, string>> {
  const out = { ...saved };
  const bound = (action: GlobalAction) => out[action] ?? GLOBAL_DEFAULTS[action];
  for (const action of Object.keys(OLD_DEFAULTS) as GlobalAction[]) {
    if (out[action] !== OLD_DEFAULTS[action]) continue;
    const next = GLOBAL_DEFAULTS[action];
    const taken = (Object.keys(GLOBAL_DEFAULTS) as GlobalAction[]).some((a) => a !== action && bound(a) === next);
    if (!taken) delete out[action]; // back on the default
  }
  return out;
}

export const GLOBAL_LABELS: Record<GlobalAction, string> = {
  toggleWindow: "Show / hide Orbit",
  answer: "Answer now",
  screenshot: "Screenshot a region",
  prevAnswer: "Previous answer",
  nextAnswer: "Next answer",
  copyAnswer: "Copy the answer",
  togglePause: "Pause / resume listening",
  moreTransparent: "More transparent",
  lessTransparent: "Less transparent",
};

/** Actions that only mean something during a live session (handled by the live screen). */
export const LIVE_ACTIONS: ReadonlySet<GlobalAction> = new Set([
  "answer", "screenshot", "prevAnswer", "nextAnswer", "copyAnswer", "togglePause",
]);

const KEY = "orbit.globalShortcuts";
const ENABLED_KEY = "orbit.globalShortcutsEnabled";
export const SHORTCUT_EVENT = "orbit:shortcut";
const CHANGED_EVENT = "orbit:shortcuts-changed";

export function loadShortcuts(): Record<GlobalAction, string> {
  try {
    const saved = JSON.parse(safeLocal.getItem(KEY) ?? "{}") as Partial<Record<GlobalAction, string>>;
    return { ...GLOBAL_DEFAULTS, ...migrateShortcuts(saved) };
  } catch {
    return { ...GLOBAL_DEFAULTS };
  }
}

export function shortcutsEnabled(): boolean {
  return safeLocal.getItem(ENABLED_KEY) !== "false";
}

export function saveShortcuts(map: Record<GlobalAction, string>, enabled: boolean): void {
  safeLocal.setItem(KEY, JSON.stringify(map));
  safeLocal.setItem(ENABLED_KEY, String(enabled));
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Tauri accelerator from a keydown ("CommandOrControl+Alt+Left"); null until a real key + modifier. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null; // a bare key would fire while typing in every app
  const named: Record<string, string> = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", " ": "Space" };
  const code = e.code.startsWith("Digit") ? e.code.slice(5) : e.code.startsWith("Key") ? e.code.slice(3) : null;
  const key = named[e.key] ?? code ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [...mods, key].join("+");
}

/** "Ctrl+Alt+←" for display. */
export function formatAccelerator(acc: string): string {
  const short: Record<string, string> = { Left: "←", Right: "→", Up: "↑", Down: "↓", PageUp: "PgUp", PageDown: "PgDn" };
  return acc
    .split("+")
    .map((p) => (p === "CommandOrControl" ? "Ctrl" : (short[p] ?? p)))
    .join("+");
}

/** Shortcuts another app already owns (registration failed) — shown in Settings. */
let unavailable = new Set<string>();
export const unavailableShortcuts = (): ReadonlySet<string> => unavailable;

/** Registers every enabled shortcut for the app's lifetime; re-registers when Settings change them. */
export function useGlobalShortcuts(): void {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED_EVENT, bump);
    return () => window.removeEventListener(CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    let disposed = false;
    const registered: string[] = [];
    const failed = new Set<string>();
    void (async () => {
      // A page reload (e.g. after changing the server) leaves the previous page's registrations behind in the
      // native plugin, bound to handlers that no longer exist — every new register() would then fail as
      // "already registered". These are only ever Orbit's own shortcuts, so clear them first.
      await unregisterAll().catch(() => undefined);
      if (disposed) return;
      if (!shortcutsEnabled()) {
        unavailable = new Set();
        return;
      }
      const map = loadShortcuts();
      for (const action of Object.keys(map) as GlobalAction[]) {
        const acc = map[action];
        try {
          await register(acc, (event) => {
            if (event.state === "Pressed") window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT, { detail: action }));
          });
          if (disposed) await unregister(acc).catch(() => undefined);
          else registered.push(acc);
        } catch (err) {
          failed.add(acc);
          console.warn(`Global shortcut ${acc} unavailable`, err);
        }
      }
      if (!disposed) unavailable = failed;
    })();
    return () => {
      disposed = true;
      for (const acc of registered) void unregister(acc).catch(() => undefined);
    };
  }, [version]);
}

/** Subscribe to global shortcut presses. */
export function useShortcutHandler(handler: (action: GlobalAction) => void): void {
  useEffect(() => {
    const on = (e: Event) => handler((e as CustomEvent<GlobalAction>).detail);
    window.addEventListener(SHORTCUT_EVENT, on);
    return () => window.removeEventListener(SHORTCUT_EVENT, on);
  }, [handler]);
}
