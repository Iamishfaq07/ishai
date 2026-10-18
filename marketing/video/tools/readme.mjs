// Writes README.md into the deliverables folder from what tools/produce.mjs recorded (manifest.json): every file
// with its length, size and specs, what each video shows, and the suggested posts (vo/posts.json).
//
//   node tools/readme.mjs            (OUT as for produce.mjs)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = process.env.OUT || "C:\\Users\\Ishfaq\\Videos\\Orbit Launch";
const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
const posts = JSON.parse(readFileSync(join(ROOT, "vo", "posts.json"), "utf8"));
const script = JSON.parse(readFileSync(join(ROOT, "vo", "script.json"), "utf8"));
const saba = JSON.parse(readFileSync(join(ROOT, "vo", "saba.json"), "utf8"));

const ABOUT = {
  launch: "The launch film. The job search before Orbit (the tabs, the resume versions, the interview on your mind) pulled into one point; Orbit's mark; one account for the whole journey; Resume AI fixing a draft from 74 to 99; Jobs AI's matches and the tracker; Practice with an AI interviewer and its review; the job's Interview tab; the hero: a live session hearing the question and writing answer notes from the resume, key points ticking off; the same in Spanish, Hindi and Japanese; the Windows app's compact panel beside a call, then the web; LinkedIn AI, Offer AI and Learning AI; the end card.",
  cut30: "The 30-second cut: one account for the whole job search; Resume AI, Jobs AI and Practice in three beats; the live answer notes; Windows and the web; the end card.",
  cut15: "The 15-second cut: the live session from the first second (question heard, notes written from the resume), three product flashes, the end card.",
  "f-copilot": "Interview assistant: the interviewer's question streams in, Orbit marks it, the answer note streams from the resume with its key points and source line; the key points tick off as the candidate speaks; \"for interviews and calls where AI help is allowed\".",
  "f-practice": "Practice: the hook, the AI interviewer's question and a follow-up on the answer, then the round's review (Strong, what went well, to improve, practise next).",
  "f-resume": "Resume AI: the hook, the draft's ATS score (74), Fix everything with AI (to 82), the skills the job asks for confirmed by the candidate, 99 at the top.",
  "f-jobs": "Jobs AI: the hook, matches from companies' careers pages with their fit, one saved from the list, the tracker board, a job's Mission room.",
  "f-dayloop": "Interview day: Home with tomorrow's interview, the job's prep plan, the copilot set up with the job's post and resume, and the wrap-up with the thank-you email drafted.",
  "f-linkedin": "LinkedIn AI: the recruiter's-search preview, then fixes written and applied (headline, About, the current role, skills) and the score from 47 to 90.",
  "f-languages": "10 interview languages: the hook, the live session answering in Hindi, Spanish, Japanese, French and German, and the setup's interview and answer languages.",
  "f-offer": "Offer AI: the hook, an offer's monthly in-hand, where it sits against the market for the role, then the negotiation plan (the ask, the call, the email).",
  "f-learning": "Learning AI and KashSec Academy: the hook, Code AI's practice by pattern, Learning AI's KashSec card, and a short card for KashSec Academy (free, course paths, labs, interview bank, timed mock exam, kashsec.vercel.app).",
};
ABOUT.saba = "Saba takes an interview, in about 50 seconds (16:9 and 9:16) and a 15-second cut (9:16, 4:5, 1:1, 16:9). Her room is the real video interview room: her voice bars follow her voice, her words appear in the room's captions as she says them, and the candidate (camera off) answers. She acknowledges the answer, asks a follow-up on what was just said, closes the interview, and the review follows with each answer graded. The 15-second cut is the follow-up: an answer, her acknowledgement and her follow-up question. Saba's voice is Aurora (\"bright and lively\", the voice she has in the app, at the normal pace); the room played the very files heard in the mix. There is no voice or pace picker on screen.";
const POSTKEY = { launch: "launch", cut30: "cut30", cut15: "cut15", saba: "saba", saba15: "saba" };
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const sec = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const groups = {};
for (const [id, j] of Object.entries(manifest)) (groups[j.folder] ??= []).push([id, j]);

let md = `# Orbit AI: launch videos

The launch film (with a 4K master, its 30 s and 15 s cuts, upright and square versions), nine feature videos and a
video of Saba, the AI interviewer, taking an interview, for Instagram and Facebook, each with the voice-over and as music only, burned-in captions, a captions file (.srt) and a
cover picture. Made ${new Date().toISOString().slice(0, 10)} from the real Orbit web app (fictional demo data: Aditi Rao and made-up employers),
rendered frame by frame; the sources and how to make them again are in the repository at \`marketing/video/\`.

## Specs (every file)

- Picture: H.264 High profile, yuv420p, BT.709, CRF 17 (18 for 4K), \`+faststart\`. 30 fps; the 16:9 launch master is 60 fps.
- Sound: AAC-LC, 48 kHz stereo, 192 kb/s. Mastered to about -14 LUFS integrated, true peak at or under -1 dBTP
  (measured on the MP4s with ffmpeg's ebur128, below).
- Two versions of each: \`-voice\` (voice-over, music ducked under it) and \`-music-only\` (score and sound design).
  The captions are burned into both (most feeds autoplay muted) and are in the \`.srt\` beside them.
- Upright videos keep words out of the top 14% and the bottom 20%, where Instagram and Facebook put their own buttons.
- Music: an original score synthesised in code for each video (audio/score.py: no samples, no licensed music), with
  subtle synthesised interface sounds. Voice-over: Deepgram Aura-2, the "Hera" voice (${script.lines.length} lines). In the
  Saba video: Saba is "Aurora" (her voice in the app) and the candidate "Cordelia" (${saba.lines.length} lines).

`;
for (const [folder, items] of Object.entries(groups).sort()) {
  md += `## ${folder.replace(/^\d+ /, "")}\n\n`;
  const film = items[0][1].film;
  md += `${ABOUT[film] ?? ""}\n\n| File | Length | Size | Picture | Loudness |\n| --- | --- | --- | --- | --- |\n`;
  for (const [, j] of items) {
    for (const o of j.outputs) {
      const v = o.video ?? {};
      const fps = v.r_frame_rate ? eval(v.r_frame_rate).toFixed(0) : "";
      md += `| \`${relative(OUT, o.file).replace(/\\/g, "/")}\` | ${sec(o.duration)} | ${mb(o.size)} | ${v.width}x${v.height}, ${fps} fps | ${o.loudness.I} LUFS, TP ${o.loudness.TP} dBTP |\n`;
    }
  }
  const extras = items.flatMap(([, j]) => [`${j.stem}.srt`, ...(j.dpr ? [] : [`${j.stem}-cover.png`])]);
  md += `\nAlso: ${[...new Set(extras)].map((x) => `\`${folder}/${x}\``).join(", ")}.\n\n`;
  const key = POSTKEY[film] ?? film.replace(/^f-/, "");
  const p = posts.posts[key];
  if (p) {
    md += `**Instagram (India):** ${p.ig_in}\n\n**Instagram (global):** ${p.ig_global}\n\n**Facebook (India):** ${p.fb_in}\n\n**Facebook (global):** ${p.fb_global}\n\n`;
    md += `Hashtags, India: ${posts.hashtags.in}\n\nHashtags, global: ${posts.hashtags.global}\n\n`;
  }
}
md += `## Also in this folder

- \`stills/\`: six key moments of the launch film (16:9, 1080p, without captions), for a press kit or a first look.
- \`voice-over/\`: the voice-over as Deepgram made it (\`<line>.wav\`, 48 kHz) and as the films use it (\`trim/\`:
  trimmed, pauses held a little longer, long lines also cut per sentence; Saba's lines also as the MP3s her room
  plays), with \`ledger.json\` (the calls made). The
  films can be made again from these without new calls (\`VO_DIR\`, marketing/video/README.md).
- \`manifest.json\`: what produce.mjs recorded for each video (the source of the tables above).

## The voice-over, word for word

| Line | Says |
| --- | --- |
${script.lines.map((l) => `| ${l.id} | ${l.caption} |`).join("\n")}

The Saba video (Saba's lines cut as the room cuts them for her voice; "cand" is the candidate):

| Line | Says |
| --- | --- |
${saba.lines.map((l) => `| ${l.id} | ${l.caption} |`).join("\n")}

## Notes for review

- Everything on screen is the real app with fictional demo data; the AI's words in the scenes are written demo content
  (the resume fixes keep the demo person's own facts; the LinkedIn fixes, the offer plan and the thank-you note are
  examples), replayed through the real app and scored by the real server code.
- The live answer notes are always described as being for interviews and calls where AI help is allowed.
- The Saba video's interview is scripted (her lines and the candidate's), played through the real room in its demo mode;
  the review is the real review screen of a seeded practice interview. Her "Mm-hmm." is one of the app's own short
  acknowledgements, which she says while her next line is on its way.
- No prices are shown. Salary figures in the Offer AI scenes are the demo person's fictional offer, in rupees.
- The Windows scene shows the web app's compact panel in a window frame drawn for the film, beside a drawn video call
  (initials only, no faces).
`;
writeFileSync(join(OUT, "README.md"), md, "utf8");
const total = (dir) => readdirSync(dir).reduce((s, f) => {
  const p = join(dir, f);
  return s + (statSync(p).isDirectory() ? total(p) : statSync(p).size);
}, 0);
console.log("wrote", join(OUT, "README.md"), `; folder ${(total(OUT) / 1e9).toFixed(2)} GB`);
export const _x = existsSync;
