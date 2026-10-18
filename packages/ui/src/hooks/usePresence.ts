import { useEffect, useState } from "react";
import { currentMotion } from "./useMotion";

/**
 * Keeps something on screen while it plays its exit (a dialog closing, a sheet dropping away): `mounted` stays true
 * for `exitMs` after `open` turns false, with `leaving` true meanwhile. At Off the exit is skipped. Reopening while it
 * leaves brings it straight back.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const ms = currentMotion() === "off" ? 0 : exitMs;
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, mounted, exitMs]);
  return { mounted: open || mounted, leaving: !open && mounted };
}
