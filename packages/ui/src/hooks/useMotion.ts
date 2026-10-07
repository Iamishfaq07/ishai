import { useSyncExternalStore } from "react";
import { motionEnv, type MotionLevel } from "../design/design";

const LEVELS: readonly string[] = ["full", "reduced", "off"];

/**
 * The motion level playing now: `html[data-motion]` as `applyDesign` set it (the user's choice, capped by the OS).
 * Without it (a window that never ran `initDesign`), the OS setting alone. For code outside React.
 */
export function currentMotion(): MotionLevel {
  if (typeof document === "undefined") return "full";
  const set = document.documentElement.getAttribute("data-motion");
  if (set && LEVELS.includes(set)) return set as MotionLevel;
  return motionEnv().reducedMotion ? "reduced" : "full";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  mq?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    mq?.removeEventListener("change", onChange);
  };
}

/**
 * The motion level for JS-driven animation (canvas, requestAnimationFrame, element.animate, celebrations): `full`
 * may move things, `reduced` may only fade, `off` shows the end state at once. Tailwind's `motion-safe:` only sees the
 * OS setting, so anything animated from JS must read this instead. Updates live when Settings or the OS changes.
 */
export function useMotion(): MotionLevel {
  return useSyncExternalStore(subscribe, currentMotion, () => "full");
}
