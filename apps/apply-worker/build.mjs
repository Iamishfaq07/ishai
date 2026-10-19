import { build } from "vite";
import { fileURLToPath } from "node:url";

await build({ configFile: false, logLevel: "warn", define: { __ORBIT_APPLY_PACE__: "1" },
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true, minify: false,
    lib: { entry: fileURLToPath(new URL("./src/page.ts", import.meta.url)), formats: ["iife"],
      name: "orbitHosted", fileName: () => "page.js" } } });
