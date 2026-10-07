import { useCallback, useEffect, useRef, useState } from "react";

/** User-chosen look & feel, shared by the web and desktop apps (stored per device). */
export type AccentName = "nebula" | "indigo" | "violet" | "sky" | "emerald" | "rose" | "amber";
export type TextSize = "sm" | "md" | "lg";
/** Interface animation: everything (`full`), fades only with nothing moving (`reduced`, "Gentle"), or none. */
export type MotionLevel = "full" | "reduced" | "off";

export interface DesignPrefs {
  accent: AccentName;
  textSize: TextSize;
  /** The user's choice. What plays can be less: the OS reduced-motion setting caps Full at Gentle (`effectiveMotion`). */
  motion: MotionLevel;
}

export const DEFAULT_DESIGN: DesignPrefs = { accent: "nebula", textSize: "md", motion: "full" };

type Palette = [string, string, string, string, string, string, string, string, string, string, string];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Accent palettes as RGB triplets (50 → 950). "Nebula" is Orbit's own violet; the rest are Tailwind's. */
export const ACCENTS: Record<AccentName, { label: string; palette: Palette }> = {
  nebula: { label: "Nebula", palette: ["245 243 255", "236 233 255", "221 214 254", "196 181 253", "164 139 250", "134 102 255", "112 72 245", "94 56 214", "76 46 170", "58 38 128", "32 20 80"] },
  indigo: { label: "Indigo", palette: ["238 242 255", "224 231 255", "199 210 254", "165 180 252", "129 140 248", "99 102 241", "79 70 229", "67 56 202", "55 48 163", "49 46 129", "30 27 75"] },
  violet: { label: "Violet", palette: ["245 243 255", "237 233 254", "221 214 254", "196 181 253", "167 139 250", "139 92 246", "124 58 237", "109 40 217", "91 33 182", "76 29 149", "46 16 101"] },
  sky: { label: "Sky", palette: ["240 249 255", "224 242 254", "186 230 253", "125 211 252", "56 189 248", "14 165 233", "2 132 199", "3 105 161", "7 89 133", "12 74 110", "8 47 73"] },
  emerald: { label: "Emerald", palette: ["236 253 245", "209 250 229", "167 243 208", "110 231 183", "52 211 153", "16 185 129", "5 150 105", "4 120 87", "6 95 70", "6 78 59", "2 44 34"] },
  rose: { label: "Rose", palette: ["255 241 242", "255 228 230", "254 205 211", "253 164 175", "251 113 133", "244 63 94", "225 29 72", "190 18 60", "159 18 57", "136 19 55", "76 5 25"] },
  amber: { label: "Amber", palette: ["255 251 235", "254 243 199", "253 230 138", "252 211 77", "251 191 36", "245 158 11", "217 119 6", "180 83 9", "146 64 14", "120 53 15", "69 26 3"] },
};

export const TEXT_SIZES: Array<{ value: TextSize; label: string; px: number }> = [
  { value: "sm", label: "Small", px: 14 },
  { value: "md", label: "Default", px: 16 },
  { value: "lg", label: "Large", px: 18 },
];

export const MOTION_LEVELS: Array<{ value: MotionLevel; label: string }> = [
  { value: "full", label: "Full" },
  { value: "reduced", label: "Gentle" },
  { value: "off", label: "Off" },
];

/** What the device asks for: the OS "reduce motion" setting and the browser's data saver (Chromium only). */
export interface MotionEnv {
  reducedMotion: boolean;
  saveData: boolean;
}

export function motionEnv(): MotionEnv {
  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const connection = typeof navigator !== "undefined" ? (navigator as { connection?: { saveData?: boolean } }).connection : undefined;
  return { reducedMotion, saveData: connection?.saveData === true };
}

/** Where a device starts before anyone picks: Gentle when the OS asks for less motion or data saver is on. */
export function defaultMotion(env: MotionEnv = motionEnv()): MotionLevel {
  return env.reducedMotion || env.saveData ? "reduced" : "full";
}

/** A stored motion choice. Builds before the three levels stored a boolean "Animations" switch: on is Full and off
 *  is Off, so nobody's choice changes. Anything else falls back to the device default. */
export function parseMotion(value: unknown, env: MotionEnv = motionEnv()): MotionLevel {
  if (value === true) return "full";
  if (value === false) return "off";
  return MOTION_LEVELS.some((m) => m.value === value) ? (value as MotionLevel) : defaultMotion(env);
}

/** What actually plays: the user's level, except that the OS reduced-motion setting caps Full at Gentle. */
export function effectiveMotion(level: MotionLevel, env: MotionEnv = motionEnv()): MotionLevel {
  return level === "full" && env.reducedMotion ? "reduced" : level;
}

const STORAGE_KEY = "orbit.design";

export function loadDesign(env: MotionEnv = motionEnv()): DesignPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      accent: typeof parsed.accent === "string" && parsed.accent in ACCENTS ? (parsed.accent as AccentName) : DEFAULT_DESIGN.accent,
      textSize: TEXT_SIZES.some((t) => t.value === parsed.textSize) ? (parsed.textSize as TextSize) : "md",
      motion: parseMotion(parsed.motion, env),
    };
  } catch {
    return { ...DEFAULT_DESIGN, motion: defaultMotion(env) };
  }
}

export function saveDesign(prefs: DesignPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — still applied for this session
  }
}

/** Applies accent (CSS variables behind every `indigo-*` class), root text size and the motion level that plays
 *  (`html[data-motion]`, read by base.css, the `motion-ok:` variant and `useMotion()`). */
export function applyDesign(prefs: DesignPrefs, root: HTMLElement = document.documentElement, env: MotionEnv = motionEnv()): void {
  const palette = ACCENTS[prefs.accent].palette;
  SHADES.forEach((shade, i) => root.style.setProperty(`--accent-${shade}`, palette[i] as string));
  root.style.fontSize = `${TEXT_SIZES.find((t) => t.value === prefs.textSize)?.px ?? 16}px`;
  root.setAttribute("data-motion", effectiveMotion(prefs.motion, env));
}

/** Call before React renders so the saved look applies without a flash. Follows the OS motion setting live. */
export function initDesign(): void {
  applyDesign(loadDesign());
  if (typeof window.matchMedia !== "function") return;
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => applyDesign(loadDesign()));
}

export function useDesign(): [DesignPrefs, (patch: Partial<DesignPrefs>) => void] {
  const [prefs, setPrefs] = useState<DesignPrefs>(() => loadDesign());
  // Saved once changed, not on open: visiting Settings must not pin today's device default (Gentle while data saver
  // is on, say) as if the user had chosen it.
  const changed = useRef(false);
  useEffect(() => {
    applyDesign(prefs);
    if (changed.current) saveDesign(prefs);
  }, [prefs]);
  const update = useCallback((patch: Partial<DesignPrefs>) => {
    changed.current = true;
    setPrefs((p) => ({ ...p, ...patch }));
  }, []);
  return [prefs, update];
}
