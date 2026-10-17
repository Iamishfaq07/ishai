// Captures Orbit's real screens, signed in as the demo person from seed.py, on a LOCAL stack (never production).
//
//   node marketing/screens/capture.mjs --web http://localhost:5186 --api http://localhost:8023            # screens
//   node marketing/screens/capture.mjs --store                                                            # MS Store
//   node marketing/screens/capture.mjs --webp                                                             # site copies
//   options: --only copilot,jobs   --themes light,dark   --chrome-path <exe>   --playwright <path to playwright-core>
//
// Screens (marketing/screens/src/<name>-<theme>.png, viewport 1280x800 at 2x = 2560x1600):
//   copilot, copilot-streaming  the live session (/live/:id) with a question and an answer from the resume
//   practice                    a finished mock interview's review (/sessions/:id)
//   resume                      the Resume AI editor with the demo resume and its ATS score
//   jobs                        Jobs AI matches with fit scores
//   mission                     the Mission room of the application with an interview coming up
//   tracker                     the application tracker's board
// The live session's words come from this script, not the server: the local API runs the mock AI, whose answers say
// "[mock]". It proxies the page's live WebSocket to the real local server (page.routeWebSocket) and adds its own
// server → client events (transcript, the detected question, the answer), exactly as docs/PROTOCOL.md describes
// them, so the page renders them with its real components. It also reports the speech and AI providers as "ok"
// instead of "mock" (which would show a developer-only row) and stands in for the shared tab's audio (headless
// Chrome has no tab to share). Admin-only links and the floating support button are hidden: a demo account that
// happens to be the local server's first user is its admin.
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const WEB = opt("web", "http://localhost:5186");
const API = opt("api", "http://localhost:8023");
if (/orbitanswer\.com/i.test(WEB + API)) throw new Error("local stacks only: never point this at production");
// Playwright from the repo (the root devDependency @playwright/test brings chromium); --playwright overrides.
const PW = opt("playwright", "@playwright/test");
// A path (./x, /x, C:/x, or with a backslash) is a file; anything else is a package name.
const { chromium } = await import(/^(\.|\/|[A-Za-z]:)|\\/.test(PW) ? pathToFileURL(resolve(PW)).href : PW);
const STATE = JSON.parse(readFileSync(join(HERE, ".seed-state.json"), "utf8"));
const only = opt("only", "")?.split(",").filter(Boolean) ?? [];
const want = (n) => !only.length || only.includes(n);
const launchOpts = { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] };
if (opt("chrome-path")) launchOpts.executablePath = opt("chrome-path");
else launchOpts.channel = "chrome";

// ─── What the live session shows ────────────────────────────────────────────────────────────────────────────────
const QUESTION = "Can you walk me through an A/B test you designed, and what you'd do differently next time?";
const ANSWER_TEXT =
  "Sure. At Juniper Logistics we wanted to know whether showing a delivery window instead of a single date would " +
  "cut cancellations. I made cancellation rate the main metric, kept conversion as a guardrail, and ran it for two " +
  "weeks, split by city. The window cut cancellations by about 6% with no drop in conversion, so it shipped to every " +
  "user. Next time I'd run it a week longer to rule out a novelty effect.";
const ANSWER = {
  question: QUESTION,
  type: "behavioral",
  direct_answer: ANSWER_TEXT,
  talking_points: [],
  example: null,
  code: null,
  time_complexity: null,
  space_complexity: null,
  follow_up: "How did you choose the sample size?",
  context_used: ["resume: Juniper Logistics — Senior Data Analyst"],
  grounding: "verified",
  sources: [{
    ref: "F2", chunk_id: "demo-2", doc_kind: "resume", document: "Aditi Rao resume", label: "Juniper Logistics · A/B tests",
    excerpt: "Designed and analysed 14 A/B tests on the booking flow with the product team; 5 shipped to all users.", verified: true,
  }],
  key_points: ["Delivery window test", "Cancellation metric, conversion guardrail", "6% fewer cancellations", "Run it longer next time"],
};
const TURNS = [
  ["t1", "interviewer", "Thanks for making time today. I had a look at your resume before the call."],
  ["t2", "candidate", "Thank you, happy to be here."],
  ["t3", "interviewer", "Let's start with experiments. " + QUESTION],
];
const SAID = "Sure. At Juniper Logistics we ran a test: would showing a delivery window instead of a single date cut cancellations? I made cancellation rate the main metric and kept conversion as a guardrail.";

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
const HIDE_CSS = `
  a[href="/admin/users"], a[href^="/admin/users?"], button[aria-label="Chat with support"], button[aria-label^="Support chat"] { display: none !important; }
`;
async function newContext(browser, { theme, width, height, scale }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme, reducedMotion: "reduce",
    // UTC, as the server counts days ("in 2 days"), so the page and the server agree on what "tomorrow" is.
    timezoneId: "UTC", locale: "en-US", permissions: ["microphone"],
  });
  await ctx.addInitScript(({ theme, css }) => {
    localStorage.setItem("orbit.cookies.v1", "1");
    localStorage.setItem("orbit.theme", theme);
    localStorage.setItem("orbit.liveSettingsOpen", "closed");
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "off" }));
    const style = () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) style(); else document.addEventListener("DOMContentLoaded", style);
    // The "shared tab": a quiet tone, so the page hears an interviewer. Headless Chrome has no tab to pick.
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        gain.gain.value = 0.08;
        osc.connect(gain);
        const dest = ac.createMediaStreamDestination();
        gain.connect(dest);
        osc.start();
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const video = canvas.captureStream(1).getVideoTracks()[0];
        video.getSettings = () => ({ displaySurface: "browser" });
        return new MediaStream([video, ...dest.stream.getAudioTracks()]);
      };
    }
  }, { theme, css: HIDE_CSS });
  const login = await ctx.request.post(`${API}/v1/auth/login`, { headers: { Origin: WEB }, data: { email: STATE.email, password: STATE.password } });
  if (!login.ok()) throw new Error(`sign-in failed: ${login.status()} ${await login.text()}`);
  ctx.csrf = (await login.json()).user.csrf_token;
  return ctx;
}

/** Waits for the page to draw. A dev server mid-edit can serve a broken module once: then it reloads (3 tries). */
async function settle(page, ms = 900) {
  for (let i = 0; i < 3; i++) {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const drawn = await page.evaluate(() => (document.querySelector("#root")?.textContent?.length ?? 0) > 80).catch(() => false);
    if (drawn) break;
    await page.waitForTimeout(3000);
    await page.reload().catch(() => undefined);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function shoot(page, file) {
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  console.log("wrote", file);
}

/** The live session page with a scripted interview: returns once the answer is complete. */
async function liveSession(ctx, page, files) {
  const created = await ctx.request.post(`${API}/v1/sessions`, {
    headers: { Origin: WEB, "X-CSRF-Token": ctx.csrf },
    data: { title: "Kestrel Pay: hiring manager round", type: "interview", role: "Product Analyst", company: "Kestrel Pay", document_ids: [STATE.document_id] },
  });
  if (!created.ok()) throw new Error(`session: ${created.status()} ${await created.text()}`);
  const sid = (await created.json()).id;
  let ws = null;
  await page.routeWebSocket(/\/v1\/sessions\/[^/]+\/live/, (route) => {
    ws = route;
    const server = route.connectToServer();
    route.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      try {
        const e = JSON.parse(m);
        if (e.type === "provider.status" && e.data?.state === "mock") e.data = { ...e.data, state: "ok", name: e.data.provider === "stt" ? "speech" : "ai" };
        route.send(JSON.stringify(e));
      } catch {
        route.send(m);
      }
    });
  });
  await page.goto(`${WEB}/`);
  await page.evaluate((id) => history.replaceState({ usr: { systemAudio: true }, key: "demo", idx: 0 }, "", `/live/${id}`), sid);
  await page.reload();
  await settle(page, 2500);
  const share = page.getByRole("button", { name: "Share tab audio" });
  if (await share.count()) await share.first().click();
  await page.waitForTimeout(1500);
  // The DefenseWorkspace disclosure is for system-design sessions; this is an analyst interview.
  await page.evaluate(() => {
    for (const s of document.querySelectorAll("summary")) if (s.textContent?.includes("Critique architecture")) s.closest("details")?.style.setProperty("display", "none");
  });
  // Twelve minutes into the call.
  await page.clock.setSystemTime(new Date(Date.now() + (12 * 60 + 38) * 1000)).catch(() => undefined);
  const send = (type, data) => ws.send(JSON.stringify({ v: 1, type, ts: Date.now(), data }));
  let ms = 4000;
  for (const [id, speaker, text] of TURNS) {
    send("transcript.final", { turn_id: id, speaker, text, start_ms: ms, end_ms: ms + text.split(" ").length * 330 });
    ms += text.split(" ").length * 330 + 900;
  }
  send("question.detected", { question_id: "q1", turn_id: "t3", text: QUESTION, type: "behavioral", confidence: 0.96, is_follow_up: false });
  send("state.changed", { state: "generating" });
  send("answer.started", { answer_id: "a1", question_id: "q1", length: "standard", size: "medium", reasoning: "light", source: "auto" });
  await page.waitForTimeout(300);
  send("state.changed", { state: "streaming" });
  const words = ANSWER_TEXT.split(" ");
  const half = { ...ANSWER, direct_answer: words.slice(0, Math.round(words.length * 0.48)).join(" "), key_points: [], sources: [], follow_up: null };
  send("answer.chunk", { answer_id: "a1", partial: half });
  await page.waitForTimeout(1200);
  if (files.streaming) await shoot(page, files.streaming);
  send("answer.chunk", { answer_id: "a1", partial: ANSWER });
  send("answer.completed", { answer_id: "a1", answer: ANSWER, latency: { first_token_ms: 640, total_ms: 2100 } });
  send("state.changed", { state: "answer_complete" });
  // The candidate starts answering: the key points tick off as they're said.
  send("transcript.partial", { turn_id: "t4", speaker: "candidate", text: SAID });
  await page.waitForTimeout(1600);
  if (files.done) await shoot(page, files.done);
  await ctx.request.post(`${API}/v1/sessions/${sid}/end`, { headers: { Origin: WEB, "X-CSRF-Token": ctx.csrf } }).catch(() => undefined);
}

async function screen(page, name, file) {
  const at = {
    practice: `/sessions/${STATE.mock_session_id}`,
    resume: `/resume-ai/${STATE.resume_id}`,
    jobs: "/jobs/matches",
    mission: `/jobs/mission/${STATE.tracker["Kestrel Pay"]}`,
    tracker: "/jobs/tracker",
  }[name];
  await page.goto(WEB + at);
  await settle(page);
  if (name === "mission") {
    await page.getByRole("tab", { name: "Prep plan" }).or(page.getByRole("button", { name: "Prep plan" })).first().click().catch(() => undefined);
    await settle(page, 600);
  }
  if (name === "tracker") {
    // The board, with the numbers above it just out of view.
    await page.evaluate(() => {
      const col = [...document.querySelectorAll("span,p,h2,h3")].find((e) => e.textContent?.trim() === "Saved");
      const top = col ? col.getBoundingClientRect().top + window.scrollY - 92 : 600;
      (document.scrollingElement ?? document.documentElement).scrollTo(0, top);
      document.querySelector("main")?.scrollTo?.(0, top);
    });
    await page.waitForTimeout(500);
  }
  await shoot(page, file);
}

async function captureSet({ themes, width, height, scale, outFor, names }) {
  const browser = await chromium.launch(launchOpts);
  try {
    for (const theme of themes) {
      const ctx = await newContext(browser, { theme, width, height, scale });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log("page error:", e.message.slice(0, 160)));
      if (names.includes("copilot")) {
        await liveSession(ctx, page, { done: outFor("copilot", theme), streaming: names.includes("copilot-streaming") ? outFor("copilot-streaming", theme) : null });
        await page.unrouteAll?.({ behavior: "ignoreErrors" }).catch(() => undefined);
      }
      const p2 = await ctx.newPage();
      for (const n of names.filter((x) => !x.startsWith("copilot"))) await screen(p2, n, outFor(n, theme));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

/** PNG → WebP in headless Chrome (canvas.toBlob), scaled to `w` x `h`. */
async function toWebp(files, w, h, quality) {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  for (const [src, dest] of files) {
    const data = readFileSync(src).toString("base64");
    const b64 = await page.evaluate(async ({ data, w, h, quality }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, "image/webp", quality));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, { data, w, h, quality });
    mkdirSync(dirname(dest), { recursive: true });
    const { writeFileSync, statSync } = await import("node:fs");
    writeFileSync(dest, Buffer.from(b64, "base64"));
    console.log("wrote", dest, Math.round(statSync(dest).size / 1024), "KB");
  }
  await browser.close();
}

const SCREENS = ["copilot", "copilot-streaming", "practice", "resume", "jobs", "mission", "tracker"];
const STORE = [["01", "copilot"], ["02", "practice"], ["03", "resume"], ["04", "jobs"], ["05", "mission"]];
const themes = opt("themes", "light,dark").split(",");
// The website shows these five (apps/web/src/marketing/ProductShot.tsx); the others are for the ads.
const SITE = ["copilot", "practice", "resume", "jobs", "mission"];

if (flag("webp")) {
  const files = [];
  for (const n of SITE) for (const t of ["light", "dark"]) {
    const src = join(HERE, "src", `${n}-${t}.png`);
    if (existsSync(src) && want(n)) files.push([src, join(HERE, "..", "..", "apps", "web", "src", "marketing", "shots", `${n}-${t}.webp`)]);
  }
  await toWebp(files, 1600, 1000, Number(opt("quality", "0.8")));
} else if (flag("store")) {
  const out = join(HERE, "..", "store");
  for (const [w, h, scale] of [[1366, 768, 1], [1280, 720, 2]]) {
    const names = STORE.map(([, n]) => n).filter(want);
    await captureSet({
      themes: opt("themes", "light").split(","), width: w, height: h, scale, names,
      outFor: (n, theme) => {
        const nn = STORE.find(([, x]) => x === n)?.[0];
        return nn ? join(out, `${nn}-${n}-${w * scale}x${h * scale}${theme === "light" ? "" : `-${theme}`}.png`) : null;
      },
    });
  }
} else {
  await captureSet({ themes, width: 1280, height: 800, scale: 2, names: SCREENS.filter(want), outFor: (n, t) => join(HERE, "src", `${n}-${t}.png`) });
}
