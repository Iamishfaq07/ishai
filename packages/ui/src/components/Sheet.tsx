import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { X } from "../icons";
import { cx, focusRing } from "./cx";

/** Dialog width from `sm` up. Phones always use the full width, as a sheet from the bottom. */
export type SheetSize = "md" | "lg" | "xl" | "2xl";

const WIDTH: Record<SheetSize, string> = {
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
};

// Panels open on top of each other (a credits panel from an edit panel). The page stays still until the last one
// closes, in whatever order they close; each saving and restoring `overflow` itself would let the page scroll under
// a panel still open when the one below it closed first.
let locks = 0;
let lockedFrom = "";

/** Stops the page scrolling until every caller has released it. Returns the release. */
export function lockScroll(): () => void {
  if (locks++ === 0) {
    lockedFrom = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = lockedFrom;
  };
}

/**
 * The one modal panel. `placement="center"` (the default) is a sheet from the bottom on phones and a centred dialog
 * from `sm` up. `placement="end"` is a full-height panel from the right, under confirm dialogs. Rendered on
 * `document.body` so a sticky bar cannot cover it. Focus moves in, stays in, and returns on close. Escape, the
 * close button and a press on the backdrop close it. The page behind does not scroll.
 */
export function Sheet({
  open,
  onClose,
  title,
  titleId,
  children,
  className,
  size = "lg",
  footer,
  placement = "center",
  detail,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Defaults to a generated id. Pass one when something else must point at the title. */
  titleId?: string;
  children: ReactNode;
  className?: string;
  size?: SheetSize;
  /** Pinned under the scrolling body (the main action stays in view). */
  footer?: ReactNode;
  /** `center` is a sheet on phones and a dialog from `sm` up. `end` is a full-height panel from the right. */
  placement?: "center" | "end";
  /** Lines under the title (an email, badges). Not inside the heading. */
  detail?: ReactNode;
}) {
  const generatedId = useId();
  const labelId = titleId ?? generatedId;
  const ref = useFocusTrap<HTMLDivElement>(open, { onEscape: onClose });

  useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const end = placement === "end";
  return createPortal(
    <div
      className={
        end
          ? "fixed inset-0 z-40 flex justify-end bg-black/40"
          : "fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/50 sm:items-center sm:p-4"
      }
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className={
          end
            ? cx(
                "flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-zinc-200 bg-zinc-50 shadow-2xl animate-fade-in dark:border-white/10 dark:bg-zinc-950",
                className,
              )
            : cx(
                "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl border border-zinc-200 bg-white shadow-2xl animate-rise sm:rounded-3xl dark:border-white/10 dark:bg-zinc-950",
                WIDTH[size],
                !footer && "pb-[env(safe-area-inset-bottom)]",
                className,
              )
        }
      >
        <div
          className={cx(
            "flex shrink-0 gap-3 border-b",
            end
              ? "items-start border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/80 sm:px-5"
              : "items-center border-zinc-200/70 px-5 py-3.5 dark:border-white/10",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2 id={labelId} className="truncate font-display text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {detail}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/5",
              focusRing,
            )}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-zinc-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/10">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
