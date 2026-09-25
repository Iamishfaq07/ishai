import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Speaks the mock interviewer's questions with the platform's built-in speech engine (Windows voices in WebView2 /
 * the browser): free, local, no provider. A natural-sounding English voice is preferred when installed.
 *
 * `speaking` lets the page mute the microphone while the interviewer talks, so its own voice (from the speakers) is
 * never transcribed as the candidate's answer.
 */
const PREFERRED = [/natural/i, /aria|jenny|guy|sonia|ryan|libby/i, /zira|david|mark/i];

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const base = lang.split("-")[0]!.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  for (const pattern of PREFERRED) {
    const hit = matching.find((v) => pattern.test(v.name));
    if (hit) return hit;
  }
  return matching[0] ?? voices[0];
}

export interface InterviewerVoice {
  supported: boolean;
  speaking: boolean;
  voiceName: string | null;
  repeat: () => void;
  stop: () => void;
}

export function useInterviewerVoice(
  question: { id: string; text: string } | null,
  { lang = "en", enabled = true }: { lang?: string; enabled?: boolean } = {},
): InterviewerVoice {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>();
  const spokenId = useRef<string | null>(null);

  useEffect(() => {
    if (!synth) return;
    const load = () => setVoice(pickVoice(synth.getVoices(), lang));
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [synth, lang]);

  const say = useCallback(
    (text: string) => {
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? lang;
      u.rate = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true); // mute the mic from the moment speech is requested, not when audio starts
      synth.speak(u);
    },
    [synth, voice, lang],
  );

  useEffect(() => {
    if (!enabled || !question || spokenId.current === question.id) return;
    spokenId.current = question.id;
    say(question.text);
  }, [question, enabled, say]);

  useEffect(() => () => synth?.cancel(), [synth]);

  const stop = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, [synth]);
  const repeat = useCallback(() => {
    if (question) say(question.text);
  }, [question, say]);

  return { supported: Boolean(synth), speaking, voiceName: voice?.name ?? null, repeat, stop };
}
