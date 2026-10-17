import { useLayoutEffect, type ReactNode } from "react";

/**
 * The public pages arrive as HTML (built by src/prerender): `<div id="prerender">` holds the page, and the app's own
 * `#root` stays hidden behind it (index.css) while the app loads. When the app's copy of that page is on screen, it
 * takes over in the same frame: the built copy is removed and `#root` shows. Nothing is hydrated, so the two copies
 * never have to match exactly; they're the same components, so they look the same.
 */
const ID = "prerender";

/** The address the built page is for, while it's still showing. */
export function prerenderedPath(): string | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(ID)?.dataset.path ?? null;
}

/** Hand the screen to the app: the built copy goes, `#root` shows. */
export function handOff(): void {
  if (typeof document !== "undefined") document.getElementById(ID)?.remove();
}

/** Around a page that has a built copy: once this page is on screen (its code loaded), the app takes over. */
export function Prerendered({ children }: { children: ReactNode }) {
  useLayoutEffect(handOff, []);
  return <>{children}</>;
}

/** The app went somewhere else (a link, a redirect, a signed-in home): the built copy isn't this page any more. */
export function useHandOffElsewhere(pathname: string): void {
  useLayoutEffect(() => {
    const path = prerenderedPath();
    if (path !== null && path !== (pathname.replace(/\/+$/, "") || "/")) handOff();
  }, [pathname]);
}
