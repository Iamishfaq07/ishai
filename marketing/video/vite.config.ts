// The launch videos' build: two pages, served together by tools/render.mjs.
//
//   app.html   the real Orbit web app (apps/web/src) on a recorded, in-page API (src/app/fixtureApi.ts) and a
//              virtual clock (src/app/virtualTime.ts), so a film can pose it at any moment and get the same picture
//   film.html  the compositions (src/film): typography, camera, captions, and the app in frames (iframes of app.html)
//
// Built with apps/web's own toolchain (no install here):
//   node apps/web/node_modules/vite/bin/vite.js build --config marketing/video/vite.config.ts
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { questionBank } from "../../apps/web/questionBank";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WEB = resolve(REPO, "apps", "web");
const fromWeb = createRequire(resolve(WEB, "package.json"));
const react = (await import(pathToFileURL(fromWeb.resolve("@vitejs/plugin-react")).href)).default;
const tailwind = fromWeb("tailwindcss");
const autoprefixer = fromWeb("autoprefixer");
const NM = resolve(WEB, "node_modules").replace(/\\/g, "/");

export default {
  root: HERE,
  base: "/",
  publicDir: false, // tools/render.mjs serves apps/web/public as a fallback (fonts, icons, the PCM worklet)
  plugins: [react(), questionBank()],
  resolve: {
    // Files in marketing/video import the app's packages through apps/web's node_modules.
    alias: [{ find: /^(react|react-dom|react-router-dom|@orbit\/ui|@orbit\/types)(\/.*)?$/, replacement: `${NM}/$1$2` }],
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify("/api"),
    "import.meta.env.VITE_DESKTOP_DOWNLOAD_URL": JSON.stringify("https://orbitanswer.com/download"),
  },
  css: {
    postcss: { plugins: [tailwind({ config: resolve(HERE, "tailwind.config.ts") }), autoprefixer()] },
  },
  build: {
    outDir: resolve(HERE, process.env.VIDEO_OUT || "dist"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    rolldownOptions: { input: { app: resolve(HERE, "app.html"), film: resolve(HERE, "film.html") } },
  },
  server: { port: 5198, strictPort: true, fs: { allow: [REPO] } },
};
