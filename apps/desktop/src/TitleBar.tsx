import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Avatar,
  CreditCard,
  FolderOpen,
  Globe,
  HistoryIcon,
  House,
  LogOut,
  Minus,
  OrbitLogo,
  SettingsIcon,
  Square,
  X,
  cx,
  floatingClass,
  focusRing,
  menuItemClass,
  menuKeys,
  useDismiss,
  type LucideIcon,
} from "@orbit/ui";
import { requestClose } from "./CloseDialog";
import { GlassButton } from "./GlassControls";
import { UpdatePill } from "./UpdateBanner";

/** The app's own places, in the title bar of every signed-in screen (the live overlay has its own header). */
export type NavTarget = "home" | "documents" | "history" | "settings";

const NAV: Array<{ id: NavTarget; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: House },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export interface AccountMenuProps {
  name: string | null;
  email: string | null;
  onBilling: () => void;
  onWeb: () => void;
  onSignOut: () => void;
}

/**
 * The frameless window's chrome (DESIGN.md "The desktop app"): the mark, the app's places as tabs, the screen's own
 * actions, an update when there is one (`update={false}` on screens showing the UpdateBanner instead), the account,
 * transparency, and Windows' own three window buttons. Everything that isn't a control drags the window, and a
 * double-click on it maximizes, as in any Windows app.
 */
export function TitleBar({
  title,
  current,
  onNavigate,
  account,
  update = true,
  children,
}: {
  /** Shown instead of the tabs (sign-in, starting up). */
  title?: string;
  /** The tab you're on; none while setting up a session. */
  current?: NavTarget | null;
  /** With it, the tabs show. */
  onNavigate?: (to: NavTarget) => void;
  account?: AccountMenuProps;
  update?: boolean;
  children?: ReactNode;
}) {
  const win = getCurrentWindow();
  return (
    <header
      data-tauri-drag-region=""
      className="flex h-10 shrink-0 select-none items-stretch border-b border-zinc-200 bg-white dark:border-white/[0.07] dark:bg-zinc-950"
    >
      <span data-tauri-drag-region="" className="flex items-center gap-2 pl-3 pr-3">
        <OrbitLogo size={18} />
        <span data-tauri-drag-region="" className={cx("text-[13px] font-semibold tracking-tight", onNavigate && "max-sm:sr-only")}>
          {title ?? "Orbit"}
        </span>
      </span>
      {onNavigate && (
        <nav aria-label="Orbit" className="flex items-stretch">
          {NAV.map(({ id, label, icon: Icon }) => {
            const on = current === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                aria-current={on ? "page" : undefined}
                title={label}
                className={cx(
                  "relative flex items-center gap-1.5 px-3 text-[13px] font-medium transition-colors duration-quick",
                  on
                    ? "text-zinc-900 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-900/[0.04] hover:text-zinc-900 active:bg-zinc-900/[0.07] dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white dark:active:bg-white/10",
                  focusRing,
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="max-sm:sr-only">{label}</span>
                {on && <span aria-hidden="true" className="nav-mark absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
              </button>
            );
          })}
        </nav>
      )}
      <span data-tauri-drag-region="" className="min-w-2 flex-1" />
      <span className="flex items-center gap-1.5 pr-1">
        {update && <UpdatePill />}
        {children}
        {account && <AccountMenu {...account} />}
        <GlassButton />
      </span>
      <WindowButtons minimize={() => void win.minimize()} hide={requestClose} maximize />
    </header>
  );
}

/** The signed-in person, with the account's places: billing and the web open in the browser. */
function AccountMenu({ name, email, onBilling, onWeb, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const who = name || email || "Your account";
  const item = (label: string, icon: LucideIcon, run: () => void, danger = false) => {
    const Icon = icon;
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={menuItemClass(danger)}
        onClick={() => {
          close();
          run();
        }}
      >
        <Icon className={cx("h-4 w-4 shrink-0", !danger && "text-zinc-500 dark:text-zinc-400")} aria-hidden />
        {label}
      </button>
    );
  };
  return (
    <span ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title={email ? `Signed in as ${email}` : "Account"}
        onClick={() => setOpen((o) => !o)}
        className={cx("flex h-8 items-center rounded-full p-0.5 hover:bg-zinc-900/5 active:bg-zinc-900/10 dark:hover:bg-white/10 dark:active:bg-white/15", focusRing)}
      >
        <Avatar name={who} size="sm" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              close();
              button.current?.focus();
            } else menuKeys(e, menu.current, close);
          }}
          className={cx(floatingClass("menu"), "glass-solid absolute right-0 top-full z-menu mt-1.5 w-60 origin-top-right animate-menu-in p-1")}
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium">{name || "Signed in"}</p>
            {email && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{email}</p>}
          </div>
          <div className="my-1 h-px bg-zinc-200 dark:bg-white/10" />
          {item("Plan & billing", CreditCard, onBilling)}
          {item("Orbit on the web", Globe, onWeb)}
          <div className="my-1 h-px bg-zinc-200 dark:bg-white/10" />
          {item("Sign out", LogOut, onSignOut, true)}
        </div>
      )}
    </span>
  );
}

const windowButton =
  "inline-flex h-full items-center justify-center text-zinc-600 transition-colors duration-quick dark:text-zinc-300";

/**
 * Windows' own window buttons: minimize, maximize (the full screens only) and close, which asks whether to hide to
 * the tray or quit. 46 px wide and the bar's full height, as Windows draws them (32 px in the compact live
 * overlay); close turns red under the mouse.
 */
export function WindowButtons({
  minimize,
  hide,
  maximize = false,
  compact = false,
}: {
  minimize: () => void;
  hide: () => void;
  maximize?: boolean;
  compact?: boolean;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!maximize) return;
    const win = getCurrentWindow();
    let alive = true;
    const read = () =>
      void win
        .isMaximized()
        .then((m) => alive && setMaximized(m))
        .catch(() => undefined);
    read();
    const off = win.onResized(read);
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, [maximize]);
  const width = compact ? "w-8" : "w-[46px]";
  const plain = "hover:bg-zinc-900/[0.06] active:bg-zinc-900/10 dark:hover:bg-white/10 dark:active:bg-white/15";
  return (
    <span className="flex shrink-0 items-stretch self-stretch">
      <button type="button" onClick={minimize} aria-label="Minimize" title="Minimize" className={cx(windowButton, width, plain, focusRing)}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      {maximize && (
        <button
          type="button"
          onClick={() => void getCurrentWindow().toggleMaximize()}
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          className={cx(windowButton, width, plain, focusRing)}
        >
          {maximized ? <RestoreIcon /> : <Square className="h-3 w-3" />}
        </button>
      )}
      <button
        type="button"
        onClick={hide}
        aria-label="Close"
        title="Close: hide to the tray or quit"
        className={cx(windowButton, width, "hover:bg-[#C42B1C] hover:text-white active:bg-[#B3271A] active:text-white", focusRing)}
      >
        <X className="h-4 w-4" />
      </button>
    </span>
  );
}

/** Windows' "restore down": two overlapping squares. */
function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1" y="3.5" width="7.5" height="7.5" rx="1" />
      <path d="M3.5 3.5V2a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H8.5" />
    </svg>
  );
}

/** Icon button for a screen's own actions in the title bar (label is the tooltip and the accessible name). */
export function TitleBarButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 active:bg-zinc-900/10 dark:hover:bg-white/10 dark:hover:text-zinc-100 dark:active:bg-white/15",
        focusRing,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
