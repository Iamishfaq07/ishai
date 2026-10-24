import { expect, it } from "vitest";
import { pickNextStop, weekStops, type Queue } from "./today";

it("keeps date-only preparation out of timed stops while preserving its next-action link", () => {
  const queue: Queue = { focus_id: "transition:sql", items: [{ id: "transition:sql", kind: "preparation",
    title: "Run cohort query", detail: "Due 2026-10-23 (date only).", due_at: null, overdue: true,
    path: "/learn#transition-planner", action_label: "Open transition plan" }] };
  expect(pickNextStop(queue, [], Date.parse("2026-10-24T12:00:00Z"))?.to).toBe("/learn#transition-planner");
  expect(weekStops(queue, [], Date.parse("2026-10-24T12:00:00Z")).flatMap((day) => day.stops)).toEqual([]);
});
