import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, cx, focusRing, useFocusTrap } from "@orbit/ui";

/**
 * A modal panel: a sheet from the bottom on phones (in thumb reach), a centred dialog on wider screens. Focus moves in
 * and stays in, Escape and a tap outside close it, and focus goes back where it was. Rendered into <body>, so no
 * stacking context on the page (or the phone's tab bar) can cover it.
 */
// TODO(ws-a): move to packages/ui (with the motion tokens' enter/exit) if the design layer adds a sheet of its own.
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the content (the main action), so it stays in view while the rest scrolls. */
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useFocusTrap<HTMLDivElement>(open, { onEscape: onClose });
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-white shadow-xl motion-safe:animate-fade-up sm:rounded-3xl dark:bg-zinc-900",
          wide ? "sm:max-w-xl" : "sm:max-w-md",
        )}
      >
        <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-white/10">
          <h2 id={titleId} className="min-w-0 flex-1 font-display text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={cx("rounded-lg p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white", focusRing)}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-zinc-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/10">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
