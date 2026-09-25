import type { Config } from "tailwindcss";
import orbitPreset from "../../packages/ui/tailwind.preset";

export default {
  presets: [orbitPreset],
  darkMode: "class",
  content: ["./index.html", "./overlay.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  plugins: [],
} satisfies Config;
