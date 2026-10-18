import { useEffect, useState } from "react";

/** The part of the visual viewport a phone's on-screen keyboard is covering. */
export interface KeyboardView {
  innerHeight: number;
  height: number;
  offsetTop: number;
  /** visualViewport.scale: above 1 the person has pinch-zoomed in, which shrinks the visual viewport too. */
  scale?: number;
}

/** Pixels of the layout viewport's bottom the on-screen keyboard covers (0 when it's closed, or on a desktop).
 *  iOS Safari and Chrome on Android (since 108) keep the layout viewport when the keyboard opens and shrink only the
 *  visual one, so a `position: fixed; bottom: …` panel stays where it was, under the keyboard. A difference under
 *  `minimum` px is the browser's own bars moving, not a keyboard. */
export function keyboardInset(view: KeyboardView, minimum = 80): number {
  if ((view.scale ?? 1) > 1.05) return 0; // zoomed in: the smaller viewport is the zoom, not a keyboard
  const covered = Math.round(view.innerHeight - view.height - view.offsetTop);
  return covered >= minimum ? covered : 0;
}

/** The keyboard's inset and the height left above it, updated as the keyboard opens, closes and the page pans, while
 *  `active` (a panel with a text field is open). `{ inset: 0 }` where the browser has no visualViewport. */
export function useKeyboardInset(active: boolean): { inset: number; visible: number } {
  const [state, setState] = useState({ inset: 0, visible: 0 });
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) {
      setState((s) => (s.inset === 0 ? s : { inset: 0, visible: 0 }));
      return;
    }
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop, scale: vv.scale });
        const visible = Math.round(vv.height);
        setState((s) => (s.inset === inset && s.visible === visible ? s : { inset, visible }));
      });
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [active]);
  return state;
}
