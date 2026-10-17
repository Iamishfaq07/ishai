// The public pages' built HTML (apps/web/src/prerender, written into dist/ by the web build). Every address of the
// single-page app serves the same index.html with an empty root, so a crawler that doesn't run JavaScript (most AI
// assistants' crawlers) would read nothing but a title. For the pages in PAGE_META (meta.js) the Worker serves their
// built copy instead; the app takes over in the browser when it loads. The question bank's pages (/companies,
// /roles and each guide) are built files the assets serve without the Worker.

/** Where a PAGE_META page's built copy is among the assets ("/" → "/_prerender/home"; src/prerender/routes.tsx). */
export function prerenderedAsset(path) {
  return `/_prerender/${path === "/" ? "home" : path.slice(1)}`;
}

/** Signed in, these addresses are the visitor's own pages (the dashboard, their resumes, their jobs), not the public
 *  ones built as HTML. */
export const SIGNED_IN_HOMES = new Set(["/", "/resume-ai", "/jobs"]);

/** Whether the request carries Orbit's session cookie (set by the API through this Worker, for the whole site). Only
 *  whether it's there: an expired one just means the app shows the public page after all. */
export function hasSession(request) {
  return /(?:^|;\s*)orbit_session=[^;\s]/.test(request.headers.get("cookie") || "");
}

/** The asset to serve for a PAGE_META page: its built copy, or null (the app itself) for a signed-in visitor's own
 *  home. A build without the built copies still works: the assets' fallback for a missing file is index.html. */
export function pageAsset(path, request) {
  return SIGNED_IN_HOMES.has(path) && hasSession(request) ? null : prerenderedAsset(path);
}

/** The request to send to the assets for a PAGE_META page. */
export function pageRequest(path, request, url) {
  const asset = pageAsset(path, request);
  return asset ? new Request(new URL(asset, url), request) : request;
}
