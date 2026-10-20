/** Reject baked production endpoints when a production build is served from a preview origin. */
export function endpointBases(origin: string, configured: { api?: string; direct?: string; live?: string }) {
  const productionSite = ["orbitanswer.com", "www.orbitanswer.com"].includes(new URL(origin).hostname);
  const resolve = (value: string) => new URL(value, origin).toString().replace(/\/+$/, "");
  const allowed = (value: string) => productionSite || new URL(value, origin).hostname.replace(/\.+$/, "") !== "api.orbitanswer.com";
  const api = configured.api && allowed(configured.api) ? resolve(configured.api) : resolve("/api");
  return { api, direct: configured.direct && allowed(configured.direct) ? resolve(configured.direct) : null,
    live: configured.live && allowed(configured.live) ? resolve(configured.live) : api };
}
