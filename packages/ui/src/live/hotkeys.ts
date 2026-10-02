import { useEffect, useRef } from "react";
import { isDialogOpen } from "../hooks/useFocusTrap";

export type HotkeyAction =
  | "answer"
  | "screenshot"
  | "toggleListening"
  | "focusChat"
  | "clear"
  | "prevAnswer"
  | "nextAnswer";

/** Combos use "Mod" for Cmd on macOS and Ctrl elsewhere, e.g. "Mod+Shift+S". */
export type HotkeyMap = Record<HotkeyAction, string>;

export const DEFAULT_HOTKEYS: HotkeyMap = {
  answer: "Mod+Enter",
  screenshot: "Mod+Shift+S",
  toggleListening: "Mod+L",
  focusChat: "Mod+K",
  clear: "Mod+Shift+C",
  prevAnswer: "Alt+ArrowLeft",
  nextAnswer: "Alt+ArrowRight",
};

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  answer: "Answer now",
  screenshot: "Screenshot region",
  toggleListening: "Pause / resume listening",
  focusChat: "Focus chat",
  clear: "Clear answer",
  prevAnswer: "Previous answer",
  nextAnswer: "Next answer",
};

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

interface ParsedCombo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    mod: mods.has("mod") || mods.has("ctrl") || mods.has("cmd") || mods.has("meta"),
    shift: mods.has("shift"),
    alt: mods.has("alt") || mods.has("option"),
    key: key.toLowerCase(),
  };
}

export function matchesHotkey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  combo: string,
  isMac: boolean,
): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  if (parsed.mod !== modPressed) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  return event.key.toLowerCase() === parsed.key;
}

// Named keys as people write them (parseCombo lowercases: "arrowleft" would otherwise show as "Arrowleft").
const KEY_LABEL: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  pageup: "PgUp",
  pagedown: "PgDn",
};

/** Human label: "⌘ ⇧ S" on macOS, "Ctrl+Shift+S" elsewhere. */
export function formatHotkey(combo: string, isMac: boolean = isMacPlatform()): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo;
  const key = parsed.key.length === 1 ? parsed.key.toUpperCase() : (KEY_LABEL[parsed.key] ?? capitalize(parsed.key));
  if (isMac) {
    return [parsed.mod && "⌘", parsed.shift && "⇧", parsed.alt && "⌥", key === "Enter" ? "↩" : key]
      .filter(Boolean)
      .join(" ");
  }
  return [parsed.mod && "Ctrl", parsed.shift && "Shift", parsed.alt && "Alt", key].filter(Boolean).join("+");
}

/** Builds a combo string from a keydown event (used by the Settings hotkey recorder). */
export function comboFromEvent(event: KeyboardEvent, isMac: boolean = isMacPlatform()): string | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push("Mod");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (parts.length === 0) return null; // require a modifier so typing never triggers actions
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Runs the handler bound to this key press, if any. Nothing fires while a dialog is open: with "End this session?"
 * on screen, Ctrl+Enter mustn't generate an answer (or Ctrl+L pause listening) behind it.
 */
export function dispatchHotkey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "preventDefault">,
  map: HotkeyMap,
  handlers: Partial<Record<HotkeyAction, () => void>>,
  isMac: boolean,
): boolean {
  if (isDialogOpen()) return false;
  for (const action of Object.keys(map) as HotkeyAction[]) {
    if (matchesHotkey(event, map[action], isMac)) {
      const handler = handlers[action];
      if (!handler) return false;
      event.preventDefault();
      handler();
      return true;
    }
  }
  return false;
}

/** Window-level shortcuts while Orbit is focused. Handlers are read through a ref, so no re-binding churn. */
export function useHotkeys(
  map: HotkeyMap,
  handlers: Partial<Record<HotkeyAction, () => void>>,
  enabled = true,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const isMac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent) => void dispatchHotkey(event, map, handlersRef.current, isMac);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map, enabled]);
}

const STORAGE_KEY = "orbit.hotkeys";

export function loadHotkeys(): HotkeyMap {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return DEFAULT_HOTKEYS;
    const parsed = JSON.parse(raw) as Partial<HotkeyMap>;
    return { ...DEFAULT_HOTKEYS, ...parsed };
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

export function saveHotkeys(map: HotkeyMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}
