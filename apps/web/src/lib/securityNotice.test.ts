import { describe, expect, it } from "vitest";
import type { SecurityEvent } from "@orbit/types";
import { securityNotice } from "./securityNotice";

const ev = (id: string, at: string, notice = true): SecurityEvent => ({ id, action: "auth.passkey_added", text: "A passkey was added", at, notice });

describe("Home's sign-in change notice", () => {
  const items = [ev("b", "2026-10-18T06:10:00Z"), ev("a", "2026-10-17T09:00:00Z")];

  it("shows the newest change until it's acknowledged here", () => {
    expect(securityNotice(items, null)?.id).toBe("b");
    expect(securityNotice(items, "2026-10-18T06:10:00Z")).toBeNull();
    expect(securityNotice(items, "2026-10-17T12:00:00Z")?.id).toBe("b"); // a newer change after the last "It was me"
  });

  it("stays quiet for changes that aren't notices, or none at all", () => {
    expect(securityNotice([ev("x", "2026-10-18T06:10:00Z", false)], null)).toBeNull();
    expect(securityNotice([], null)).toBeNull();
  });

  it("reads a broken stored time as never acknowledged", () => {
    expect(securityNotice(items, "not a date")?.id).toBe("b");
  });
});
