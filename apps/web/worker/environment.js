// A production build/config must never give a branch preview access to production data.
const PRODUCTION_HOSTS = new Set(["orbitanswer.com", "www.orbitanswer.com"]);
export function isolatedApi(env, requestUrl) {
  let target;
  try { target = new URL(env.API_URL); } catch { return false; }
  if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) return false;
  if (target.hostname.replace(/\.+$/, "") === "api.orbitanswer.com" &&
    (env.DEPLOYMENT_ENV === "preview" || env.DEPLOYMENT_ENV === "staging" || !PRODUCTION_HOSTS.has(new URL(requestUrl).hostname))) return false;
  return true;
}
export function unavailable() {
  return Response.json({ detail: "This preview has no isolated API configured. Complete staging setup before signing in." },
    { status: 503, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}
