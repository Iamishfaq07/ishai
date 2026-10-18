// The films' voice-over, from Deepgram's Aura text-to-speech. Files only: nothing is played.
//
//   node tools/tts.mjs list                       the TTS voices Deepgram offers (no speech made)
//   node tools/tts.mjs say <script.json> <dir>    each line of the script to <dir>/<id>.wav (48 kHz mono); a line
//                                                 whose file exists with the same text and voice is kept (no call)
//
// script.json: { "voice": "aura-2-...", "lines": [ { "id": "launch-01", "text": "...", "voice"?: "..." } ] }
//
// The key: DEEPGRAM_API_KEY from the environment, else read from the Orbit API's local .env (ORBIT_ENV_FILE,
// default C:\Users\Ishfaq\Project\ishai\apps\api\.env) into this process only. It is never printed or written.
// Every call is counted in <dir>/ledger.json; MAX_CALLS (default 40) stops the script before it goes over.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

function key() {
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY;
  const file = process.env.ORBIT_ENV_FILE || "C:\\Users\\Ishfaq\\Project\\ishai\\apps\\api\\.env";
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^\s*DEEPGRAM_API_KEY\s*=/.test(l));
  const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error("no DEEPGRAM_API_KEY in the environment or the .env file");
  return value;
}

const [mode, scriptPath, outDir] = process.argv.slice(2);
const MAX = Number(process.env.MAX_CALLS || 40);

if (mode === "list") {
  const r = await fetch("https://api.deepgram.com/v1/models", { headers: { Authorization: `Token ${key()}` } });
  if (!r.ok) throw new Error(`models: ${r.status}`);
  const data = await r.json();
  for (const m of data.tts ?? []) {
    const md = m.metadata ?? {};
    console.log([m.canonical_name, m.architecture, (m.languages ?? []).join("/"), md.accent, md.age, (md.tags ?? []).join(","), (md.use_cases ?? []).join(",")].join(" | "));
  }
} else if (mode === "say") {
  const script = JSON.parse(readFileSync(scriptPath, "utf8"));
  mkdirSync(outDir, { recursive: true });
  const ledgerFile = join(outDir, "ledger.json");
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : { calls: 0, lines: {} };
  const only = (process.env.ONLY || "").split(",").filter(Boolean);
  for (const line of script.lines) {
    if (only.length && !only.includes(line.id)) continue;
    const voice = line.voice || script.voice;
    const hash = createHash("sha1").update(`${voice}\n${line.text}`).digest("hex").slice(0, 12);
    const file = join(outDir, `${line.id}.wav`);
    if (existsSync(file) && ledger.lines[line.id]?.hash === hash) {
      console.log("kept", line.id);
      continue;
    }
    if (ledger.calls >= MAX) throw new Error(`stopping: ${ledger.calls} calls made, the limit is ${MAX}`);
    const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=linear16&sample_rate=48000&container=wav`;
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Token ${key()}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: line.text }) });
    ledger.calls += 1;
    if (!r.ok) {
      writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
      throw new Error(`speak ${line.id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    ledger.lines[line.id] = { hash, voice, text: line.text, at: new Date().toISOString() };
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
    console.log("said", line.id, `(call ${ledger.calls})`);
  }
  console.log("calls so far:", ledger.calls);
} else {
  console.error("usage: node tools/tts.mjs list | say <script.json> <dir>");
  process.exit(2);
}
