import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X, OrbitLogo, cx, focusRing, type LucideIcon } from "@orbit/ui";
import { requestClose } from "./CloseDialog";
import { GlassButton } from "./GlassControls";
import { UpdatePill } from "./UpdateBanner";

/** Frameless-window chrome: drag handle, an update when there is one (`update={false}` on screens showing the
 * UpdateBanner instead), transparency, minimize, and close (asks: hide to tray or quit). */
export function TitleBar({ title = "Orbit", update = true, children }: { title?: string; update?: boolean; children?: ReactNode }) {
  const win = getCurrentWindow();
  return (
    <div
      data-tauri-drag-region=""
      className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-zinc-200/80 bg-white/85 px-3 dark:border-white/[0.06] dark:bg-zinc-950/70"
    >
      <span data-tauri-drag-region="" className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight">
        <OrbitLogo size={18} />
        {title === "Orbit" ? "orbit" : title}
      </span>
      <span data-tauri-drag-region="" className="flex-1 self-stretch" />
      {update && <UpdatePill />}
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
        className={cx("hit-area relative inline-flex items-center rounded-lg p-1.5 text-xs text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 active:bg-zinc-900/10 dark:hover:bg-white/10 dark:hover:text-zinc-100 dark:active:bg-white/15", focusRing)}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={hide}
        aria-label="Close"
        title="Close — hide to tray or quit"
        className={cx("hit-area relative inline-flex items-center rounded-lg p-1.5 text-xs text-zinc-500 hover:bg-rose-500/15 hover:text-rose-600 active:bg-rose-500/25 dark:hover:text-rose-300", focusRing)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** Icon button for the title bar (label is the tooltip and the accessible name). */
export function TitleBarButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx(
        "hit-area relative inline-flex items-center rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 active:bg-zinc-900/10 dark:hover:bg-white/10 dark:hover:text-zinc-100 dark:active:bg-white/15",
        focusRing,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
