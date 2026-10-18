# Launch videos

The launch film (16:9 at 60 fps, a 4K master, 30 s and 15 s cuts, upright and square versions), nine feature
videos (9:16, 4:5, 1:1) and Saba taking an interview (about 50 s in 16:9 and 9:16, and a 15 s cut), each with a voice-over and as music only, burned-in captions, an `.srt` and a cover. The
finished files are not in git: they go to `C:\Users\Ishfaq\Videos\Orbit Launch\` (its README lists them, with post
copy for Instagram and Facebook).

Everything in the pictures is the **real web app** (`apps/web/src`), not a mock-up: each screen is an iframe of
`app.html`, which boots the app's own `App` with its providers, answered by recorded API replies and posed on a
virtual clock, so a frame always shows the same thing however long it took to draw. The people and companies are
fictional (marketing/screens/seed.py: Aditi Rao, Kestrel Pay, Juniper Logistics and the rest).

## How it fits together

| Part | What it does |
| --- | --- |
| `app.html`, `src/app/` | The app for the films. `virtualTime.ts` (imported first) replaces timers, animation frames, `Date`, `performance.now` and CSS/Web Animations with a clock the film moves (`__video.tick(ms)`); it also gives each frame its own storage and silences `speechSynthesis`. `fixtureApi.ts` answers every `/api/...` request in the page from `fixtures/` (a request with no answer is logged as a miss and gets a 404). `fakeLive.ts` is the live session's WebSocket, with the server's side played by a scene's script (docs/PROTOCOL.md events). `media.ts`: quiet stand-ins for the microphone and the shared tab. `scenarios.ts`: a frame's script (click, type, scroll, select, live events, CSS) on its clock. |
| `film.html`, `src/film/` | The films. `engine.tsx` poses everything at `t`: app frames (iframes, kept alive between frames, ticked to their own time) and the film's layer (React, drawn from `t` alone). `ui.tsx`: backdrops, kinetic type, the mark drawn on, cursor, spotlight, captions. `shots/`: the scenes (`product.tsx` the app scenes, `brand.tsx` the mark and the end card, `chaos.tsx` the opening, `kit.tsx` the camera and placement per format). `films/`: the launch film, the cuts and the feature films. `vo.ts` places voice-over lines and their timed words. |
| `fixtures/` | `recorded.json` (every screen's API replies), `flows/*.json` (what the server answered while a flow was used, by order and by "epoch", so a replay answers a page the way the server did at that point), `ids.json`, `patches.ts` (an ordinary account, not the local server's admin), `demo_llm.py` (the AI's words in the scenes, written demo content). |
| `tools/` | `record-all.sh` (re-record everything from a fresh local stack), `seed_video.py` (adds the draft resume, pay ranges, an offer, a LinkedIn profile and an ended interview to `marketing/screens/seed.py`), `demo_api.py` (the local API with its mock AI answering from `demo_llm.py`; refuses anything but a temp SQLite and mock providers), `record-fixtures.mjs`, `record-flows.mjs`, `tts.mjs` (Deepgram Aura voice-over), `vo.py` (trims the voice, finds its pauses, times the caption words: `vo/manifest.json`), `render.mjs` (stills, contact sheets, video), `produce.mjs` (everything for a video: score, picture, both MP4s, captions, cover), `peek.mjs` (one app screen, for building scenes), `readme.mjs` (the deliverables' README). |
| `audio/score.py` | The score and sound, synthesised from each film's sections and cues (no samples), the voice ducking the music, mastered to -14 LUFS / -2 dBTP in the WAV (so the AAC stays at or under -1 dBTP). `audio/analyse.py` reads a mix back: loudness by section, spectrum, clicks. |
| `vo/` | `script.json` (every line: what the voice says, and the caption), `saba.json` (the Saba film's lines: hers in Aurora, the candidate's), `saba-plays.json` (where the room really played each of her clips), `manifest.json` (timings from `tools/vo.py`), `posts.json` (suggested post copy). |

## Make them again

Needs Node (apps/web's toolchain: `pnpm install` at the root), system Chrome, ffmpeg, and Python with numpy and
scipy. From the repository root, with `C:\Users\Ishfaq\tools\node-v24.21.0-win-x64` and `~/scoop/shims` on PATH:

```sh
node apps/web/node_modules/vite/bin/vite.js build --config marketing/video/vite.config.ts   # dist/
cd marketing/video
node tools/render.mjs stills launch 16x9 /tmp/stills 12 30 45      # look at frames
node tools/render.mjs sheet f-resume 9x16 /tmp/sheet.jpg 6 4        # a contact sheet
node tools/produce.mjs launch c30 c15 copilot practice resume jobs dayloop linkedin languages offer learning
node tools/produce.mjs launch-16x9-4k                               # the 4K master (uses the 16:9 film's sound)
node tools/readme.mjs
```

Films: `launch`, `cut30`, `cut15`, `saba`, `saba15`, `f-copilot`, `f-practice`, `f-resume`, `f-jobs`, `f-dayloop`, `f-linkedin`,
`f-languages`, `f-offer`, `f-learning`; formats `16x9`, `9x16`, `1x1`, `4x5`. `produce.mjs` lists its jobs.

The voice-over files are not in git. `node tools/tts.mjs say vo/script.json <dir>` makes them (one Deepgram call per
line, skipped when the file exists with the same words; the key is read from the Orbit API's local `.env` into that
process only, never printed), then `python tools/vo.py <dir>` writes `vo/manifest.json` and the trimmed files the
mix uses. `produce.mjs` reads them from `VO_DIR` (default `%TEMP%\orbit-video\vo`); the files made for the launch
are kept with the videos, in `C:\Users\Ishfaq\Videos\Orbit Launch\voice-over\`, so
`VO_DIR="C:\Users\Ishfaq\Videos\Orbit Launch\voice-over" node tools/produce.mjs ...` needs no new calls.

## The Saba film

`films/saba.tsx` opens the real video interview room (`/live/<id>`, the `video` flow) and plays the interview's server
side from its script (`mock.say`, `mock.question`, `mock.thinking`, the candidate's speech, `mock.completed`). The room
asks the voice endpoint for her lines itself; the film answers with the matching files from `vo/saba.json` (served
at `/__vo/`), so her voice bars and word-by-word captions follow the real audio. `media.ts` plays the room's audio on
the virtual clock and logs each play; the mix puts her voice exactly there:

```sh
node tools/tts.mjs say vo/saba.json <dir> && python tools/vo.py <dir>      # her clips (MP3, as the room gets them)
node tools/render.mjs medialog saba 16x9 vo/saba-plays.json             # after any timing change, each format
node tools/produce.mjs saba saba15
```

The room also asks ahead for its short acknowledgements (naturalVoice.ts `ACKS`); the film has only "Mm-hmm.", and
answers the rest as unavailable, so that is the one she says. The candidate's camera is off (no faces).

## When the app changes

The fixtures are what the app asked for when they were recorded. After a change to the screens a film shows,
re-record from a local stack (it runs the real API with mock providers on a new temp SQLite database):

```sh
sh C:/Users/Ishfaq/tools/orbit-drive/video/stack.sh          # API 8034 (tools/demo_api.py), web 5197
sh marketing/video/tools/record-all.sh                       # seed, restart, record screens and flows, ids.json
sh C:/Users/Ishfaq/tools/orbit-drive/video/stop.sh
```

A render prints any request the fixtures don't answer (`fixture misses: ...`).

## Rules the films keep

No "undetectable", no promises of jobs or offers, no made-up numbers, users or testimonials; fictional employers
only; the AI provider isn't named; the live answer notes are for interviews and calls where AI help is allowed; no
prices; no faces (the call in the Windows scene shows initials). Words stay out of the top 14% and the bottom 20%
of upright frames, where Instagram and Facebook draw their own buttons.
