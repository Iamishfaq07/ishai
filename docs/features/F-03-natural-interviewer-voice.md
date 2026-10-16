# F-03 · Natural AI interviewer voice

Status: shipped 16 Oct 2026. On automatically when `DEEPGRAM_API_KEY` is set (production already needs it).

## What it does
- The mock interviewer reads each question with a neural voice (Deepgram Aura-2), streamed through the API and
  played as it arrives. The Deepgram key never leaves the server.
- Voices with a documented accent: Thalia (American), Draco (British), Hyperion (Australian). Deepgram doesn't list
  an Indian English Aura-2 voice yet, so none is offered. Add one to `VOICES` in `orbit_api/voice/routes.py` when it
  exists. In a panel interview, each interviewer gets the next voice.
- Settings → Interviewer voice: pick a natural voice or the device's own, and play a sample.
- During a mock: **Mute voice** (remembered on the device), Repeat, Stop. The question is always on screen.
- Talking over the voice stops it (the existing barge-in).

## Fallbacks (the mock never goes silent)
| Situation | What happens |
| --- | --- |
| No Deepgram key, or `ORBIT_NATURAL_VOICE=false` | The device's voice. |
| Today's allowance used (429) | The device's voice for the rest of the session. |
| Deepgram error, network drop, autoplay refused | The device's voice for that question; the next one tries again. |

## Cost control
- `ORBIT_TTS_DAILY_CHARS` (default 20,000 characters, about 160 questions) per account per day; the admin has no cap.
- Each request is at most 800 characters, and only the interviewer's text is sent.
- Characters are recorded as `usage` rows with metric `tts_chars`, and only once audio has started.

## Not built (from the brief)
- The interviewer cutting in when an answer runs long ("Let me stop you there…") and back-channel cues.
- Latency wasn't measured against a real Deepgram account here (no key in this environment). The client starts
  playback on the first chunk wherever MediaSource takes MP3 (Chrome, Edge, Firefox, Safari on macOS).

## Tests
- `apps/api/tests/test_voice.py`: off without a key, streaming through the API, the key kept server-side, the daily
  allowance, provider failures as JSON errors that cost nothing.
- `packages/ui/src/live/naturalVoice.test.ts`: voice order, panel voices, when to stop asking.
- Playwright: a real mock session played an MP3 to the end with the natural voice, and fell back to the device's voice
  on a 429.
