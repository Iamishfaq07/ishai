# F-03 · Natural AI interviewer voice

Status: shipped 16 Oct 2026. On automatically when `DEEPGRAM_API_KEY` is set (production already needs it).

## What it does
- The mock interviewer reads each question with a neural voice (Deepgram Aura-2), streamed through the API and
  played as it arrives. The Deepgram key never leaves the server.
- **One voice: Thalia (`aura-2-thalia-en`), Deepgram's default American English voice.** The British and Australian
  model names couldn't be verified, and a model name Deepgram doesn't have fails every request, so they were removed
  (17 Oct). A voice saved by an older client (`uk`, `au`) gets Thalia.
- Settings → Interviewer voice: the natural voice or the device's own, and play a sample.
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
- Latency wasn't measured against a real Deepgram account here (no key in this environment).

## Playback (fixed 17 Oct)
- Each question plays in its own new `<audio>` element, once its MP3 has arrived. The first version reused one element
  and streamed into it with MediaSource. Loading a new source while the last `play()` was still starting made browsers
  throw "The play() request was interrupted by a new load request", and the question then fell back to the device's
  voice. A clip stopped on purpose (the next question, Stop, barge-in) is not treated as a failure.
- The first question waits (up to 2.5 s) for the server to say whether the natural voice is on, instead of being
  read by the device's voice while that's still loading.

## Tests
- `apps/api/tests/test_voice.py`: off without a key, streaming through the API, the key kept server-side, the daily
  allowance, provider failures as JSON errors that cost nothing.
- `packages/ui/src/live/naturalVoice.test.ts`: voice order, panel voices, when to stop asking.
- Playwright: a real mock session played an MP3 to the end with the natural voice, and fell back to the device's voice
  on a 429.
