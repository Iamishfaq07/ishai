import { expect, it } from "vitest";
import type { JobTrackerEntry } from "@orbit/types";
import { pickNextStop, weekStops, type Queue } from "./today";

it("keeps date-only preparation out of timed stops while preserving its next-action link", () => {
  const queue: Queue = { focus_id: "transition:sql", items: [{ id: "transition:sql", kind: "preparation",
    title: "Run cohort query", detail: "Due 2026-10-23 (date only).", due_at: null, overdue: true,
    path: "/learn#transition-planner", action_label: "Open transition plan" }] };
  expect(pickNextStop(queue, [], Date.parse("2026-10-24T12:00:00Z"))?.to).toBe("/learn#transition-planner");
  expect(weekStops(queue, [], Date.parse("2026-10-24T12:00:00Z")).flatMap((day) => day.stops)).toEqual([]);
});

it("puts an offer or an interview before an undated rule suggestion, never before dated work", () => {
  const job = (id: string, status: string) => ({ id, status, title: "Developer", company: id, next_at: null }) as unknown as JobTrackerEntry;
  const contacts: Queue = { items: [{ id: "contacts:a", kind: "application", title: "Developer · A", detail: "Find who's hiring.",
    due_at: null, overdue: false, path: "/jobs/outreach", action_label: "Find who's hiring", rule: "find_contacts" }] };
  const now = Date.parse("2026-10-24T12:00:00Z");
  expect(pickNextStop(contacts, [job("A", "applied"), job("Z", "interviewing"), job("F", "offer")], now)?.to).toBe("/jobs/mission/F?tab=offer");
  expect(pickNextStop(contacts, [job("A", "applied"), job("Z", "interviewing")], now)?.to).toBe("/jobs/mission/Z?tab=plan");
  expect(pickNextStop(contacts, [job("A", "applied")], now)?.to).toBe("/jobs/outreach");
  const dated: Queue = { items: [{ ...contacts.items[0]!, id: "job:a", rule: undefined, due_at: "2026-10-25T09:00:00Z", path: "/jobs/mission/A" }] };
  expect(pickNextStop(dated, [job("F", "offer")], now)?.to).toBe("/jobs/mission/A");
});
