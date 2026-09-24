import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OrbitLogo, cx, focusRing } from "@orbit/ui";
import { requestClose } from "./CloseDialog";
import { GlassButton } from "./GlassControls";

/** Frameless-window chrome: drag handle, transparency, minimize, and close (asks: hide to tray or quit). */
export function TitleBar({ title = "Orbit", children }: { title?: string; children?: ReactNode }) {
  const win = getCurrentWindow();
  return (
    <div
      data-tauri-drag-region=""
      className="flex h-9 shrink-0 select-none items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800"
    >
      <span data-tauri-drag-region="" className="flex items-center gap-2 text-xs font-semibold">
        <OrbitLogo size={16} />
        {title}
      </span>
      <span data-tauri-drag-region="" className="flex-1 self-stretch" />
      {children}
      <GlassButton />
      <WindowButtons minimize={() => void win.minimize()} hide={requestClose} />
    </div>
  );
}

export function WindowButtons({ minimize, hide }: { minimize: () => void; hide: () => void }) {
  return (
    <span className="flex items-center">
      <button
        type="button"
        onClick={minimize}
        aria-label="Minimize"
        className={cx("rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", focusRing)}
      >
        —
      </button>
      <button
        type="button"
        onClick={hide}
        aria-label="Close"
        title="Close — hide to tray or quit"
        className={cx("rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", focusRing)}
      >
        ×
      </button>
    </span>
  );
}
