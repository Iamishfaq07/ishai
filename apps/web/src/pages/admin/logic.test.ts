import { describe, expect, it } from "vitest";
import {
  actionLabel,
  announcementVisible,
  auditDetail,
  exportFileName,
  nextSort,
  niceCeiling,
  plannedRemoval,
  sinceText,
  wholeNumber,
} from "./logic";

describe("taking credits away", () => {
  it("never goes below zero, and says when it took less than asked", () => {
    expect(plannedRemoval(5, 2)).toEqual({ take: 2, after: 3, clamped: false });
    expect(plannedRemoval(3, 10)).toEqual({ take: 3, after: 0, clamped: true });
    expect(plannedRemoval(0, 1)).toEqual({ take: 0, after: 0, clamped: true });
    expect(plannedRemoval(12.5, 5)).toEqual({ take: 5, after: 7.5, clamped: false });
  });

  it("'set to zero' takes exactly what's left", () => {
    expect(plannedRemoval(43.4, 0, true)).toEqual({ take: 43.4, after: 0, clamped: false });
    expect(plannedRemoval(-2, 0, true)).toEqual({ take: 0, after: 0, clamped: false });
  });

  it("reads typed counts as whole numbers from zero", () => {
    expect(wholeNumber("12")).toBe(12);
    expect(wholeNumber(" 7.9 ")).toBe(7);
    expect(wholeNumber("-3")).toBe(0);
    expect(wholeNumber("ten")).toBe(0);
    expect(wholeNumber("")).toBe(0);
  });
});

describe("the list's columns", () => {
  it("flips the order on the same column and starts others at their natural order", () => {
    expect(nextSort({ sort: "created", order: "desc" }, "created")).toEqual({ sort: "created", order: "asc" });
    expect(nextSort({ sort: "created", order: "asc" }, "email")).toEqual({ sort: "email", order: "asc" });
    expect(nextSort({ sort: "email", order: "asc" }, "paid")).toEqual({ sort: "paid", order: "desc" });
  });

  it("says when an account was last active in words", () => {
    const now = new Date(2026, 9, 7, 18, 0);
    expect(sinceText(null, now)).toBe("Never");
    expect(sinceText(new Date(2026, 9, 7, 9, 0).toISOString(), now)).toBe("Today");
    expect(sinceText(new Date(2026, 9, 6, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(sinceText(new Date(2026, 9, 2, 12, 0).toISOString(), now)).toBe("5 days ago");
    expect(sinceText(new Date(2026, 8, 9, 12, 0).toISOString(), now)).toBe("4 weeks ago");
  });
});

describe("the dashboard's charts", () => {
  it("tops the axis at a round number", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(1)).toBe(1);
    expect(niceCeiling(3)).toBe(5);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(12)).toBe(20);
    expect(niceCeiling(140)).toBe(200);
    expect(niceCeiling(0.4)).toBe(0.5);
  });
});

describe("the audit log", () => {
  it("names actions in words and keeps unknown ones as they are", () => {
    expect(actionLabel("admin.user.delete")).toBe("Deleted the account");
    expect(actionLabel("auth.login_suspended")).toBe("Tried to sign in while suspended");
    expect(actionLabel("admin.something_new")).toBe("admin.something_new");
  });

  it("shows what an entry says beyond the account it's about", () => {
    const id = "0b5f4c1e-7a1d-4d0e-9a51-6f2b8c1d2e3f";
    expect(auditDetail(`${id} resume-2 interview-0m chargeback`, id)).toBe("resume-2 interview-0m chargeback");
    expect(auditDetail(id, id)).toBe("");
    expect(auditDetail("announcement", null)).toBe("announcement");
    expect(auditDetail(null, null)).toBe("");
  });
});

describe("the announcement banner", () => {
  it("stays dismissed until the text changes", () => {
    expect(announcementVisible("a1", "Maintenance tonight", null)).toBe(true);
    expect(announcementVisible("a1", "Maintenance tonight", "a1")).toBe(false);
    expect(announcementVisible("b2", "Back up", "a1")).toBe(true);
    expect(announcementVisible(null, null, null)).toBe(false);
  });

  it("names the CSV by today's date", () => {
    expect(exportFileName(new Date(2026, 0, 5))).toBe("orbit-accounts-2026-01-05.csv");
  });
});
