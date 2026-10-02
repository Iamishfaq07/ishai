import { describe, expect, it, vi } from "vitest";
import { registerDialog } from "../hooks/useFocusTrap";
import { DEFAULT_HOTKEYS, dispatchHotkey, formatHotkey } from "./hotkeys";

describe("formatHotkey", () => {
  it("labels named keys the way people write them", () => {
    expect(formatHotkey("Alt+ArrowLeft", false)).toBe("Alt+←");
    expect(formatHotkey("Mod+Shift+Escape", false)).toBe("Ctrl+Shift+Esc");
    expect(formatHotkey("Mod+Enter", false)).toBe("Ctrl+Enter");
    expect(formatHotkey("Mod+Shift+S", true)).toBe("⌘ ⇧ S");
    expect(formatHotkey("Alt+ArrowRight", true)).toBe("⌥ →");
  });
});

describe("dispatchHotkey", () => {
  const ctrlEnter = () => ({ key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() });

  it("runs the bound handler and claims the key press", () => {
    const answer = vi.fn();
    const e = ctrlEnter();
    expect(dispatchHotkey(e, DEFAULT_HOTKEYS, { answer }, false)).toBe(true);
    expect(answer).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does nothing while a dialog is open, e.g. “End this session?”", () => {
    const answer = vi.fn();
    const dialog = registerDialog();
    const e = ctrlEnter();
    expect(dispatchHotkey(e, DEFAULT_HOTKEYS, { answer }, false)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled(); // the dialog's own Enter still works
    dialog.release();
    expect(dispatchHotkey(ctrlEnter(), DEFAULT_HOTKEYS, { answer }, false)).toBe(true);
    expect(answer).toHaveBeenCalledOnce();
  });
});
