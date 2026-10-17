import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { safeLocal, type PanelMode } from "@orbit/ui";

const SIZES: Record<PanelMode, { width: number; height: number }> = {
  compact: { width: 380, height: 520 },
  expanded: { width: 920, height: 680 },
};

/** A rectangle on the virtual screen, in physical pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A window this close to the work area's edge (physical px) still counts as inside it. */
const EDGE_SLACK = 2;

/**
 * Where the window's content goes when it's resized to `size` (all physical px): never bigger than the monitor's work
 * area, and, if it was inside the work area, still inside once it has grown (moved up or left as far as needed), so
 * growing near the bottom of a small laptop screen doesn't push the session's buttons under the taskbar. A window
 * the user put partly off-screen stays where they put it.
 */
export function fitWindow(current: Rect, size: { width: number; height: number }, area: Rect): Rect {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const inside =
    current.x >= area.x - EDGE_SLACK &&
    current.y >= area.y - EDGE_SLACK &&
    current.x + current.width <= area.x + area.width + EDGE_SLACK &&
    current.y + current.height <= area.y + area.height + EDGE_SLACK;
  if (!inside) return { x: current.x, y: current.y, width, height };
  return {
    x: Math.max(area.x, Math.min(current.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(current.y, area.y + area.height - height)),
    width,
    height,
  };
}

/**
 * Resizes the floating window for the panel mode, within the monitor's work area (fitWindow). Position and custom
 * sizes are persisted by tauri-plugin-window-state; this runs when a screen needs its size (a session opens in its
 * saved mode) or the user switches modes.
 */
export async function applyPanelMode(mode: PanelMode): Promise<void> {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const want = { width: Math.round(SIZES[mode].width * scale), height: Math.round(SIZES[mode].height * scale) };
  const where = await Promise.all([currentMonitor(), win.innerPosition(), win.outerPosition(), win.innerSize()]).catch(
    () => null,
  );
  const [monitor, inner, outer, size] = where ?? [null, null, null, null];
  if (!monitor || !inner || !outer || !size) {
    await win.setSize(new PhysicalSize(want.width, want.height));
    return;
  }
  const area = { ...monitor.workArea.position, ...monitor.workArea.size };
  const fit = fitWindow({ x: inner.x, y: inner.y, width: size.width, height: size.height }, want, area);
  if (fit.x !== inner.x || fit.y !== inner.y) {
    // setPosition places the outer frame (its invisible resize borders too): offset it so the content lands at `fit`.
    await win
      .setPosition(new PhysicalPosition(fit.x - (inner.x - outer.x), fit.y - (inner.y - outer.y)))
      .catch(() => undefined);
  }
  await win.setSize(new PhysicalSize(fit.width, fit.height));
}

/** The "Always on top" pin (the live window's pin button): on unless the user turned it off. */
const PIN_KEY = "orbit.desktop.alwaysOnTop";

export function loadAlwaysOnTop(): boolean {
  return safeLocal.getItem(PIN_KEY) !== "false";
}

/** Saves the pin and applies it to the window. */
export async function setAlwaysOnTop(on: boolean): Promise<void> {
  safeLocal.setItem(PIN_KEY, String(on));
  await getCurrentWindow().setAlwaysOnTop(on);
}

/**
 * The global "Show / hide Orbit". A minimized window counts as hidden: it's still "visible" to Windows, show() leaves
 * it minimized and setFocus() does nothing to it, so it's restored first.
 */
export async function toggleMainWindow(): Promise<void> {
  const win = getCurrentWindow();
  if ((await win.isVisible()) && !(await win.isMinimized())) {
    await win.hide();
  } else {
    await win.unminimize();
    await win.show();
    await win.setFocus();
  }
}
