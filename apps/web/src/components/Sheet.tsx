import { useEffect, type ReactNode } from "react";
import { X, cx, focusRing, useFocusTrap } from "@orbit/ui";

/**
 * A modal panel: a sheet from the bottom on phones (thumb reach), a centred dialog from `sm` up. Focus moves in,
 * stays in and goes back on close; Escape, the close button and a tap outside close it; the page behind doesn't
 * scroll. Small on purpose: the nav's "Me" menu uses it, so it's in the entry chunk.
 */
export function Sheet({
  open,
  onClose,
  title,
  titleId,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  titleId: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useFocusTrap<HTMLDivElement>(open, { onEscape: onClose });
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "max-h-[88vh] w-full animate-rise overflow-y-auto overscroll-contain rounded-t-3xl border border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-lg sm:rounded-3xl dark:border-white/10 dark:bg-zinc-950",
          className,
        )}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200/70 bg-white/95 px-5 py-3.5 dark:border-white/5 dark:bg-zinc-950/95">
          <h2 id={titleId} className="min-w-0 flex-1 font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx("flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
