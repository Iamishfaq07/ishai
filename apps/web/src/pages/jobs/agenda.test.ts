import { describe, expect, it } from "vitest";
import { agendaIcs } from "./agenda";

describe("Personal agenda snapshot", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("exports future dated records only, with exact instants and stable source IDs", () => {
    const event = { id: "contact:abc", kind: "contact", title: "Alex", detail: "Follow up", due_at: "2026-10-21T11:30:00+05:30" };
    const text = agendaIcs([event, { ...event, id: "past", due_at: "2026-10-19T12:00:00Z" }, { ...event, due_at: null }], now);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(text).toContain("DTSTART:20261021T060000Z\r\n");
    expect(text).toContain("UID:contact-abc-action@orbit");
    expect(agendaIcs([event], new Date("2026-10-20T14:00:00Z"))).toContain("UID:contact-abc-action@orbit");
    expect(text).not.toContain("ATTENDEE");
  });
  it("escapes injected calendar fields and folds UTF-8 lines within 75 octets", () => {
    const title = "面接🚀".repeat(70);
    const text = agendaIcs([{ id: "job:abc", kind: "interview", title: title + "\r\nATTENDEE:evil@example.com",
      detail: "A, B; C\\D\rATTENDEE:evil@example.com\u0000", due_at: "2026-10-21T12:00:00Z" }], now);
    expect(text).not.toContain("\r\nATTENDEE:");
    expect(text).toContain("DESCRIPTION:A\\, B\\; C\\\\D");
    expect(text).not.toContain("\rATTENDEE:");
    expect(text).not.toContain("\u0000");
    expect(text.replace(/\r\n /g, "")).toContain(`SUMMARY:${title}`);
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
