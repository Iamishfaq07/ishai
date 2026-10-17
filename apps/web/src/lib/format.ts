import type { SessionType } from "@orbit/types";

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  interview: "Interview",
  meeting: "Professional meeting",
  coding: "Coding interview",
  assessment: "Online assessment practice",
  phone: "Phone / room audio",
  mock: "Mock interview",
};

/**
 * The line under a session's title: its type and role, minus what the title already says. A session started without
 * a name is titled after them ("Phone / room audio", "Interview — SDE II"), and the list shouldn't repeat it.
 */
export function sessionKindLine(s: { title: string; type: SessionType; role?: string | null }): string {
  const title = s.title.trim().toLowerCase();
  const label = SESSION_TYPE_LABEL[s.type];
  const role = s.role?.trim();
  return [title.startsWith(label.toLowerCase()) ? null : label, role && !title.includes(role.toLowerCase()) ? role : null]
    .filter(Boolean)
    .join(" · ");
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * How long an answer of `words` takes to say, at about 140 words a minute: "a few seconds", "about 20 seconds",
 * "about 2 min". Short answers used to read "about 1 min" (it never went under a minute).
 */
export function spokenTime(words: number): string {
  const seconds = (words / 140) * 60;
  if (seconds < 10) return "a few seconds";
  if (seconds < 50) return `about ${Math.round(seconds / 5) * 5} seconds`;
  return `about ${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function downloadText(filename: string, content: BlobPart, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Tomorrow", "in 3 days", "on Oct 20": when something (the practice queue's next question) comes back. */
export function whenDue(iso: string, now = new Date()): string {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const due = new Date(iso);
  const days = Math.round((day(due) - day(now)) / 86_400_000);
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return `on ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
