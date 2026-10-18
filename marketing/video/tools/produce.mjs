// Makes the finished videos: for each job, the film's timing, its score (with and without the voice), the picture,
// then both MP4s, the captions file and a cover, into the deliverables folder, and a manifest for the README.
//
//   node tools/produce.mjs <job> [<job> ...]     a job from JOBS below (`all` for every one, `launch` for its group)
//   env: OUT (default C:\Users\Ishfaq\Videos\Orbit Launch), WORK (default %TEMP%\orbit-video), SKIP_VIDEO=1 (sound
//   only, the picture already rendered), REUSE_AUDIO=1 (the picture only: the job's score already made, as when only
//   the captions changed), COVERS_ONLY=1, VO_DIR (the voice-over files: tools/tts.mjs, tools/vo.py;
//   default WORK\vo), PY (python with numpy and scipy), FFMPEG
//
// Picture: H.264 High, yuv420p, CRF 17, BT.709, +faststart. Sound: AAC-LC 48 kHz stereo 192 kb/s, mastered to about
// -14 LUFS with true peaks at or under -1 dBTP (audio/score.py); checked again here with ffmpeg's ebur128 on the MP4.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = process.env.OUT || "C:\\Users\\Ishfaq\\Videos\\Orbit Launch";
const WORK = process.env.WORK || join(process.env.TEMP || "C:\\Users\\Ishfaq\\AppData\\Local\\Temp", "orbit-video");
const PY = process.env.PY || "C:\\Users\\Ishfaq\\AppData\\Local\\Python\\bin\\python.exe";
const FFMPEG = process.env.FFMPEG || "ffmpeg";

// id: [film, format, folder, file stem, options]
const FEATURES = ["copilot", "practice", "resume", "jobs", "dayloop", "linkedin", "languages", "offer", "learning"];
const KEYS = { copilot: 0, practice: 2, resume: -2, jobs: 3, dayloop: 0, linkedin: 5, languages: -5, offer: -4, learning: 2 };
export const JOBS = {
  "launch-16x9": { film: "launch", fmt: "16x9", folder: "01 Launch film", stem: "Orbit-launch-film-16x9-1080p60", fps: 60 },
  "launch-16x9-4k": { film: "launch", fmt: "16x9", folder: "01 Launch film", stem: "Orbit-launch-film-16x9-4K", fps: 30, dpr: 2, reuseAudio: "launch-16x9" },
  "launch-9x16": { film: "launch", fmt: "9x16", folder: "01 Launch film", stem: "Orbit-launch-film-9x16", fps: 30 },
  "launch-1x1": { film: "launch", fmt: "1x1", folder: "01 Launch film", stem: "Orbit-launch-film-1x1", fps: 30 },
  "c30-16x9": { film: "cut30", fmt: "16x9", folder: "02 Launch 30s", stem: "Orbit-launch-30s-16x9", fps: 30 },
  "c30-9x16": { film: "cut30", fmt: "9x16", folder: "02 Launch 30s", stem: "Orbit-launch-30s-9x16", fps: 30 },
  "c30-1x1": { film: "cut30", fmt: "1x1", folder: "02 Launch 30s", stem: "Orbit-launch-30s-1x1", fps: 30 },
  "c15-16x9": { film: "cut15", fmt: "16x9", folder: "03 Launch 15s", stem: "Orbit-launch-15s-16x9", fps: 30 },
  "c15-9x16": { film: "cut15", fmt: "9x16", folder: "03 Launch 15s", stem: "Orbit-launch-15s-9x16", fps: 30 },
  ...Object.fromEntries(FEATURES.flatMap((f, i) => ["9x16", "4x5", "1x1"].map((fmt) => [
    `${f}-${fmt}`,
    { film: `f-${f}`, fmt, folder: `${String(i + 4).padStart(2, "0")} ${TITLE(f)}`, stem: `Orbit-${f}-${fmt}`, fps: 30, key: KEYS[f], style: "feature" },
  ]))),
  // Saba takes an interview (films/saba.tsx): her voice is the files the room played (vo/saba-plays.json).
  ...Object.fromEntries(["16x9", "9x16"].map((fmt) => [`saba-${fmt}`,
    { film: "saba", fmt, folder: "13 Saba AI video interview", stem: `Orbit-Saba-video-interview-${fmt}`, fps: 30, key: 1, style: "feature" }])),
  ...Object.fromEntries(["9x16", "4x5", "1x1", "16x9"].map((fmt) => [`saba15-${fmt}`,
    { film: "saba15", fmt, folder: "13 Saba AI video interview", stem: `Orbit-Saba-15s-${fmt}`, fps: 30, key: 1, style: "feature" }])),
};
function TITLE(f) {
  return { copilot: "Interview assistant", practice: "Practice", resume: "Resume AI", jobs: "Jobs AI", dayloop: "Interview day", linkedin: "LinkedIn AI", languages: "10 languages", offer: "Offer AI", learning: "Learning AI and KashSec" }[f];
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", cwd: ROOT, env: process.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${r.stderr ?? ""}`);
  return r;
}

function srtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

function loudness(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const tail = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(tail)?.[1]);
  const LRA = Number(/LRA:\s+(-?[\d.]+) LU/.exec(tail)?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail)?.[1]);
  return { I, LRA, TP };
}

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels,bit_rate", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}

/** The cover: the film's cover moment, without the caption box. */
function cover(id, j, dir, m) {
    const stills = join(WORK, "covers", id);
    process.env.NOCAP = "1";
    run("node", ["tools/render.mjs", "stills", j.film, j.fmt, stills, String(m.cover)], { quiet: true });
    delete process.env.NOCAP;
    const png = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-ChildItem '${stills}' -Filter *.png | Sort-Object LastWriteTime | Select-Object -Last 1).FullName`], { encoding: "utf8" }).trim();
    copyFileSync(png, join(dir, `${j.stem}-cover.png`));
}

function produce(id) {
  const j = JOBS[id];
  if (!j) throw new Error(`no job ${id}`);
  const dir = join(OUT, j.folder);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(WORK, "meta"), { recursive: true });
  mkdirSync(join(WORK, "audio"), { recursive: true });
  mkdirSync(join(WORK, "renders"), { recursive: true });
  const meta = join(WORK, "meta", `${id}.json`);
  console.log(`\n== ${id}: ${j.film} ${j.fmt}`);
  run("node", ["tools/render.mjs", "meta", j.film, j.fmt, meta], { quiet: true });
  if (process.env.COVERS_ONLY === "1") return cover(id, j, dir, JSON.parse(readFileSync(meta, "utf8")));
  const audioName = j.reuseAudio || id;
  const made = ["vo", "music"].every((k) => existsSync(join(WORK, "audio", `${audioName}-${k}.wav`)));
  if (!j.reuseAudio && !(process.env.REUSE_AUDIO === "1" && made)) {
    run(PY, ["audio/score.py", meta, process.env.VO_DIR || join(WORK, "vo"), join(WORK, "audio"), "--name", id, "--key", String(j.key ?? 0), "--style", j.style ?? "launch"]);
  }
  const picture = join(WORK, "renders", `${id}.mp4`);
  if (!process.env.SKIP_VIDEO || !existsSync(picture)) {
    process.env.FPS = String(j.fps ?? 30);
    process.env.DPR = String(j.dpr ?? 1);
    process.env.CRF = j.dpr ? "18" : "17";
    process.env.PRESET = "slow";
    run("node", ["tools/render.mjs", "video", j.film, j.fmt, picture]);
    delete process.env.DPR;
  }
  const outputs = [];
  for (const [kind, suffix] of [["vo", "voice"], ["music", "music-only"]]) {
    const wav = join(WORK, "audio", `${audioName}-${kind}.wav`);
    const mp4 = join(dir, `${j.stem}-${suffix}.mp4`);
    // AAC can overshoot the WAV's true peak by a dB or more: limit a little lower each time until the MP4 is at or
    // under -1 dBTP (the loudness barely moves; only the highest peaks are caught).
    let l;
    for (const ceiling of [null, -3.0, -4.0, -5.0, -6.5]) {
      run(FFMPEG, ["-y", "-loglevel", "error", "-i", picture, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
        ...(ceiling === null ? [] : ["-af", `aresample=192000,alimiter=limit=${Math.pow(10, ceiling / 20).toFixed(4)}:attack=2:release=60:level=disabled,aresample=48000`]),
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-shortest", "-movflags", "+faststart", "-metadata", `title=Orbit AI · ${j.folder.replace(/^\d+ /, "")}`, "-metadata", "artist=Orbit (orbitanswer.com)", mp4]);
      l = loudness(mp4);
      if (l.TP <= -1.05) break;
    }
    const p = probe(mp4);
    outputs.push({ file: mp4, kind: suffix, loudness: l, size: statSync(mp4).size, duration: Number(p.format.duration), video: p.streams.find((s) => s.codec_name === "h264"), audio: p.streams.find((s) => s.codec_name === "aac") });
    console.log(`${suffix}: ${l.I} LUFS, true peak ${l.TP} dBFS, ${(statSync(mp4).size / 1e6).toFixed(1)} MB`);
  }
  // captions (the same words are burned in), and a cover
  const m = JSON.parse(readFileSync(meta, "utf8"));
  const srt = m.captions.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join("\n");
  writeFileSync(join(dir, `${j.stem}.srt`), srt, "utf8");
  if (!j.dpr) cover(id, j, dir, m);
  const manifest = join(OUT, "manifest.json");
  const all = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};
  all[id] = { ...j, cover: m.cover, duration: m.duration, captions: m.captions.length, vo: m.vo.map((v) => v.id), outputs, at: new Date().toISOString() };
  writeFileSync(manifest, JSON.stringify(all, null, 1));
}

const want = process.argv.slice(2);
const ids = want.flatMap((w) => (w === "all" ? Object.keys(JOBS) : JOBS[w] ? [w] : Object.keys(JOBS).filter((k) => k.startsWith(`${w}-`))));
if (!ids.length) {
  console.error("usage: node tools/produce.mjs <job|group|all> ...\njobs:", Object.keys(JOBS).join(" "));
  process.exit(2);
}
for (const id of ids) produce(id);
