import type { Config } from "tailwindcss";
import orbitPreset from "../../packages/ui/tailwind.preset";

export default {
  presets: [orbitPreset],
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./worker/careers.js", "../../packages/ui/src/**/*.{ts,tsx}"],
  plugins: [],
} satisfies Config;
