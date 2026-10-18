/**
 * The app page's API: every request to /api/... is answered here, in the page, from the answers recorded on a local
 * seeded stack (fixtures/recorded.json, tools/record-fixtures.mjs) with a scenario's own answers on top
 * (src/app/scenarios.ts). Nothing leaves the page. A request with no answer is logged (`__video.misses`) and gets a
 * 404, so a missing fixture shows up in the render log rather than as a silently different screen.
 */
import { at, CONFIG, nowMs, pending } from "./virtualTime";
import { answered, served } from "./media";

/** How long (virtual ms) an answer takes, by "METHOD /path" prefix: a fix that "thinks" for a moment, as it would. */
function delayFor(key: string): number {
  const d = (CONFIG as { delays?: Record<string, number> }).delays ?? {};
  for (const [k, ms] of Object.entries(d)) if (key.startsWith(k)) return ms;
  return 0;
}

/** An answer: JSON `body`, plain `text`, or the bytes of a file the render server has (`fetchUrl`, e.g. a voice clip). */
export type Reply = { status?: number; body?: unknown; delay?: number; text?: string; fetchUrl?: string; headers?: Record<string, string>; label?: string };
export type Request = { method: string; path: string; query: URLSearchParams; body: unknown; key: string };
export type Handler = Reply | Reply[] | ((req: Request) => Reply | undefined);

type Recorded = Record<string, { status: number; body: unknown; type?: string } | { status: number; body: unknown }[]>;

const routes: Array<{ match: (key: string) => boolean; handler: Handler; seen: number }> = [];
let recorded: Recorded = {};
export const misses: string[] = [];
export const log: Array<{ t: number; key: string; status: number }> = [];

export function useRecorded(r: Recorded): void {
  recorded = r;
}

/** Answer `pattern` ("GET /v1/linkedin", "POST /v1/jobs/tracker/*", or a RegExp on "METHOD /path?query"). */
export function route(pattern: string | RegExp, handler: Handler): void {
  const match =
    typeof pattern === "string"
      ? pattern.includes("*")
        ? ((re: RegExp) => (k: string) => re.test(k))(new RegExp(`^${pattern.replace(/[.?+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^?]*")}(\\?.*)?$`))
        : (k: string) => k === pattern || k.split("?")[0] === pattern
      : (k: string) => pattern.test(k);
  routes.unshift({ match, handler, seen: 0 });
}

function fromRecorded(key: string, n: number): Reply | undefined {
  const exact = recorded[key] ?? recorded[key.split("?")[0] as string];
  const hit = exact ?? Object.entries(recorded).find(([k]) => k.split("?")[0] === key.split("?")[0])?.[1];
  if (!hit) return undefined;
  if (Array.isArray(hit)) return hit[Math.min(n, hit.length - 1)];
  return hit;
}

const sequence = new Map<string, number>();

// ── A recorded flow (tools/record-flows.mjs): GETs by "epoch" (changes made so far), changes in order ───────────
type FlowEntry = { status: number; body: unknown; epoch: number };
let flow: Record<string, FlowEntry[]> | null = null;
let epoch = 0;
const flowCalls = new Map<string, number>();
export function useFlow(f: Record<string, unknown>, startEpoch = 0): void {
  // The account itself always comes from the patched recording (an ordinary account, not the local server's admin).
  const own = (k: string) => k.startsWith("__") || k.startsWith("GET /v1/admin") || k.startsWith("GET /v1/auth/me");
  flow = Object.fromEntries(Object.entries(f).filter(([k]) => !own(k))) as Record<string, FlowEntry[]>;
  epoch = startEpoch;
}
/** A GET answered with the newest recorded answer to a change ("GET /v1/linkedin" -> the last "POST /v1/linkedin..."):
 *  a screen shown as it ends up, where the app kept the state from its changes rather than asking again. */
function fromLatest(req: Request): Reply | undefined {
  const map = (CONFIG as { latest?: Record<string, string> }).latest ?? {};
  const spec = map[req.key] ?? map[req.key.split("?")[0] as string];
  if (!spec || !flow) return undefined;
  // "POST /v1/offers/<id>/plan []": the record the change answered with, as the list the page asks for.
  const list = spec.endsWith(" []");
  const prefix = list ? spec.slice(0, -3) : spec;
  const all = Object.entries(flow).filter(([k]) => k.startsWith(prefix)).flatMap(([, v]) => v).filter((e) => e.status < 300);
  const last = all.sort((a, b) => a.epoch - b.epoch)[all.length - 1];
  return last && list ? { ...last, body: [last.body] } : last;
}

function fromFlow(req: Request): Reply | undefined {
  if (!flow) return undefined;
  const late = fromLatest(req);
  if (late) return late;
  const bare = req.key.split("?")[0] as string;
  const list = flow[req.key] ?? flow[bare] ?? Object.entries(flow).find(([k]) => k.split("?")[0] === bare)?.[1];
  if (!list?.length) return undefined;
  if (req.method === "GET") {
    const fit = list.filter((e) => e.epoch <= epoch);
    return fit.length ? fit[fit.length - 1] : list[0];
  }
  const n = flowCalls.get(req.key) ?? 0;
  flowCalls.set(req.key, n + 1);
  epoch += 1;
  // The answer to the same request body when it was recorded (a score of the same resume), else the nth.
  const sent = JSON.stringify(req.body ?? null);
  const same = (list as Array<FlowEntry & { sent?: unknown }>).filter((e) => JSON.stringify(e.sent ?? null) === sent);
  if (same.length) return same[same.length - 1];
  // Else the recorded request most like this one (the same resume a word or an id apart), by shared words.
  const words = (x: string) => new Set(x.toLowerCase().match(/[a-z0-9%]{3,}/g) ?? []);
  const mine = words(sent);
  let best: FlowEntry | null = null;
  let score = -1;
  for (const e of list as Array<FlowEntry & { sent?: unknown }>) {
    const theirs = words(JSON.stringify(e.sent ?? null));
    let both = 0;
    for (const w of mine) if (theirs.has(w)) both++;
    const j = both / Math.max(1, mine.size + theirs.size - both);
    if (j > score) {
      score = j;
      best = e;
    }
  }
  if (best && score > 0.6 && list.length > 1) return best;
  return list[Math.min(n, list.length - 1)];
}

function answer(req: Request): Reply {
  for (const r of routes) {
    if (!r.match(req.key)) continue;
    const h = r.handler;
    const n = r.seen++;
    const out = typeof h === "function" ? h(req) : Array.isArray(h) ? h[Math.min(n, h.length - 1)] : h;
    if (out) return out;
  }
  const f = fromFlow(req);
  if (f) return f;
  const n = sequence.get(req.key) ?? 0;
  sequence.set(req.key, n + 1);
  const rec = fromRecorded(req.key, n);
  if (rec) return rec;
  misses.push(req.key);
  console.warn("[fixture-miss]", req.key);
  return { status: 404, body: { detail: "Not in the video fixtures" } };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return pending(realFetch(input, init));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const path = url.pathname.slice(4);
  let body: unknown = undefined;
  const raw = init?.body;
  if (typeof raw === "string") {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  } else if (raw instanceof FormData) body = Object.fromEntries([...raw.keys()].map((k) => [k, String(raw.get(k))]));
  const key = `${method} ${path}${url.search}`;
  const reply = answer({ method, path, query: url.searchParams, body, key });
  const status = reply.status ?? 200;
  log.push({ t: nowMs(), key, status });
  const wait = reply.delay ?? delayFor(key);
  if (wait) await new Promise<void>((r) => window.setTimeout(r, wait)); // the virtual clock
  if (status === 204) return new Response(null, { status });
  if (reply.fetchUrl) {
    const file = await pending(realFetch(reply.fetchUrl));
    const bytes = await file.arrayBuffer();
    const res = new Response(bytes, { status, headers: reply.headers ?? { "content-type": "application/octet-stream" } });
    if (reply.label) answered.set(res, reply.label);
    return res;
  }
  const payload = reply.text ?? JSON.stringify(reply.body ?? null);
  return new Response(payload, { status, headers: { "content-type": reply.text ? "text/plain" : "application/json" } });
};

// ── A scene's own answers (the film's config): fixed replies, and Saba's voice from the film's clips ──────────
type VoiceClip = { text: string; file: string };
const cfg = CONFIG as { routes?: Record<string, Reply>; voiceClips?: VoiceClip[] };
for (const [key, reply] of Object.entries(cfg.routes ?? {})) route(key, reply);
if (cfg.voiceClips?.length) {
  const words = (x: string) => new Set(x.toLowerCase().match(/[a-z0-9']+/g) ?? []);
  route("POST /v1/voice/speak", (req) => {
    const said = words(String((req.body as { text?: string } | undefined)?.text ?? ""));
    let best: VoiceClip | null = null;
    let score = -1;
    for (const c of cfg.voiceClips!) {
      const theirs = words(c.text);
      let both = 0;
      for (const w of said) if (theirs.has(w)) both++;
      const j = both / Math.max(1, said.size + theirs.size - both);
      if (j > score) {
        score = j;
        best = c;
      }
    }
    const asked = String((req.body as { text?: string } | undefined)?.text ?? "");
    // Only her own lines: anything else (an acknowledgement the film has no file for) isn't available, as when the
    // voice allowance runs out, and the room goes on without it.
    if (!best || score < 0.6) {
      served.push(`-|${nowMs()}|${asked}`);
      return { status: 503, body: { detail: "Voice isn't available right now." } };
    }
    const label = `${best.file}|${Math.round(nowMs())}|${asked}`;
    served.push(label);
    return { fetchUrl: `/__vo/${best.file}`, headers: { "content-type": "audio/mpeg", "X-Orbit-Speed": "1" }, label };
  });
}

/** For scenarios: run `fn` at virtual time `ms` (re-exported so a scenario only imports this module). */
export { at };
