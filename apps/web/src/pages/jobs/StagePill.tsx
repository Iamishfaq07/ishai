import type { JobStatus } from "@orbit/types";
import { cx } from "@orbit/ui";
import { STATUS_LABEL, STATUS_MARK } from "./model";

/** A job's stage as a quiet pill: its colour as a dot beside the name (ink text, so it reads the same in any theme). */
export function StagePill({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 dark:text-zinc-200 dark:ring-white/10",
        className,
      )}
    >
      <span aria-hidden className={cx("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_MARK[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
