import { useCallback, useEffect, useRef, useState } from "react";
import { currentMotion } from "./useMotion";

/**
 * Small confirmations (DESIGN.md "Interaction"): a state that switches itself off (a button's "Saved"), a copy with
 * its result, a polite announcement for screen readers, and a short buzz on Android phones.
 */

/** How long a confirmation ("Saved", "Copied") stays before the control goes back to its usual words. */
export const CONFIRM_MS = 1600;

/** A flag that turns itself off: `const [saved, flashSaved] = useFlash()`, then `flashSaved()` once a save succeeds,
 *  and `<Button done={saved}>` shows "Saved" for a moment. Calling it again restarts the clock. */
export function useFlash(ms = CONFIRM_MS): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash];
}

export type CopyState = "idle" | "copied" | "failed";

/** Copies text and says how it went for a moment: `copied`, or `failed` when the clipboard is missing (an insecure
 *  page) or refused (no permission), then `idle` again. Resolves true when the text is on the clipboard. */
export function useCopy(ms = CONFIRM_MS): [CopyState, (text: string) => Promise<boolean>] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = useCallback(
    async (text: string) => {
      let ok = false;
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch {
        ok = false;
      }
      if (!alive.current) return ok;
      clearTimeout(timer.current);
      setState(ok ? "copied" : "failed");
      if (ok) haptic("light");
      timer.current = setTimeout(() => setState("idle"), ms);
      return ok;
    },
    [ms],
  );
  return [state, copy];
}

let region: HTMLElement | null = null;

/** Says something to screen readers, politely (one shared live region, made on first use): a button's "Saved" or
 *  "Copied", which sighted people see on the button itself. */
export function announce(message: string): void {
  if (typeof document === "undefined" || !message) return;
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  const el = region;
  // Cleared first so the same words twice ("Copied", "Copied") are read twice.
  el.textContent = "";
  setTimeout(() => {
    el.textContent = message;
  }, 50);
}

/** True where a short vibration means something: an Android phone or tablet (iPhones and iPads have no vibration
 *  API; desktops have the function but no motor), and only at Full motion (Gentle, Off and the OS asking for less
 *  motion all mean no buzz). */
export function hapticsOk(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  if (!/Android/i.test(navigator.userAgent)) return false;
  return currentMotion() === "full";
}

/**
 * A short buzz for a key confirmation only (saved, copied, a step done): `light` 8 ms, `confirm` 12 ms. Never for a
 * press, a hover or an error. A no-op where hapticsOk() is false, and before the page has been touched (the browser
 * ignores it then).
 */
export function haptic(kind: "light" | "confirm" = "confirm"): void {
  if (!hapticsOk()) return;
  try {
    navigator.vibrate(kind === "light" ? 8 : 12);
  } catch {
    // Refused (no user activation yet): nothing to do.
  }
}
