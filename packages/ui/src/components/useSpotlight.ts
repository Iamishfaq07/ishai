import type { PointerEvent } from "react";

/**
 * `onPointerMove` for a `.orbit-spotlight` card: the soft light under the cursor (base.css) follows the pointer. Writes
 * two CSS variables on the card itself, so moving the mouse never re-renders anything. Touch pointers are ignored.
 */
export function spotlightMove(e: PointerEvent<HTMLElement>): void {
  if (e.pointerType === "touch") return;
  const box = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - box.left}px`);
  e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - box.top}px`);
}
