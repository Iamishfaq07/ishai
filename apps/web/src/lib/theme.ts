import { useEffect, useState } from "react";
import { safeLocal } from "@orbit/ui";

export type ThemePref = "dark" | "light" | "system";
const KEY = "orbit.theme";

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  // The phone's status bar matches the top bar: white in light mode, the night sky in dark (as public/theme-init.js).
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#080918" : "#ffffff");
}

export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  // Unset follows the system, as public/theme-init.js does before the first paint.
  const [pref, setPref] = useState<ThemePref>(() => (safeLocal.getItem(KEY) as ThemePref | null) ?? "system");

  useEffect(() => {
    safeLocal.setItem(KEY, pref);
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return [pref, setPref];
}
