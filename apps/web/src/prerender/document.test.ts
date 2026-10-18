import { describe, expect, it } from "vitest";
import { appAfterPaint, pageDocument } from "./document";

// A built index.html's head, as Vite writes it: the inline scripts, the module entry, its modulepreloads, the CSS.
const BUILT = `<!doctype html>
<html lang="en">
  <head>
    <title>Orbit</title>
    <meta name="description" content="x" />
    <meta property="og:title" content="x" />
    <meta property="og:description" content="x" />
    <meta property="og:url" content="x" />
    <link rel="canonical" href="https://orbitanswer.com/" />
    <meta name="twitter:title" content="x" />
    <meta name="twitter:description" content="x" />
    <script>/* theme */</script>
    <script>/* app-start */</script>
    <script type="module" crossorigin src="/assets/index-A1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/jsx-runtime-B2.js">
    <link rel="modulepreload" crossorigin href="/assets/ui-C3.js">
    <link rel="stylesheet" crossorigin href="/assets/index-D4.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const head = { title: "Orbit LinkedIn AI", description: "A score out of 100.", canonical: "https://orbitanswer.com/linkedin-ai" };

describe("a built page's document", () => {
  it("lists the app's scripts for after the first paint instead of loading them with the page", () => {
    const out = appAfterPaint(BUILT);
    expect(out).not.toMatch(/<script type="module"|modulepreload/);
    expect(out).toContain('<script type="application/json" id="orbit-app">["/assets/index-A1.js","/assets/jsx-runtime-B2.js","/assets/ui-C3.js"]</script>');
    // Nothing else moves: the inline scripts first, the stylesheet still blocks the first paint.
    expect(out.indexOf("/* app-start */")).toBeLessThan(out.indexOf('id="orbit-app"'));
    expect(out).toContain('<link rel="stylesheet" crossorigin href="/assets/index-D4.css">');
    expect(() => appAfterPaint("<html><head></head></html>")).toThrow(/module script/);
  });

  it("preloads the first paint's font beside the stylesheet", () => {
    const out = pageDocument(BUILT, { path: "/linkedin-ai", head, html: "<main>Hi</main>" }, { fonts: ["/assets/ibm-plex-sans-latin-wght-normal-E5.woff2"] });
    const preload = '<link rel="preload" href="/assets/ibm-plex-sans-latin-wght-normal-E5.woff2" as="font" type="font/woff2" crossorigin>';
    expect(out).toContain(preload);
    expect(out.indexOf(preload)).toBeLessThan(out.indexOf('<link rel="stylesheet"'));
    expect(out).toContain('<div id="prerender" data-path="/linkedin-ai"><main>Hi</main></div><div id="root"></div>');
    expect(pageDocument(BUILT, { path: "/", head, html: "" })).not.toContain('rel="preload"');
  });
});
