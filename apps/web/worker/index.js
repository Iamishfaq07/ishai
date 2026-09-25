// Edge entry for the Orbit web app. Static assets (the SPA) are served by Cloudflare before this runs,
// except for /api/* (`run_worker_first` in wrangler.jsonc), which this worker forwards to the API.
//
// Why proxy: the session cookie is httpOnly and set by the API. Called directly, the API is another site
// (onrender.com), so its cookie is a third-party cookie, and Safari on iOS (every iPhone browser is WebKit)
// blocks those by default. Sign-in would succeed, the next /v1/auth/me would arrive without the cookie and
// answer 401, and the app would bounce back to sign-in forever. Through /api the cookie belongs to the web
// app's own origin and every browser keeps it.
//
// The cron: Render's free tier sleeps after 15 min without traffic, and the 30–60 s cold start then lands on
// whoever opens the app. /health never touches the DB, so pinging it keeps the API process warm without
// keeping the (separately metered) Neon compute awake.
const API_PREFIX = "/api";

function proxyToApi(request, env) {
  const url = new URL(request.url);
  const target = new URL(url.pathname.slice(API_PREFIX.length) || "/", env.API_URL);
  target.search = url.search;

  // The API rate-limits and audits by client IP, read from X-Forwarded-For. Replace whatever the browser
  // sent with the address Cloudflare saw: otherwise every user would share the worker's egress IP.
  const headers = new Headers(request.headers);
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  else headers.delete("x-forwarded-for");

  return fetch(target, { method: request.method, headers, body: request.body, redirect: "manual" });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return proxyToApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(fetch(`${env.API_URL}/health`, { headers: { "user-agent": "orbit-keep-warm" } }));
  },
};
