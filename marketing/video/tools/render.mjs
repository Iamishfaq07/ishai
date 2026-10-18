// Renders the films (marketing/video/film.html, built into dist/ by vite.config.ts) in headless Chrome, frame by frame.
//
//   node tools/render.mjs meta   <film> <fmt> <out.json>              duration, cues, music markers, captions, VO
//   node tools/render.mjs stills <film> <fmt> <dir> <t> [<t> ...]      single frames (PNG), for review
//   node tools/render.mjs sheet  <film> <fmt> <out.jpg> [cols] [rows]   a contact sheet of evenly spaced frames
//   node tools/render.mjs video  <film> <fmt> <out.mp4>                 the picture (no sound; tools/mux.mjs adds it)
//   node tools/render.mjs medialog <film> <fmt> <out.json>             where the app played each voice clip (Saba);
//                                                                       to vo/saba-plays.json: merged in, for the mix
//
// Options (env): FPS (30), DPR (1; 2 renders a 1920x1080 film at 3840x2160), CRF (17), START/END (seconds),
// VO=0 (the music-only cut of a film where captions differ), JPEGQ (95), PLAYWRIGHT (path to playwright-core's index.mjs),
// FFMPEG (ffmpeg binary).
//
// The pages are served from dist/ over HTTP (ES modules don't load from file://); apps/web/public is the fallback
// for the app's own static files, and any other path is the app page (its router picks the screen). Every request
// the app makes to its API is answered in the page from fixtures/, so no server is needed.
import http from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const REPO = resolve(ROOT, "..", "..");
const DIST = join(ROOT, process.env.VIDEO_DIST || "dist");
const PUBLIC = join(REPO, "apps", "web", "public");
const PW = process.env.PLAYWRIGHT || join(REPO, "node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json",
  ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ico": "image/x-icon", ".task": "application/octet-stream", ".txt": "text/plain" };

export function serve() {
  return new Promise((ok) => {
    const server = http.createServer((req, res) => {
      const path = decodeURIComponent((req.url || "/").split("?")[0]);
      const send = (file) => {
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "max-age=3600" });
        createReadStream(file).pipe(res);
      };
      // The voice files the app's own voice requests are answered with (the Saba film).
      if (path.startsWith("/__vo/")) {
        const vo = join(process.env.VO_DIR || join(process.env.TEMP || "", "orbit-video", "vo"), "trim");
        const file = join(vo, path.slice(6));
        if (file.startsWith(vo) && existsSync(file)) return send(file);
      }
      for (const base of [DIST, PUBLIC]) {
        const file = join(base, path);
        if (file.startsWith(base) && existsSync(file) && statSync(file).isFile()) return send(file);
      }
      if (extname(path) && !path.endsWith(".html")) {
        res.writeHead(404);
        return res.end();
      }
      send(join(DIST, "app.html"));
    });
    server.listen(0, "127.0.0.1", () => ok(server));
  });
}

export async function openFilm(film, fmt, { dpr = 1, vo = true } = {}) {
  const { chromium } = await import(pathToFileURL(PW).href);
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--mute-audio",
      "--force-color-profile=srgb", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  });
  const dims = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080], "4x5": [1080, 1350] }[fmt];
  if (!dims) throw new Error(`unknown format ${fmt}`);
  const page = await browser.newPage({ viewport: { width: dims[0], height: dims[1] }, deviceScaleFactor: dpr, colorScheme: "light" });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" || text.startsWith("[fixture-miss]") || text.startsWith("[video]")) console.error(`console.${m.type()}:`, text.slice(0, 300));
  });
  await page.goto(`http://127.0.0.1:${port}/film.html?film=${encodeURIComponent(film)}&fmt=${fmt}&vo=${vo ? 1 : 0}&cap=${process.env.NOCAP === "1" ? 0 : 1}`);
  // Polled from here: the page's own timers run on the films' virtual clock.
  for (let i = 0; i < 1200 && !(await page.evaluate(() => window.READY === true).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  const info = await page.evaluate(() => ({ duration: window.FILM.duration, cover: window.FILM.cover }));
  const seek = (t) => page.evaluate((t) => window.FILM.seek(t), t);
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { page, info, seek, close, dims, dpr };
}

async function main() {
  const [mode, film, fmt, out, ...rest] = process.argv.slice(2);
  if (!mode || !film || !fmt || !out) {
    console.error("usage: node tools/render.mjs <meta|stills|sheet|video> <film> <fmt> <out> [...]");
    process.exit(2);
  }
  const dpr = Number(process.env.DPR || 1);
  const vo = process.env.VO !== "0";
  const f = await openFilm(film, fmt, { dpr, vo });
  const { page, info, seek } = f;
  console.log(`${film} ${fmt}: ${info.duration}s at ${f.dims[0] * dpr}x${f.dims[1] * dpr}`);
  try {
    if (mode === "meta") {
      const meta = await page.evaluate(() => ({ id: window.FILM.id, duration: window.FILM.duration, bpm: window.FILM.bpm, fmt: window.FILM.fmt,
        cover: window.FILM.cover, cues: window.FILM.cues(), music: window.FILM.music(), captions: window.FILM.captions(), vo: window.FILM.vo() }));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(meta, null, 1));
      console.log("wrote", out, meta.cues.length, "cues");
    } else if (mode === "medialog") {
      // Plays the film through (at 30 fps, no pictures) and writes where each audio clip the app played really fell.
      const FPS = 30;
      const logs = [];
      for (let i = 0; i < Math.round(info.duration * FPS); i++) {
        await seek(i / FPS);
        for (const e of await page.evaluate(() => window.FILM.mediaLogs())) {
          const key = `${e.frame}|${e.at.toFixed(3)}`;
          if (!logs.some((x) => x.key === key)) logs.push({ key, ...e });
          else Object.assign(logs.find((x) => x.key === key), e);
        }
      }
      mkdirSync(dirname(out), { recursive: true });
      if (out.endsWith("-plays.json")) {
        // vo/saba-plays.json: { "<film>/<fmt>": [{ file, at, end }] }, the clips' places for the mix (films/saba.tsx)
        const all = existsSync(out) ? JSON.parse((await import("node:fs")).readFileSync(out, "utf8")) : {};
        all[`${film}/${fmt}`] = logs.map((e) => ({ file: (e.served ?? "?").split("|")[0], at: Number(e.at.toFixed(4)), end: e.end === null ? null : Number(e.end.toFixed(4)) }));
        const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
        writeFileSync(out, JSON.stringify(sorted, null, 1) + "\n");
      } else writeFileSync(out, JSON.stringify(logs, null, 1));
      for (const e of logs) console.log(`${e.served ?? "?"}  ${e.at.toFixed(3)} -> ${e.end === null ? "?" : e.end.toFixed(3)}`);
    } else if (mode === "stills") {
      mkdirSync(out, { recursive: true });
      const times = rest.length ? rest.map(Number) : [info.cover];
      for (const t of times) {
        const t0 = Date.now();
        await seek(t);
        const file = join(out, `${film}-${fmt}-t${t.toFixed(2).padStart(6, "0")}.png`);
        await page.screenshot({ path: file, type: "png" });
        console.log("still", t, `${Date.now() - t0}ms`, file);
      }
    } else if (mode === "sheet") {
      const cols = Number(rest[0] || 6);
      const rows = Number(rest[1] || 5);
      const n = cols * rows;
      const tmp = join(dirname(out), `.sheet-${process.pid}`);
      mkdirSync(tmp, { recursive: true });
      const START = Number(process.env.START || 0);
      const END = Number(process.env.END || info.duration);
      for (let i = 0; i < n; i++) {
        const t = START + ((END - START) * (i + 0.5)) / n;
        await seek(t);
        await page.screenshot({ path: join(tmp, `f${String(i).padStart(3, "0")}.jpg`), type: "jpeg", quality: 80 });
      }
      const w = fmt === "9x16" || fmt === "4x5" ? 270 : fmt === "1x1" ? 300 : 400;
      await run(FFMPEG, ["-y", "-loglevel", "error", "-framerate", "1", "-i", join(tmp, "f%03d.jpg"), "-vf",
        `scale=${w}:-2,drawtext=${process.platform === "win32" ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : ""}text='%{n}':x=6:y=6:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.5,tile=${cols}x${rows}:padding=6:margin=6:color=0x202020`,
        "-frames:v", "1", "-q:v", "3", out]);
      for (const fl of (await import("node:fs")).readdirSync(tmp)) (await import("node:fs")).unlinkSync(join(tmp, fl));
      (await import("node:fs")).rmdirSync(tmp);
      console.log("wrote", out, `(${n} frames, ${((END - START) / n).toFixed(2)} s apart, from ${START}s)`);
    } else if (mode === "video") {
      const FPS = Number(process.env.FPS || 30);
      const START = Number(process.env.START || 0);
      const END = Number(process.env.END || info.duration);
      const frames = Math.round((END - START) * FPS);
      mkdirSync(dirname(out), { recursive: true });
      const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", process.env.PRESET || "slow", "-crf", process.env.CRF || "17", "-profile:v", "high",
        "-level:v", dpr > 1 ? "5.2" : FPS > 30 ? "4.2" : "4.1", "-g", String(FPS * 2), "-bf", "2", "-r", String(FPS),
        "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-movflags", "+faststart", out];
      const ff = spawn(FFMPEG, args, { stdio: ["pipe", "inherit", "inherit"] });
      const t0 = Date.now();
      for (let i = 0; i < frames; i++) {
        await seek(START + i / FPS);
        const buf = await page.screenshot({ type: "jpeg", quality: Number(process.env.JPEGQ || 95) });
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
        if (i % 150 === 0) console.log(`frame ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      ff.stdin.end();
      await new Promise((r) => ff.on("close", r));
      console.log("wrote", out, `${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    const missing = await page.evaluate(() => window.FILM.misses());
    if (missing.length) console.error("fixture misses:", [...new Set(missing)].join(" | "));
  } finally {
    await f.close();
  }
}

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("close", (c) => (c === 0 ? ok() : fail(new Error(`${cmd} exited ${c}`))));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
