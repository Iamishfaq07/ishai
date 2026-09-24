import { cx } from "./cx";

/** Session-detail banner for the background report: generating, or failed (the transcript is still saved). */
export function ReportStatusNote({ status }: { status: string | null | undefined }) {
  if (status !== "pending" && status !== "failed") return null;
  const pending = status === "pending";
  return (
    <div
      role="status"
      className={cx(
        "mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        pending
          ? "bg-indigo-500/10 text-indigo-800 dark:text-indigo-200"
          : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
      )}
    >
      {pending && <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />}
      {pending
        ? "Generating the report… this page updates on its own."
        : "The report couldn't be generated. Your transcript is saved — use Generate review to try again."}
    </div>
  );
}

