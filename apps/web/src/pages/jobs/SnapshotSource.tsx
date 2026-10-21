import type { SnapshotOrigin } from "@orbit/types";
import { Link } from "react-router-dom";
import { cx, focusRing } from "@orbit/ui";
import { formatDate } from "../../lib/format";
import { applicationPath } from "./paths";

/** Creation-time source only. Current packet details may have changed since this observation. */
export function SnapshotSource({ origin }: { origin?: SnapshotOrigin | null }) {
  if (!origin) return <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Legacy copy · original version and submission source were not recorded. No delivery is inferred.</p>;
  const label = origin.observation === "executor_reported" ? "Executor reported submission"
    : origin.observation === "candidate_recorded" ? "You recorded applying" : "Saved copy · saving is not submission";
  return <details className="mt-2 min-w-0 text-xs text-zinc-600 dark:text-zinc-400">
    <summary className={cx("min-h-11 cursor-pointer rounded py-3 font-medium", focusRing)}>{label}{origin.source_revision !== null ? ` · resume revision ${origin.source_revision}` : ""}</summary>
    <div className="space-y-2 border-l-2 border-indigo-300 pl-3 dark:border-indigo-500/40">
      <p>Source recorded {formatDate(origin.recorded_at)}. This records where the stored content came from; it does not prove an employer received this resume.</p>
      {origin.kind === "packet" && <><p>Application-packet content · original master resume revision not recorded. {origin.design_captured ? "" : "Original PDF, formatting and uploaded file are not captured in this copy."}</p><Link className={cx("inline-flex min-h-11 items-center rounded font-semibold text-indigo-700 underline dark:text-indigo-300", focusRing)} to={applicationPath(origin.source_id)}>Review current packet and available confirmation evidence</Link><p>The packet can change after this saved observation. A confirmation message or screenshot does not establish which exact file was delivered.</p></>}
      <p className="break-all">Stored-content fingerprint: <code>{origin.content_digest}</code></p>
    </div>
  </details>;
}
