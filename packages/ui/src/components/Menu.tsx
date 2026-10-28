import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown } from "../icons";
import { cx } from "./cx";
import { Button, ButtonGroup, IconButton, type ButtonSize, type ButtonVariant } from "./ui";

/**
 * Things that float over the page without blocking it (DESIGN.md, "Overlays"): popovers, menus, split buttons and
 * tooltips. Each sits on `shadow-menu` / `shadow-popover` with a hairline border, opens with a short drop (a fade at
 * Gentle), closes on Escape (focus back on its button) or a press outside, and never traps focus: Tab moves on.
 */

/** Closes a floating panel on Escape (returning focus to `trigger`) or a press outside `root`. */
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>, trigger?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
      trigger?.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, root, trigger]);
}

/** The floating panel's look: an opaque surface, a hairline border, the elevation for its level. */
export function floatingClass(level: "menu" | "popover" = "menu"): string {
  return cx(
    "rounded-xl border border-zinc-200 bg-white text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100",
    level === "menu" ? "z-menu shadow-menu" : "z-popover shadow-popover",
  );
}

/**
 * A panel anchored under its trigger (filters, a small form, details). `trigger` gets aria-expanded and toggles it.
 * Not modal: for something that must be answered, use a Sheet or confirmDialog.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  label,
  className,
}: {
  trigger: (props: { ref: RefObject<HTMLButtonElement | null>; onClick: () => void; "aria-expanded": boolean; "aria-controls": string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  /** Names the panel for screen readers. */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
  return (
    <div ref={root} className="relative inline-block">
      {trigger({ ref: button, onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-controls": id })}
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={cx(floatingClass("popover"), "absolute top-full mt-1.5 w-72 animate-menu-in p-3", align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left", className)}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ComponentType<{ className?: string }>;
  /** A shortcut hint shown at the end ("Ctrl K"). */
  hint?: string;
  /** Rose text: it deletes or ends something (and should still ask, or offer Undo). */
  danger?: boolean;
  disabled?: boolean;
}

/** Arrow keys, Home/End and first letters move between a menu's items; Tab leaves (and closes) it. */
export function menuKeys(e: KeyboardEvent<HTMLElement>, menu: HTMLElement | null, close: () => void): void {
  const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const go = (n: number) => {
    e.preventDefault();
    items[(n + items.length) % items.length]?.focus();
  };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
  else if (e.key === "Tab") close();
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    const k = e.key.toLowerCase();
    const from = items.slice(i + 1).concat(items.slice(0, i + 1));
    const hit = from.find((el) => el.textContent?.trim().toLowerCase().startsWith(k));
    if (hit) {
      e.preventDefault();
      hit.focus();
    }
  }
}

/** A menu item's look, for menus built by hand (the account menu's rows). */
export function menuItemClass(danger = false): string {
  return cx(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    danger
      ? "text-rose-700 hover:bg-rose-50 focus-visible:bg-rose-50 active:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:focus-visible:bg-rose-500/10 dark:active:bg-rose-500/20"
      : "text-zinc-700 hover:bg-zinc-900/5 focus-visible:bg-zinc-900/5 active:bg-zinc-900/10 dark:text-zinc-200 dark:hover:bg-white/5 dark:focus-visible:bg-white/[0.07] dark:active:bg-white/10",
  );
}

function MenuPanel({ items, id, label, align, onClose, menuRef, className }: {
  items: MenuItem[];
  id: string;
  label: string;
  align: "start" | "end";
  onClose: () => void;
  menuRef: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [menuRef]);
  // The side asked for, unless it would leave the screen (a "More" button that wrapped to the start of a row on a
  // phone): then the other side, measured before it's painted.
  const [side, setSide] = useState(align);
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) return;
    if (side === "end" && box.left < 8) setSide("start");
    else if (side === "start" && box.right > window.innerWidth - 8) setSide("end");
  }, [menuRef, side]);
  return (
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={(e) => menuKeys(e, menuRef.current, onClose)}
      className={cx(floatingClass("menu"), "absolute top-full mt-1.5 min-w-[13rem] animate-menu-in p-1", side === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left", className)}
    >
      {items.map(({ label: name, onSelect, icon: Icon, hint, danger, disabled }) => (
        <button
          key={name}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-disabled={disabled || undefined}
          className={menuItemClass(danger)}
          onClick={() => {
            if (disabled) return;
            onClose();
            onSelect();
          }}
        >
          {Icon && <Icon className={cx("h-4 w-4 shrink-0", danger ? "" : "text-zinc-500 dark:text-zinc-400")} aria-hidden />}
          <span className="flex-1">{name}</span>
          {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * A button that opens a menu of actions. Arrow keys, Home/End and first letters move through it; Enter picks;
 * Escape closes and puts focus back on the button.
 */
export function MenuButton({
  label,
  items,
  children,
  variant = "secondary",
  size = "md",
  align = "start",
  icon,
  className,
  menuClassName,
}: {
  /** The menu's name (and the button's, when it shows only an icon). */
  label: string;
  items: MenuItem[];
  /** The button's visible content; defaults to `label` and a chevron. */
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: "start" | "end";
  /** Icon-only trigger (a "More" button): the icon, named by `label`. */
  icon?: ComponentType<{ className?: string }>;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
  const shared = {
    ref: button,
    onClick: () => setOpen((o) => !o),
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
  };
  return (
    <div ref={root} className="relative inline-block">
      {icon ? (
        <IconButton {...shared} label={label} icon={icon} variant={variant} size={size} className={className} />
      ) : (
        <Button {...shared} variant={variant} size={size} className={className}>
          {children ?? (
            <>
              {label}
              <ChevronDown className="h-4 w-4 opacity-70" aria-hidden />
            </>
          )}
        </Button>
      )}
      {open && <MenuPanel items={items} id={id} label={label} align={align} onClose={close} menuRef={menu} className={menuClassName} />}
    </div>
  );
}

/**
 * The main action with its alternatives beside it: the button does the usual thing, the chevron opens the rest
 * ("Download PDF" | Word, JSON).
 */
export function SplitButton({
  children,
  onClick,
  items,
  menuLabel,
  variant = "primary",
  size = "md",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  items: MenuItem[];
  /** Names the chevron ("More download options"). */
  menuLabel: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
  return (
    <div ref={root} className="relative inline-block">
      <ButtonGroup>
        <Button variant={variant} size={size} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
        <IconButton
          ref={button}
          label={menuLabel}
          icon={ChevronDown}
          variant={variant}
          size={size}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
          className={variant === "primary" ? "border-l-white/25" : undefined}
        />
      </ButtonGroup>
      {open && <MenuPanel items={items} id={id} label={menuLabel} align="end" onClose={close} menuRef={menu} />}
    </div>
  );
}

/** Tooltips live in Tooltip.tsx (kept exported from here for the old import path). */
export { Tooltip } from "./Tooltip";
