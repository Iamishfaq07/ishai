import { describe, expect, it } from "vitest";
import { isDialogOpen, nextFocusIndex, registerDialog } from "./useFocusTrap";

describe("focus trap", () => {
  it("cycles Tab and Shift+Tab inside the dialog, wrapping at both ends", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0); // last → first
    expect(nextFocusIndex(0, 3, true)).toBe(2); // first → last
    expect(nextFocusIndex(1, 3, true)).toBe(0);
  });

  it("pulls stray focus back in from the matching end, and has nowhere to go when nothing is focusable", () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
    expect(nextFocusIndex(-1, 0, false)).toBe(-1);
  });

  it("knows which dialog is on top, and when none is open", () => {
    expect(isDialogOpen()).toBe(false);
    const edit = registerDialog();
    const confirm = registerDialog(); // a confirm over the edit dialog: only it handles Escape
    expect(isDialogOpen()).toBe(true);
    expect(confirm.isTop()).toBe(true);
    expect(edit.isTop()).toBe(false);
    confirm.release();
    expect(edit.isTop()).toBe(true);
    edit.release();
    edit.release(); // idempotent
    expect(isDialogOpen()).toBe(false);
  });
});
