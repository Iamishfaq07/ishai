// Content script on Orbit's own "Connect the extension" page only (manifest: content_scripts matches). The page makes
// a token scoped to the extension and posts it here; it's kept in the extension's storage.
const ORIGIN = location.origin;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== ORIGIN) return;
  const data = event.data as { source?: string; type?: string; token?: unknown } | null;
  if (data?.source !== "orbit-web") return;
  // The page asks whether the extension is here (it may load after this script ran).
  if (data.type === "ping") {
    window.postMessage({ source: "orbit-extension", type: "ready" }, ORIGIN);
    return;
  }
  if (data.type !== "extension-token" || typeof data.token !== "string") return;
  void chrome.storage.local.set({ token: data.token, connectedAt: Date.now() }).then(() => {
    window.postMessage({ source: "orbit-extension", type: "connected" }, ORIGIN);
  });
});
window.postMessage({ source: "orbit-extension", type: "ready" }, ORIGIN);
