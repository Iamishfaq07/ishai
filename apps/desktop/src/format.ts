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

/** A new session's title: its type, and the role when there is one ("Coding interview — SDE II"). */
export function sessionTitle(type: SessionType, role: string): string {
  const r = role.trim();
  return r ? `${SESSION_TYPE_LABEL[type]} — ${r}` : SESSION_TYPE_LABEL[type];
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Triggers a file download in the WebView (used to export a session as Markdown). */
export function downloadText(filename: string, text: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
