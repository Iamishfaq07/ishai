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

  it("leaves Option/Alt shortcuts to a text field being typed in, but Ctrl/Cmd+Enter in the chat box still answers", () => {
    const textarea = { tagName: "TEXTAREA" } as unknown as EventTarget;
    const prevAnswer = vi.fn();
    const answer = vi.fn();
    // macOS: Option+← moves the caret by word in the chat box instead of flipping to the previous answer.
    const optionLeft = { key: "ArrowLeft", ctrlKey: false, metaKey: false, shiftKey: false, altKey: true, preventDefault: vi.fn(), target: textarea };
    expect(dispatchHotkey(optionLeft, DEFAULT_HOTKEYS, { prevAnswer }, true)).toBe(false);
    expect(prevAnswer).not.toHaveBeenCalled();
    expect(optionLeft.preventDefault).not.toHaveBeenCalled();
    // Windows: no answer flip either, but Alt+← mustn't go Back in the browser (out of the live session).
    const altLeft = { ...optionLeft, preventDefault: vi.fn() };
    expect(dispatchHotkey(altLeft, DEFAULT_HOTKEYS, { prevAnswer }, false)).toBe(false);
    expect(prevAnswer).not.toHaveBeenCalled();
    expect(altLeft.preventDefault).toHaveBeenCalled();
    // Ctrl+Enter is Answer, typing or not.
    expect(dispatchHotkey({ ...ctrlEnter(), target: textarea }, DEFAULT_HOTKEYS, { answer }, false)).toBe(true);
    expect(answer).toHaveBeenCalledOnce();
    // Outside a text field (a button, a checkbox) Alt+← flips answers as before.
    const checkbox = { tagName: "INPUT", type: "checkbox" } as unknown as EventTarget;
    expect(dispatchHotkey({ ...optionLeft, target: checkbox }, DEFAULT_HOTKEYS, { prevAnswer }, true)).toBe(true);
    expect(prevAnswer).toHaveBeenCalledOnce();
    const editable = { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
    expect(dispatchHotkey({ ...optionLeft, target: editable }, DEFAULT_HOTKEYS, { prevAnswer }, true)).toBe(false);
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
