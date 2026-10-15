import type { TailorQueueItem } from "@orbit/types";

/** What one queued job did, in a line. */
export function queueSummary(item: TailorQueueItem): string {
  if (item.status === "queued") return "Waiting its turn";
  if (item.status === "running") return "Tailoring now…";
  if (item.status === "failed") return item.error ?? "It couldn't be tailored. Try it again.";
  const r = item.result;
  if (!r) return "Done";
  const parts = [
    r.score_before !== null && r.score_after !== null ? `Score ${r.score_before} → ${r.score_after}` : null,
    `${r.changes} change${r.changes === 1 ? "" : "s"}`,
    r.to_confirm ? `${r.to_confirm} to confirm` : null,
    r.questions ? `${r.questions} number${r.questions === 1 ? "" : "s"} to add` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
