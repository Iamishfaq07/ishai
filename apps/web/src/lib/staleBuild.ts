/**
 * After a deploy, a tab (or a cached page) from the build before asks for page files that no longer exist: their names
 * change with every build. Loading the page again gets the new build. Once, though: if the file is missing for
 * another reason (offline, a bad deploy), a reload loop would be worse than the error screen.
 */

const KEY = "orbit.preloadReloadAt";
const GAP_MS = 15_000;

/** The browsers' wordings for "that script file isn't there". */
export function isStaleBuildError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Unable to preload CSS/i.test(text);
}

/** Load the page again for the new build, unless that was just tried (or mid-interview, where a reload would drop the
 *  microphone). Says whether it's reloading. */
export function reloadForNewBuild(): boolean {
  if (window.location.pathname.startsWith("/live/")) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < GAP_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // no storage, so no loop guard: leave it to the error screen
  }
  window.location.reload();
  return true;
}
