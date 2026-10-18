import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8000";

/** A second and a half of something voice-like (a buzz in syllables), 16 kHz mono WAV: Saba's natural voice here. */
function voiceClip(seconds = 2.5): Buffer {
  const rate = 16000;
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syllable = Math.max(0, Math.sin(Math.PI * ((t * 4.5) % 1))); // ~4.5 syllables a second
    const quiet = t < 0.1 || t > seconds - 0.1 ? 0 : 1;
    const buzz = ((t * 150) % 1) * 2 - 1 + 0.5 * (((t * 300) % 1) * 2 - 1);
    b.writeInt16LE(Math.round(buzz * syllable * quiet * 6000), 44 + i * 2);
  }
  return b;
}

/**
 * The page's sound, without a real microphone or speakers: speechSynthesis is a silent stand-in (the OS engine plays
 * past the browser's mute), every <audio> is noted with its own output level (captureStream), the microphone is a
 * synthetic stream that's silent until the test "talks" (window.__talk: syllables with dips between them, as real
 * speech has; D76), and the mic audio the page sends the server is counted (window.__frames).
 */
async function fakeAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    const synth = {
      speaking: false, pending: false, paused: false, onvoiceschanged: null,
      getVoices: () => [],
      speak: (u: SpeechSynthesisUtterance) => {
        setTimeout(() => u.onstart?.(new Event("start") as SpeechSynthesisEvent), 30);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 600);
      },
      cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
    const w = window as unknown as Record<string, unknown>;
    const plays: Array<{ el: HTMLAudioElement; level: () => number }> = [];
    w.__plays = plays;
    let probe: AudioContext | null = null;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: []) {
      if (this instanceof HTMLAudioElement) {
        const el = this;
        let analyser: AnalyserNode | null = null;
        try {
          probe ??= new AudioContext();
          const stream = (el as unknown as { captureStream: () => MediaStream }).captureStream();
          const tap = () => {
            if (analyser || !stream.getAudioTracks().length) return;
            analyser = probe!.createAnalyser();
            probe!.createMediaStreamSource(stream).connect(analyser);
          };
          tap();
          stream.addEventListener("addtrack", tap);
        } catch {
          // no captureStream: the element's progress is still checked
        }
        const buf = new Float32Array(2048);
        plays.push({
          el,
          level: () => {
            if (!analyser) return -1;
            analyser.getFloatTimeDomainData(buf);
            let s = 0;
            for (const v of buf) s += v * v;
            return Math.sqrt(s / buf.length);
          },
        });
      }
      return play.apply(this, args);
    };
    // The mic audio sent to the server (binary frames on the live socket).
    w.__frames = 0;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data !== "string") (w.__frames as number)++;
      return send.call(this, data);
    };
    w.__playing = () => {
      const p = plays[plays.length - 1];
      return p ? { playing: !p.el.paused && !p.el.ended && p.el.currentTime > 0, t: p.el.currentTime, level: p.level() } : null;
    };
    // The microphone: silence, or a voice (a buzz) when the test talks.
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (!c?.audio || c.video) return gum ? gum(c) : Promise.reject(new DOMException("no camera", "NotFoundError"));
        const ctx = new AudioContext();
        void ctx.resume();
        const out = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 140;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(out);
        osc.start();
        // Talking: ~140 ms syllables with ~80 ms dips (a steady buzz passed where a real voice didn't stop her).
        let timer = 0;
        w.__talk = (on: boolean) => {
          window.clearTimeout(timer);
          if (!on) return gain.gain.setValueAtTime(0, ctx.currentTime);
          const syllable = (up: boolean) => {
            gain.gain.setValueAtTime(up ? 0.3 : 0.004, ctx.currentTime);
            timer = window.setTimeout(() => syllable(!up), up ? 140 : 80);
          };
          syllable(true);
        };
        return out.stream;
      };
    }
  });
}

/** A video session; her voice takes `speakDelay` ms to come (the natural voice's request). */
async function videoSession(context: BrowserContext, page: Page, speakDelay = 300): Promise<string> {
  const auth = { email: "qa-admin@example.com", password: "correct horse battery" };
  const r = await context.request.post(`${API}/v1/auth/register`, { data: { ...auth, name: "Priya Sharma" } });
  if (r.status() !== 201) expect((await context.request.post(`${API}/v1/auth/login`, { data: auth })).status()).toBe(200);
  const created = await context.request.post(`${API}/v1/sessions`, {
    data: { title: "Video interview: SQL", type: "mock", mock: { video: true, topic: "SQL and databases", duration_minutes: 10 } },
  });
  expect(created.status(), await created.text()).toBe(201);
  // The natural voice, answered with the clip above (the server's mock providers have no voice).
  const clip = voiceClip();
  await page.route(`${API}/v1/voice`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { available: true, voices: [{ id: "vesta", label: "Test voice", model: "test" }], default_voice: "vesta", chars_left: null } })
      : route.continue(),
  );
  await page.route(`${API}/v1/voice/speak`, async (route) => {
    await new Promise((res) => setTimeout(res, speakDelay));
    await route.fulfill({ status: 200, contentType: "audio/wav", body: clip, headers: { "X-Orbit-Speed": "1" } });
  });
  return (await created.json()).id as string;
}

type Sample = { ms: number; playing: boolean; t: number; level: number; words: number; label: string; frames: number };

async function sample(page: Page, ms: number): Promise<Sample[]> {
  return page.evaluate(async (duration) => {
    const w = window as unknown as { __playing: () => { playing: boolean; t: number; level: number } | null; __frames: number };
    const out: Array<{ ms: number; playing: boolean; t: number; level: number; words: number; label: string; frames: number }> = [];
    const t0 = performance.now();
    while (performance.now() - t0 < duration) {
      const p = w.__playing();
      const cap = document.querySelector("[data-caption]")?.textContent?.replace(/…/g, "").trim() ?? "";
      out.push({
        ms: Math.round(performance.now() - t0), playing: Boolean(p?.playing), t: p?.t ?? 0, level: p?.level ?? -1,
        words: cap ? cap.split(/\s+/).length : 0,
        label: document.querySelector("[data-mood-label]")?.textContent?.trim() ?? "",
        frames: w.__frames,
      });
      await new Promise((r) => setTimeout(r, 80));
    }
    return out;
  }, ms);
}

// Saba is heard (her clip plays and carries sound), and her words appear as she says them, never before (D76).
test("Saba's voice plays and her words appear as she says them", async ({ page, context }) => {
  test.setTimeout(60_000);
  await fakeAudio(context);
  // Her first line takes 1.5 s to come, so the mic (which starts up to a second in) is streaming while she prepares.
  const id = await videoSession(context, page, 1500);
  await page.goto(`/live/${id}`);
  const rows = await sample(page, 7000);
  const first = rows.findIndex((r) => r.playing);
  expect(first, JSON.stringify(rows.slice(0, 20))).toBeGreaterThan(-1);
  // It plays: the clip moves on, and its output carries sound.
  const played = rows.filter((r) => r.playing);
  expect(Math.max(...played.map((r) => r.t)) - played[0]!.t).toBeGreaterThan(0.8);
  expect(Math.max(...played.map((r) => r.level))).toBeGreaterThan(0.01);
  // Nothing of her line before she's heard; then more of it as she goes.
  expect(rows.slice(0, first).every((r) => r.words === 0)).toBe(true);
  const shown = played.map((r) => r.words);
  expect(Math.max(...shown)).toBeGreaterThan(shown.find((n) => n > 0) ?? 0);
  // The mic goes to the server while her voice is on its way (D76: the candidate's last words were lost then), and
  // is held back while she can be heard.
  const preparing = rows.filter((r) => /about to speak/.test(r.label));
  const streaming = preparing.filter((r) => r.frames > 0);
  expect(streaming.length, JSON.stringify(preparing)).toBeGreaterThanOrEqual(2);
  expect(streaming.at(-1)!.frames, JSON.stringify(preparing)).toBeGreaterThan(streaming[0]!.frames);
  const speaking = played.slice(2, -2);
  if (speaking.length >= 3) expect(speaking.at(-1)!.frames - speaking[0]!.frames).toBeLessThanOrEqual(1);
  await context.request.post(`${API}/v1/sessions/${id}/end`);
});

// Talking over her stops her at once; then she carries on, and "can you repeat that?" gets the question again.
test("talking over Saba stops her, and asking her to repeat works", async ({ page, context }) => {
  test.setTimeout(90_000);
  await fakeAudio(context);
  const id = await videoSession(context, page);
  await page.goto(`/live/${id}`);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __playing: () => { t: number } | null }).__playing()))?.t ?? 0,
    { timeout: 20_000 }).toBeGreaterThan(0.5);
  await page.evaluate(() => (window as unknown as { __talk: (on: boolean) => void }).__talk(true));
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __playing: () => { playing: boolean } | null }).__playing()))?.playing,
    { timeout: 2_000 }).toBe(false);
  await expect(page.locator("[data-mood-label]")).not.toContainText("speaking");
  await page.evaluate(() => (window as unknown as { __talk: (on: boolean) => void }).__talk(false));
  // Her small talk answered (the server's scripted speech-to-text), she gives the plan and the first question…
  await page.waitForFunction(() => typeof (window as unknown as { __orbitDevSimulate?: unknown }).__orbitDevSimulate === "function");
  await page.evaluate(() => (window as unknown as { __orbitDevSimulate: (f: string) => void }).__orbitDevSimulate("saba_smalltalk"));
  const log = page.getByRole("log", { name: "Interview transcript" });
  await expect(log).toContainText("introduce yourself", { timeout: 30_000 });
  // …and repeats it when asked.
  await page.evaluate(() => (window as unknown as { __orbitDevSimulate: (f: string) => void }).__orbitDevSimulate("saba_repeat"));
  await expect(log).toContainText(/(Sure|Of course)[^.]*\. Could you briefly introduce yourself/, { timeout: 30_000 });
  await context.request.post(`${API}/v1/sessions/${id}/end`);
});
