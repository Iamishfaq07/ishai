import type { NativeCapture, ScrollCapture } from "./native";

export function isScrolled(c: NativeCapture | ScrollCapture): c is ScrollCapture {
  return "screens" in c;
}

/** What the preview tells the user about a scrolling capture, if anything (a whole page needs no note). */
export function scrollNote(c: ScrollCapture): string | null {
  if (c.stop === "mouse") return "Stopped early because the mouse moved. Retake and leave the mouse still to get the rest.";
  if (c.stop === "lost")
    return "Stopped where the screens stopped lining up, so the end may be missing. Select just the problem text and retake.";
  if (c.stop === "limit") return "Very long, so it was cut at Orbit's length limit.";
  if (c.screens <= 1) return "That area didn't scroll, so this is what's visible. Drag over the problem text itself.";
  return null;
}
