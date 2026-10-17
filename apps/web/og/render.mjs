// The link previews (WhatsApp, LinkedIn, X, Slack): one 1200 x 630 card per public page.
//
//   node apps/web/og/render.mjs            (repo root; needs playwright-core and system Chrome)
//
// 1. Writes each page's SVG source here (apps/web/og/<page>.svg) from the table below: the outlined wordmark, the
//    product, the page's promise in IBM Plex Sans (loaded from node_modules), and a crop of a real screen of the app
//    (marketing/screens/src, captured from a local stack with demo data).
// 2. Renders each SVG in headless Chrome to apps/web/public/og/<page>.jpg (JPEG q90: crawlers don't take SVG, and
//    WhatsApp skips previews over 300 KB), and the front page's also to public/og-image.jpg (index.html's default).
// Headlines that would run into the picture are set a size smaller until they fit. worker/meta.js points each page's
// og:image at its file.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OG = dirname(fileURLToPath(import.meta.url));
const WEB = join(OG, "..");
const REPO = join(WEB, "..", "..");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");

// Brand: the front door's dark canvas and ink, one accent, product colours for the small mark only.
const INK = { canvas: "#0B0F17", surface: "#141B27", line: "#232C3B", text: "#F6F7FB", soft: "#A3A9C6" };
const DOT = { orbit: "#8666FF", copilot: "#8666FF", practice: "#FB923C", resume: "#34D399", jobs: "#38BDF8" };

/** page: [file, chip, dot, headline lines, sub lines, screen, crop [x y w h] in the 2560 x 1600 capture]. */
const PAGES = [
  ["home", "One account", "orbit", ["Interview-ready,", "from resume to offer."], ["Practice, Resume AI, Jobs AI and a live", "interview copilot, in one free account."], "copilot", [130, 80, 1580, 1000]],
  ["resume-ai", "Resume AI", "resume", ["Your resume, ready", "for every job."], ["An ATS score out of 100, and AI rewrites", "that keep your own numbers."], "resume", [500, 180, 2060, 1420]],
  ["jobs", "Jobs AI", "jobs", ["Find jobs that fit", "your resume."], ["New openings from companies' own careers", "pages, ranked by how well you fit."], "jobs", [500, 300, 2060, 1300]],
  ["warmup", "Free practice", "practice", ["Answer one interview", "question, free."], ["Type or speak your answer and see what", "to improve. No account needed."], "practice", [500, 300, 2060, 1300]],
  ["technical", "How Orbit works", "copilot", ["How Orbit answers", "in real time."], ["Measured answer speed, the live pipeline", "and the desktop app's protections."], "copilot", [130, 80, 1580, 1000]],
  ["contact", "Contact", "orbit", ["Talk to the", "Orbit team."], ["Questions, payments or a job that looks", "wrong: a person reads every message."], null, null],
];

function wordmark() {
  const svg = readFileSync(join(REPO, "marketing", "brand", "orbit-wordmark-dark.svg"), "utf8");
  return svg.replace(/<!--[\s\S]*?-->/g, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/id="(r|c)"/g, 'id="wm-$1"').replace(/url\(#(r|c)\)/g, "url(#wm-$1)");
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The contact card has no screen: a message being written, drawn in the same window. */
function contactPicture() {
  const line = (y, w) => `<rect x="32" y="${y}" width="${w}" height="12" rx="6" fill="${INK.soft}" fill-opacity="0.35"/>`;
  return `<g transform="translate(700 120)">
    <rect width="560" height="420" rx="18" fill="${INK.surface}" stroke="#FFFFFF" stroke-opacity="0.1"/>
    <text x="32" y="58" font-size="22" font-weight="600" fill="${INK.text}">Contact us</text>
    <text x="32" y="92" font-size="16" fill="${INK.soft}">What's it about?</text>
    ${["General question", "Payment or credits", "Report a job"].map((t, i) => {
      const x = [32, 196, 370][i];
      const w = [150, 160, 128][i];
      return `<rect x="${x}" y="110" width="${w}" height="36" rx="18" fill="${i === 1 ? DOT.orbit : "none"}" fill-opacity="${i === 1 ? 0.18 : 0}" stroke="${i === 1 ? DOT.orbit : "#FFFFFF"}" stroke-opacity="${i === 1 ? 0.7 : 0.16}"/>
      <text x="${x + w / 2}" y="134" text-anchor="middle" font-size="15" font-weight="500" fill="${INK.text}">${t}</text>`;
    }).join("")}
    <rect x="32" y="176" width="496" height="150" rx="10" fill="${INK.canvas}" stroke="#FFFFFF" stroke-opacity="0.12"/>
    ${line(200, 380)}${line(224, 300)}${line(248, 340)}
    <rect x="32" y="352" width="148" height="40" rx="8" fill="${DOT.orbit}"/>
    <text x="106" y="378" text-anchor="middle" font-size="16" font-weight="600" fill="#FFFFFF">Send message</text>
  </g>`;
}

function card([, chip, dot, head, sub, screen, crop]) {
  // Relative to the SVG's own folder, so the source opens (and renders) on any checkout.
  const font = "../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2";
  const shot = screen ? `../../../marketing/screens/src/${screen}-dark.png` : null;
  const chipW = 44 + chip.length * 10.4;
  const picture = shot
    ? `<g clip-path="url(#win)">
        <rect x="700" y="96" width="560" height="470" fill="${INK.surface}"/>
        <svg x="700" y="96" width="560" height="470" viewBox="${crop.join(" ")}" preserveAspectRatio="xMinYMin slice">
          <image href="${shot}" width="2560" height="1600"/>
        </svg>
      </g>
      <rect x="700.5" y="96.5" width="580" height="469" rx="16" fill="none" stroke="#FFFFFF" stroke-opacity="0.12"/>`
    : contactPicture();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <!-- Generated by render.mjs (edit the table there, then run it). The link preview of a public page. -->
  <style>
    @font-face { font-family: "Plex"; src: url("${font}") format("woff2-variations"); font-weight: 100 700; }
    text { font-family: "Plex", "IBM Plex Sans", sans-serif; }
  </style>
  <defs>
    <clipPath id="win"><rect x="700" y="96" width="600" height="470" rx="16"/></clipPath>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#FFFFFF" stroke-opacity="0.045"/></pattern>
    <radialGradient id="fade" cx="0.78" cy="0.1" r="0.7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="gridmask"><rect width="1200" height="630" fill="url(#fade)"/></mask>
    <radialGradient id="light" cx="0.8" cy="-0.05" r="0.6"><stop offset="0" stop-color="${DOT.orbit}" stop-opacity="0.16"/><stop offset="1" stop-color="${DOT.orbit}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${INK.canvas}"/>
  <rect width="1200" height="630" fill="url(#grid)" mask="url(#gridmask)"/>
  <rect width="1200" height="630" fill="url(#light)"/>
  <g transform="translate(72 56) scale(0.625)">${wordmark()}</g>
  <g transform="translate(72 160)">
    <rect width="${chipW}" height="40" rx="20" fill="#FFFFFF" fill-opacity="0.05" stroke="#FFFFFF" stroke-opacity="0.12"/>
    <circle cx="22" cy="20" r="6" fill="${DOT[dot]}"/>
    <text x="36" y="27" font-size="18" font-weight="500" fill="${INK.text}">${esc(chip)}</text>
  </g>
  <g id="head" font-size="54" font-weight="600" fill="${INK.text}" letter-spacing="-1.6">
    ${head.map((t, i) => `<text x="72" y="${280 + i * 64}">${esc(t)}</text>`).join("\n    ")}
  </g>
  <g font-size="23" fill="${INK.soft}">
    ${sub.map((t, i) => `<text x="72" y="${430 + i * 33}">${esc(t)}</text>`).join("\n    ")}
  </g>
  <text x="72" y="566" font-size="20" font-weight="500" fill="${INK.soft}">orbitanswer.com</text>
  ${picture}
</svg>
`;
}

mkdirSync(join(WEB, "public", "og"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const p of PAGES) {
  const [name, , , , , screen] = p;
  if (screen && !existsSync(join(REPO, "marketing", "screens", "src", `${screen}-dark.png`))) throw new Error(`capture the screens first: ${screen}-dark.png`);
  const svgFile = join(OG, `${name}.svg`);
  writeFileSync(svgFile, card(p));
  await page.goto(pathToFileURL(svgFile).href);
  await page.evaluate(() => document.fonts.ready);
  // Set the headline a size smaller while a line would run into the picture (it starts at x = 700).
  const size = await page.evaluate(() => {
    const g = document.getElementById("head");
    let s = 54;
    const widest = () => Math.max(...[...g.querySelectorAll("text")].map((t) => t.getBBox().width));
    while (widest() > 600 && s > 40) {
      s -= 2;
      g.setAttribute("font-size", String(s));
    }
    return s;
  });
  if (size !== 54) writeFileSync(svgFile, readFileSync(svgFile, "utf8").replace('<g id="head" font-size="54"', `<g id="head" font-size="${size}"`));
  const outs = [join(WEB, "public", "og", `${name}.jpg`), ...(name === "home" ? [join(WEB, "public", "og-image.jpg")] : [])];
  for (const out of outs) {
    await page.screenshot({ path: out, type: "jpeg", quality: 90 });
    const kb = Math.round(statSync(out).size / 1024);
    console.log(`${out}  ${kb} KB${size !== 54 ? ` (headline ${size}px)` : ""}`);
    if (kb > 300) throw new Error(`${out} is over 300 KB: WhatsApp would skip it`);
  }
}
await browser.close();
