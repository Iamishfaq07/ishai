import { useCallback, useEffect, useRef, useState } from "react";
import { naturalVoiceGone, playResponse, voiceForSpeaker, type NaturalVoiceSource } from "./naturalVoice";

/**
 * Speaks the mock interviewer's questions: with the natural voice (neural TTS streamed from the API) when it's set
 * up and chosen, otherwise with the platform's built-in speech engine (Windows voices in WebView2 / the browser),
 * where a natural-sounding English voice is preferred when installed. A natural-voice failure falls back to the
 * device's voice for that question, and for the rest of the session when it won't come back (allowance used, off).
 *
 * `speaking` lets the page mute the microphone while the interviewer talks, so its own voice (from the speakers) is
 * never transcribed as the candidate's answer.
 */
const PREFERRED = [/natural/i, /aria|jenny|guy|sonia|ryan|libby/i, /zira|david|mark/i];

/** The speech-synthesis language for a mock's practice language: Hindi in Devanagari, Hinglish (Roman Hindi) read
 * best by an Indian English voice. */
export function voiceLanguage(practiceLanguage: string | undefined): string {
  return practiceLanguage === "hi" ? "hi-IN" : practiceLanguage === "hinglish" ? "en-IN" : "en";
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const base = lang.split("-")[0]!.toLowerCase();
  const best = (pool: SpeechSynthesisVoice[]) => {
    for (const pattern of PREFERRED) {
      const hit = pool.find((v) => pattern.test(v.name));
      if (hit) return hit;
    }
    return pool[0];
  };
  // A region asked for (en-IN, hi-IN): the most natural of its own voices, else of the language's others.
  const regional = lang.includes("-") ? voices.filter((v) => v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase()) : [];
  return best(regional) ?? best(voices.filter((v) => v.lang.toLowerCase().startsWith(base))) ?? voices[0];
}

/** Every voice for the language, the most natural first: a panel gives each interviewer a different one. */
export function pickVoices(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const base = lang.split("-")[0]!.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const regional = (v: SpeechSynthesisVoice) => (lang.includes("-") && v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase() ? 0 : 1);
  const rank = (v: SpeechSynthesisVoice) => {
    const i = PREFERRED.findIndex((p) => p.test(v.name));
    return regional(v) * (PREFERRED.length + 1) + (i === -1 ? PREFERRED.length : i);
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
  /** Which engine reads the questions now. */
  engine: "natural" | "device";
  repeat: () => void;
  stop: () => void;
}

export function useInterviewerVoice(
  question: { id: string; text: string; speaker?: string } | null,
  { lang = "en", enabled = true, natural = null }: { lang?: string; enabled?: boolean; natural?: NaturalVoiceSource | null } = {},
): InterviewerVoice {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const spokenId = useRef<string | null>(null);
  // A panel: each speaker gets the next voice the first time they speak, and keeps it.
  const speakers = useRef(new Map<string, number>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const [naturalOff, setNaturalOff] = useState(false);
  const useNatural = Boolean(natural) && !naturalOff;

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

  const sayOnDevice = useCallback(
    (text: string, speaker?: string) => {
      if (!synth) {
        setSpeaking(false);
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      let chosen = voice;
      if (speaker) {
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

  const halt = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    audio.current?.pause();
    synth?.cancel();
  }, [synth]);

  const say = useCallback(
    (text: string, speaker?: string) => {
      halt();
      if (speaker && !speakers.current.has(speaker)) speakers.current.set(speaker, speakers.current.size);
      if (!natural || naturalOff) {
        sayOnDevice(text, speaker);
        return;
      }
      const id = voiceForSpeaker(natural.voices, speaker ? speakers.current.get(speaker)! : 0)!;
      const controller = new AbortController();
      inFlight.current = controller;
      audio.current ??= new Audio();
      setSpeaking(true); // the mic is muted from the request on, as with the device's voice
      void natural
        .speak(text, id, controller.signal)
        .then((res) => playResponse(res, audio.current!, controller.signal))
        .then(
          () => {
            if (inFlight.current === controller) {
              inFlight.current = null;
              setSpeaking(false);
            }
          },
          (err: unknown) => {
            if (controller.signal.aborted) return; // stopped, or the next question took over
            inFlight.current = null;
            if (naturalVoiceGone(err)) setNaturalOff(true);
            sayOnDevice(text, speaker);
          },
        );
    },
    [natural, naturalOff, halt, sayOnDevice],
  );

  useEffect(() => {
    if (!enabled || !question || spokenId.current === question.id) return;
    spokenId.current = question.id;
    say(question.text, question.speaker);
  }, [question, enabled, say]);

  useEffect(() => () => halt(), [halt]);

  const stop = useCallback(() => {
    halt();
    setSpeaking(false);
  }, [halt]);
  const repeat = useCallback(() => {
    if (question) say(question.text, question.speaker);
  }, [question, say]);

  return {
    supported: Boolean(synth) || useNatural,
    speaking,
    voiceName: useNatural ? null : (voice?.name ?? null),
    engine: useNatural ? "natural" : "device",
    repeat,
    stop,
  };
}
