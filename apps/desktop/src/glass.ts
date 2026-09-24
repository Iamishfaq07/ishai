import { useCallback, useEffect, useState } from "react";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";

/**
 * See-through window. Only BACKGROUNDS fade (index.css `html.glass` rules scale their alpha by --glass);
 * text, icons and borders stay fully opaque, and a soft text shadow keeps them readable once the window
 * gets very transparent. Optional Windows acrylic blurs whatever is behind the window.
 */
export interface GlassPrefs {
  /** Background opacity, 0.3 (very see-through) … 1 (solid). */
  opacity: number;
  blur: boolean;
}

export const GLASS_MIN = 0.3;
const KEY = "orbit.glass";
const DEFAULT: GlassPrefs = { opacity: 1, blur: false };

export function loadGlass(): GlassPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<GlassPrefs>;
    const opacity = typeof p.opacity === "number" ? Math.min(1, Math.max(GLASS_MIN, p.opacity)) : DEFAULT.opacity;
    return { opacity, blur: Boolean(p.blur) };
  } catch {
    return DEFAULT;
  }
}

export function applyGlass(prefs: GlassPrefs): void {
  const root = document.documentElement;
  root.style.setProperty("--glass", String(prefs.opacity));
  root.classList.toggle("glass", prefs.opacity < 1 || prefs.blur);
  root.classList.toggle("glass-low", prefs.opacity < 0.7);
  const win = getCurrentWindow();
  // Not every Windows build supports acrylic; a failure just means no blur.
  void (prefs.blur ? win.setEffects({ effects: [Effect.Acrylic] }) : win.clearEffects()).catch(() => undefined);
}

export function initGlass(): void {
  applyGlass(loadGlass());
}

export function useGlass(): [GlassPrefs, (patch: Partial<GlassPrefs>) => void] {
  const [prefs, setPrefs] = useState<GlassPrefs>(loadGlass);
  useEffect(() => {
    applyGlass(prefs);
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);
  const update = useCallback((patch: Partial<GlassPrefs>) => setPrefs((p) => ({ ...p, ...patch })), []);
  return [prefs, update];
}
