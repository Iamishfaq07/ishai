import { describe, expect, it } from "vitest";
import { formatHotkey } from "./hotkeys";

describe("formatHotkey", () => {
  it("labels named keys the way people write them", () => {
    expect(formatHotkey("Alt+ArrowLeft", false)).toBe("Alt+←");
    expect(formatHotkey("Mod+Shift+Escape", false)).toBe("Ctrl+Shift+Esc");
    expect(formatHotkey("Mod+Enter", false)).toBe("Ctrl+Enter");
    expect(formatHotkey("Mod+Shift+S", true)).toBe("⌘ ⇧ S");
    expect(formatHotkey("Alt+ArrowRight", true)).toBe("⌥ →");
  });
});
