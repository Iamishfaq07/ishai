# F-05 · Hindi and Hinglish mock interviews

Status: built 16 Oct 2026, **off by default** (`ORBIT_MULTILINGUAL=false`). English stays the default either way.

## What it does (with the flag on)
- Practice → **Language**: English, हिन्दी (Hindi) or Hinglish. Remembered on the device.
- The AI interviewer asks in that language:
  - Hindi is written in Devanagari, with technical words kept in English.
  - Hinglish is written in Latin script, the way Indian professionals mix the two at work.
  - It always uses the respectful "aap". It never comments on, or penalises, the language the candidate answers in.
- Transcription uses Deepgram Nova-3 `language=multi`. Deepgram documents Hindi among its code-switching languages.
- The review is written in the same language, against the same rubric. JSON keys and scores are unchanged.
- The interviewer's voice:
  - Hindi uses a hi-IN device voice; Hinglish uses an en-IN one.
  - The natural AI voices are English only, so they're skipped for these rounds.
- If the model can't be reached, the fallback questions are in the chosen language.
- The one-tap rounds with fixed questions (the 5-min HR round, Tell me about yourself) ask them in the chosen language,
  and a drill's lead lines ("Let's try this one again") are in it too.
- Hindi takes about 2.2x the tokens of the same English text (Hinglish about 1.5x, measured with DeepSeek-V3's
  tokenizer), so the interviewer's and the review's output budgets grow with the language.

## Scope
- Only mock interviews change language. The live copilot, saved setups and the rest of the UI stay English.
- The app's own labels and buttons are not translated (no i18n framework yet).
- Delivery stats still work: pace, pauses and talk time. Filler-word detection only knows English fillers.

## OWNER ACTION REQUIRED before turning it on
1. Run a few real Hindi and Hinglish mocks with production Deepgram. Read the transcripts; there are third-party
   reports of Hinglish being mistaken for another language in `multi` mode.
2. Read the reviews a fluent speaker would get: check the wording, and that answers aren't marked down for language.
3. Then set `ORBIT_MULTILINGUAL=true` on Railway (the API service). Turning it off again sends every new session back to
   English.

## Tests
- `apps/api/tests/test_practice_language.py`:
  - off by default;
  - only a mock takes the language;
  - unknown languages become English;
  - the interviewer prompt, the fallbacks, the transcription setting and the review prompt.
- `apps/api/tests/test_english_only.py` still passes unchanged.
- `packages/ui/src/live/panelVoice.test.ts`: hi-IN and en-IN voice choice.
- Playwright: the Language picker appears only with the flag on. A Hinglish mock was created as `hinglish`, and its
  question was read with an en-IN voice, not the English natural voice.
