import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import orbitPreset from "../../packages/ui/tailwind.preset";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

export default {
  presets: [orbitPreset],
  darkMode: "class",
  content: [
    resolve(HERE, "*.html"),
    resolve(HERE, "src/**/*.{ts,tsx}"),
    resolve(REPO, "apps/web/index.html"),
    resolve(REPO, "apps/web/src/**/*.{ts,tsx}"),
    resolve(REPO, "packages/ui/src/**/*.{ts,tsx}"),
  ].map((p) => p.replace(/\\/g, "/")),
  plugins: [],
};
