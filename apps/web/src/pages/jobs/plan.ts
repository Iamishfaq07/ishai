import type { JobTrackerEntry, PlanItemKind } from "@orbit/types";
import { practiceLink } from "./model";
import { jobPath } from "./paths";

/** Where each kind of task is done. */
export function planItemLink(kind: PlanItemKind, entry: Pick<JobTrackerEntry, "document_id" | "live" | "listing_id" | "title" | "company" | "url">): string | null {
  switch (kind) {
    case "mock":
    case "warmup":
      return practiceLink(entry, jobPath);
    case "queue":
      return "/mock";
    case "story":
    case "gap":
    case "review":
      return "/documents/stories";
    case "research":
      return entry.live ? jobPath(entry.listing_id) : null;
    case "logistics":
      return "/start";
  }
}

/** "Today", "Tomorrow", "Thu 22 Oct" for a plan day (a date without a time, read as the person's own day). */
export function dayLabel(iso: string, daysBefore: number, todayIso: string): string {
  if (daysBefore === 0) return "Interview day";
  if (iso === todayIso) return "Today";
  const d = new Date(`${iso}T12:00:00`);
  const t = new Date(`${todayIso}T12:00:00`);
  if (Math.round((d.getTime() - t.getTime()) / 86_400_000) === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

