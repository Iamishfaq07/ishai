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

/** Every voice for the language, the most natural first: a panel gives each interviewer a different one. */
export function pickVoices(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const base = lang.split("-")[0]!.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const rank = (v: SpeechSynthesisVoice) => {
    const i = PREFERRED.findIndex((p) => p.test(v.name));
    return i === -1 ? PREFERRED.length : i;
  };
  return [...matching].sort((a, b) => rank(a) - rank(b));
}

/** A panelist's voice: the n-th distinct voice, and when there are fewer voices than panelists, a different pitch. */
export function panelVoice(voices: SpeechSynthesisVoice[], n: number): { voice: SpeechSynthesisVoice | undefined; pitch: number } {
  if (!voices.length) return { voice: undefined, pitch: [1, 0.85, 1.15][n % 3]! };
  const lap = Math.floor(n / voices.length);
  return { voice: voices[n % voices.length], pitch: [1, 0.85, 1.15][lap % 3]! };
}

export interface InterviewerVoice {
  supported: boolean;
  speaking: boolean;
  voiceName: string | null;
  repeat: () => void;
  stop: () => void;
}

export function useInterviewerVoice(
  question: { id: string; text: string; speaker?: string } | null,
  { lang = "en", enabled = true }: { lang?: string; enabled?: boolean } = {},
): InterviewerVoice {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const spokenId = useRef<string | null>(null);
  // A panel: each speaker gets the next voice the first time they speak, and keeps it.
  const speakers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!synth) return;
    const load = () => {
      setVoice(pickVoice(synth.getVoices(), lang));
      setVoices(pickVoices(synth.getVoices(), lang));
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, [synth, lang]);

  const say = useCallback(
    (text: string, speaker?: string) => {
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      let chosen = voice;
      if (speaker) {
        if (!speakers.current.has(speaker)) speakers.current.set(speaker, speakers.current.size);
        const pick = panelVoice(voices, speakers.current.get(speaker)!);
        chosen = pick.voice ?? voice;
        u.pitch = pick.pitch;
      }
      if (chosen) u.voice = chosen;
      u.lang = chosen?.lang ?? lang;
      u.rate = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true); // mute the mic from the moment speech is requested, not when audio starts
      synth.speak(u);
    },
    [synth, voice, voices, lang],
  );

  useEffect(() => {
    if (!enabled || !question || spokenId.current === question.id) return;
    spokenId.current = question.id;
    say(question.text, question.speaker);
  }, [question, enabled, say]);

  useEffect(() => () => synth?.cancel(), [synth]);

  const stop = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, [synth]);
  const repeat = useCallback(() => {
    if (question) say(question.text, question.speaker);
  }, [question, say]);

  return { supported: Boolean(synth), speaking, voiceName: voice?.name ?? null, repeat, stop };
}
