import { describe, expect, it } from "vitest";
import { trayRequest } from "./tray";

describe("tray requests", () => {
  it("are the menu's own items, and nothing else", () => {
    for (const r of ["new-session", "history", "settings", "web"]) expect(trayRequest(r)).toBe(r);
    expect(trayRequest("quit")).toBeNull(); // Rust quits by itself
    expect(trayRequest({ screen: "home" })).toBeNull();
    expect(trayRequest(undefined)).toBeNull();
  });
});
