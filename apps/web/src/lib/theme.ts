import { useEffect, useState } from "react";
import { safeLocal } from "@orbit/ui";

export type ThemePref = "dark" | "light" | "system";
const KEY = "orbit.theme";

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  // The phone's status bar matches the top bar: white in light mode, graphite in dark (as public/theme-init.js).
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#191c20" : "#ffffff");
}

export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  // Unset is light, as public/theme-init.js applies before the first paint; dark and "system" are a person's choice.
  const [pref, setPref] = useState<ThemePref>(() => (safeLocal.getItem(KEY) as ThemePref | null) ?? "light");

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
