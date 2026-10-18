// Orbit's service worker has one job: when a page can't load because the device is offline, show Orbit's "You're
// offline" page (/offline.html) instead of the browser's error page. Nothing else is cached or answered: the API, the
// app's files and every page that loads go to the network exactly as without a service worker. Registered by
// src/lib/offlinePage.ts (production builds only).
//
// To retire it: set RETIRE = true and deploy. Every browser that has it unregisters it at its next update check and
// stops answering anything (and VITE_OFFLINE_PAGE=off at build time stops new registrations and removes old ones).
const RETIRE = false;
const CACHE = "orbit-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (RETIRE) return;
      const res = await fetch(OFFLINE, { cache: "reload" });
      if (!res.ok) throw new Error(`offline page: ${res.status}`);
      // Copied, so a redirect on the way (/offline.html → /offline) isn't kept: a redirected response can't answer a
      // page load.
      const page = new Response(await res.blob(), { headers: { "content-type": "text/html; charset=utf-8" } });
      await (await caches.open(CACHE)).put(OFFLINE, page);
    })().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Only its own old copies: the page's own caches (Saba's voice clips, "orbit-voice-v1") are the page's to keep,
      // and a new worker wiped them, so a returning user paid for her hello and acknowledgements again.
      for (const key of await caches.keys()) if (key.startsWith("orbit-offline-") && (RETIRE || key !== CACHE)) await caches.delete(key);
      if (RETIRE) {
        await self.registration.unregister();
        return;
      }
      // The page's own request starts while this worker is still starting up, so having it costs a page load nothing.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (RETIRE || req.mode !== "navigate" || req.method !== "GET") return; // not a page load: the network, untouched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(req);
      } catch (error) {
        const offline = await caches.match(OFFLINE);
        if (offline) return offline;
        throw error;
      }
    })(),
  );
});
