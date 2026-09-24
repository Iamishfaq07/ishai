import { useEffect, useState } from "react";

export type ThemePref = "dark" | "light" | "system";
const KEY = "orbit.theme";

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the saved theme at startup (before React renders) so there's no flash. */
export function initTheme(): void {
  applyTheme((localStorage.getItem(KEY) as ThemePref | null) ?? "dark");
}

export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref | null) ?? "dark");

  useEffect(() => {
    localStorage.setItem(KEY, pref);
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return [pref, setPref];
}
