import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/** What the tray menu asks the window to do (src-tauri/src/lib.rs `TRAY_EVENT`). */
export type TrayRequest = "new-session" | "history" | "settings" | "web";
const TRAY_EVENT = "orbit:tray";

/** A tray request, or null for anything else (an older or newer build's item). */
export function trayRequest(payload: unknown): TrayRequest | null {
  return payload === "new-session" || payload === "history" || payload === "settings" || payload === "web" ? payload : null;
}

/**
 * Handles the tray menu's items. Rust has already shown the window for the screen ones; App decides what a request
 * means right now (during a live session it never leaves the session).
 */
export function useTrayRequests(handle: (request: TrayRequest) => void): void {
  const ref = useRef(handle);
  ref.current = handle;
  useEffect(() => {
    const off = listen<unknown>(TRAY_EVENT, (event) => {
      const request = trayRequest(event.payload);
      if (request) ref.current(request);
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, []);
}
