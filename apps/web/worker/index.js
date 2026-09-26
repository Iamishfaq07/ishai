// Edge entry for the Orbit web app. Static assets (the SPA) are served by Cloudflare before this runs.
//
// /api/* is proxied to the API so the browser sees it as the web app's own origin. The session cookie is then
// first-party: Safari (and every iOS browser, all WebKit) and other browsers that block third-party cookies drop a
// cookie set by a different site (Render), so signing in "worked" but the very next request came back 401 and the
// app bounced to the login page. Live-session WebSockets don't need the cookie (single-use ticket in the URL), so
// they still go straight to the API.
//
// The cron below: Render's free tier sleeps after 15 min without traffic, and the 30–60 s cold start then lands on
// whoever opens the app. /health never touches the DB, so pinging it keeps the API process warm without keeping the
// (separately metered) Neon compute awake.
const API_PREFIX = "/api";

async function proxyToApi(request, env, url) {
  const target = new URL(env.API_URL);
  target.pathname = target.pathname.replace(/\/+$/, "") + (url.pathname.slice(API_PREFIX.length) || "/");
  target.search = url.search;

  // Copies method, headers and (streamed) body.
  const proxied = new Request(target, request);
  // The API's per-IP rate limits and audit log read the left-most X-Forwarded-For entry; without this every
  // proxied request would appear to come from Cloudflare's egress address.
  // Never trust a client-sent X-Forwarded-For: without Cloudflare's own address, drop it (no spoofed IPs).
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) proxied.headers.set("x-forwarded-for", clientIp);
  else proxied.headers.delete("x-forwarded-for");
  return fetch(proxied);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      return proxyToApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(fetch(`${env.API_URL}/health`, { headers: { "user-agent": "orbit-keep-warm" } }));
  },
};
