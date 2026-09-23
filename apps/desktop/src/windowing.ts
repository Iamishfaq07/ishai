import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PanelMode } from "@orbit/ui";

const SIZES: Record<PanelMode, { width: number; height: number }> = {
  compact: { width: 380, height: 520 },
  expanded: { width: 920, height: 680 },
};

/**
 * Resizes the floating window for the panel mode. Position and custom sizes are persisted by
 * tauri-plugin-window-state; this only runs when the user switches modes.
 */
export async function applyPanelMode(mode: PanelMode): Promise<void> {
  const { width, height } = SIZES[mode];
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export async function setAlwaysOnTop(on: boolean): Promise<void> {
  await getCurrentWindow().setAlwaysOnTop(on);
}

export async function toggleMainWindow(): Promise<void> {
  const win = getCurrentWindow();
  if (await win.isVisible()) {
    await win.hide();
  } else {
    await win.show();
    await win.setFocus();
  }
}
