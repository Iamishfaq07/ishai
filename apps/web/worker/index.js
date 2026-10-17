// Edge entry for the Orbit web app. It runs first for every page address; the built files under /assets/ (and the
// few listed in wrangler.jsonc) are served by Cloudflare without it.
//
// /api/* is proxied to the API so the browser sees it as the web app's own origin. The session cookie is then
// first-party: Safari (and every iOS browser, all WebKit) and other browsers that block third-party cookies drop a
// cookie set by a different site (the API's host), so signing in "worked" but the very next request came back 401 and
// the app bounced to the login page. Live-session WebSockets don't need the cookie (single-use ticket in the URL), so
// they still go straight to the API.
//
// The cron below: a host that sleeps when idle (free tiers do) would land its 30–60 s cold start on whoever opens the
// app. /health never touches the DB, so pinging it keeps the API process warm without keeping the (separately
// metered) Neon compute awake.
import { metaFor, withPageMeta } from "./meta.js";
import { pageRequest } from "./prerendered.js";
import { withSeo } from "./seo.js";

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
  // With the shared secret (wrangler secret PROXY_SECRET = the API's ORBIT_PROXY_SECRET) the API believes the
  // client IP stated here and nothing a caller sends directly; never forward a client's own copy of either header.
  proxied.headers.delete("x-orbit-proxy-secret");
  proxied.headers.delete("x-orbit-client-ip");
  proxied.headers.delete("x-orbit-client-country");
  // The API trusts its host's forwarding headers (uvicorn --forwarded-allow-ips): a visitor's own copies of them
  // (another scheme, host or client address) never reach it through here; the API's host adds its own.
  for (const name of FORWARDING_HEADERS) proxied.headers.delete(name);
  if (env.PROXY_SECRET && clientIp) {
    proxied.headers.set("x-orbit-proxy-secret", env.PROXY_SECRET);
    proxied.headers.set("x-orbit-client-ip", clientIp);
    // The visitor's country, from Cloudflare: prices are in rupees in India and US dollars elsewhere.
    const country = request.cf?.country || request.headers.get("cf-ipcountry");
    if (country && country !== "XX" && country !== "T1") proxied.headers.set("x-orbit-client-country", country);
  }
  // Never follow the API's redirects here (Google sign-in, installer downloads): the browser must get them, and a
  // followed one would carry the proxy secret to whatever host it points at.
  return fetch(proxied, { redirect: "manual" });
}

const FORWARDING_HEADERS = ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "x-forwarded-scheme", "x-real-ip", "true-client-ip", "x-original-url", "x-rewrite-url"];

const handlers = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      return proxyToApi(request, env, url);
    }
    // The public pages people share get their own link preview (meta.js) and their built HTML (prerendered.js), so
    // crawlers that don't run JavaScript read them. Should rewriting ever fail, the page is served as it is.
    const meta = request.method === "GET" ? metaFor(url.pathname) : null;
    if (meta) {
      const page = await env.ASSETS.fetch(pageRequest(meta.path, request, url));
      try {
        return withPageMeta(page, url);
      } catch {
        return page;
      }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(fetch(`${env.API_URL}/health`, { headers: { "user-agent": "orbit-keep-warm" } }));
  },
};

// Around every page: one address per page, real 404s, noindex for the app's own pages, robots.txt and the head tags
// search engines read (seo.js, DECISIONS D67). The API proxy passes straight through.
export default {
  fetch: (request, env) => withSeo(request, env, new URL(request.url), (req) => handlers.fetch(req, env)),
  scheduled: (event, env, ctx) => handlers.scheduled(event, env, ctx),
};
