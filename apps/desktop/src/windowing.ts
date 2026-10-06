import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PanelMode } from "@orbit/ui";

const SIZES: Record<PanelMode, { width: number; height: number }> = {
  compact: { width: 380, height: 520 },
  expanded: { width: 920, height: 680 },
};

/**
 * Resizes the floating window for the panel mode. Position and custom sizes are persisted by
 * tauri-plugin-window-state; this runs when a screen needs its size (a session opens in its saved mode) or the user
 * switches modes.
 */
export async function applyPanelMode(mode: PanelMode): Promise<void> {
  const { width, height } = SIZES[mode];
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export async function setAlwaysOnTop(on: boolean): Promise<void> {
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
