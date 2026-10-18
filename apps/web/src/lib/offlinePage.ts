/** The offline page (public/sw.js): a page load that fails because the device is offline shows Orbit's "You're
 *  offline" page instead of the browser's error. Production builds over https only (never the dev server, the e2e run
 *  or the desktop app). VITE_OFFLINE_PAGE=off at build time is the kill switch: no new registration, and the one a
 *  browser already has is removed. */
export function setUpOfflinePage(env: { PROD: boolean; VITE_OFFLINE_PAGE?: string } = import.meta.env): void {
  if (!env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:") return;
  const sw = navigator.serviceWorker;
  if (env.VITE_OFFLINE_PAGE === "off") {
    void sw.getRegistrations().then((all) => all.forEach((r) => void r.unregister())).catch(() => {});
    return;
  }
  // After the page has loaded: the worker's own start-up never competes with the first paint.
  const register = () => void sw.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
