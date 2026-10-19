import { icsFold, icsText } from "./model";

interface CalendarAction { id: string; title: string; detail: string; kind: string; due_at: string | null }

/** An explicit snapshot export. No subscription URL or automatic sync; times retain their UTC instant. */
export function agendaIcs(actions: CalendarAction[], now = new Date()): string {
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbit//Personal Agenda//EN", "CALSCALE:GREGORIAN"];
  for (const action of actions) {
    if (!action.due_at) continue;
    const when = new Date(action.due_at);
    if (!Number.isFinite(when.getTime()) || when < now) continue;
    lines.push("BEGIN:VEVENT", `UID:${action.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-action@orbit`, `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(when)}`, `SUMMARY:${icsText(action.title)}`, `DESCRIPTION:${icsText(action.detail)}`, "END:VEVENT");
  }
  return lines.concat("END:VCALENDAR").map(icsFold).join("\r\n") + "\r\n";
}
