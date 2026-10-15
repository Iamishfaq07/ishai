import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { safeLocal } from "@orbit/ui";

/**
 * Window privacy (Settings → Window privacy, and a one-time choice on Home). Both off until the person chooses:
 * - `shield`: keep Orbit's windows out of screenshots, screen recordings and Windows Recall (Windows display
 *   affinity). Not every capture method honours it, and it hides nothing from Task Manager, other programs or anyone
 *   who can see the screen.
 * - `hideFromTaskbar`: a separate choice; Orbit is in the taskbar like any app unless this is on.
 * `chosen` is false until the person has answered once, so Home can ask (never preselected).
 */
export interface WindowPrivacy {
  shield: boolean;
  hideFromTaskbar: boolean;
  chosen: boolean;
}

const KEY = "orbit.windowPrivacy";
export const DEFAULT_WINDOW_PRIVACY: WindowPrivacy = { shield: false, hideFromTaskbar: false, chosen: false };

export function parseWindowPrivacy(raw: string | null): WindowPrivacy {
  try {
    const p = JSON.parse(raw ?? "{}") as Partial<Record<keyof WindowPrivacy, unknown>>;
    return { shield: p.shield === true, hideFromTaskbar: p.hideFromTaskbar === true, chosen: p.chosen === true };
  } catch {
    return DEFAULT_WINDOW_PRIVACY;
  }
}

export function loadWindowPrivacy(): WindowPrivacy {
  return parseWindowPrivacy(safeLocal.getItem(KEY));
}

/** Applies it to every Orbit window at once (no restart). Outside the desktop app, a no-op. */
export function applyWindowPrivacy(p: WindowPrivacy): Promise<void> {
  return invoke<void>("set_window_privacy", { shield: p.shield, hideFromTaskbar: p.hideFromTaskbar }).catch(() => undefined);
}

export function initWindowPrivacy(): void {
  void applyWindowPrivacy(loadWindowPrivacy());
}

export function useWindowPrivacy(): [WindowPrivacy, (patch: Partial<WindowPrivacy>) => void] {
  const [prefs, setPrefs] = useState<WindowPrivacy>(loadWindowPrivacy);
  const update = useCallback((patch: Partial<WindowPrivacy>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch, chosen: true };
      safeLocal.setItem(KEY, JSON.stringify(next));
      void applyWindowPrivacy(next);
      return next;
    });
  }, []);
  return [prefs, update];
}
