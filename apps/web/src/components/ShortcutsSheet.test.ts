import { describe, expect, it } from "vitest";
import { asksForShortcuts } from "./ShortcutsSheet";

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra,
});

describe("the ? shortcut sheet", () => {
  it("opens on ? outside a text field, never while typing or with a modifier", () => {
    expect(asksForShortcuts(key("?"), false)).toBe(true);
    expect(asksForShortcuts(key("?"), true)).toBe(false); // typing a question mark in a field
    expect(asksForShortcuts(key("?", { ctrlKey: true }), false)).toBe(false);
    expect(asksForShortcuts(key("?", { metaKey: true }), false)).toBe(false);
    expect(asksForShortcuts(key("/"), false)).toBe(false);
  });
});
