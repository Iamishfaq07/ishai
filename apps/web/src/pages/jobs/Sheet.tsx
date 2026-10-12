import type { ReactNode } from "react";
import { Sheet as Panel, type SheetSize } from "@orbit/ui";

/**
 * Jobs AI's sheet: the shared panel, with the body padded and an optional pinned footer. `wide` is the larger size
 * used for the add-job form.
 */
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
  const size: SheetSize = wide ? "xl" : "md";
  return (
    <Panel open={open} onClose={onClose} title={title} size={size} footer={footer}>
      <div className="px-5 py-4">{children}</div>
    </Panel>
  );
}
