// The browser globals the public pages touch while their modules load (lib/api.ts reads window.location), for the
// build-time render in Node (entry.tsx imports this first). Effects never run in a server render, so nothing here
// is ever called for real. Pinned to India (time zone and language), where Orbit's copy starts, so every build
// writes the same pages whatever machine it runs on.
const g = globalThis as Record<string, unknown>;

if (typeof g.window === "undefined") {
  process.env.TZ = "Asia/Kolkata";
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  };
  const noop = () => undefined;
  g.window = globalThis;
  g.location = new URL("https://orbitanswer.com/");
  g.localStorage = store();
  g.sessionStorage = store();
  g.matchMedia = () => ({ matches: false, media: "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
  g.addEventListener = noop;
  g.removeEventListener = noop;
  Object.defineProperty(globalThis, "navigator", {
    // Data saver on: the built copy skips the sky's stars and draws animated pictures finished (the app adds both).
    value: { language: "en-IN", languages: ["en-IN"], userAgent: "orbit-prerender", onLine: true, connection: { saveData: true } },
    configurable: true,
  });
}

export {};
