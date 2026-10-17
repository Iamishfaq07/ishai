// The policies are plain HTML files (public/privacy.html …) that the site serves at their address without ".html"
// (/privacy: Cloudflare's assets, and the Worker redirects the ".html" one; DECISIONS D67). The app links to that
// address, so the dev server and `vite preview` answer it the same way instead of drawing the app's "not found".
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Connect, Plugin } from "vite";

export const POLICY_NAMES = ["privacy", "terms", "cookies", "refund"] as const;

/** "/privacy" (and "/privacy/", with any query) → "/privacy.html" when that file exists in `dir`; else null. */
export function policyFile(url: string, dir: string): string | null {
  const [path, query = ""] = url.split(/\?(.*)/s, 2);
  const m = /^\/([a-z]+)\/?$/.exec(path ?? "");
  if (!m || !(POLICY_NAMES as readonly string[]).includes(m[1]!) || !existsSync(join(dir, `${m[1]}.html`))) return null;
  return `/${m[1]}.html${query ? `?${query}` : ""}`;
}

export function policyPages(): Plugin {
  let publicDir = "public";
  let outDir = "dist";
  const rewrite =
    (dir: () => string): Connect.NextHandleFunction =>
    (req, _res, next) => {
      const to = req.url ? policyFile(req.url, dir()) : null;
      if (to) req.url = to;
      next();
    };
  return {
    name: "orbit-policy-pages",
    configResolved(config) {
      publicDir = config.publicDir;
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(rewrite(() => publicDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite(() => join(server.config.root, outDir)));
    },
  };
}
