import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speechLang } from "@orbit/ui";
import { useCountry } from "./country";

// ---- answering by voice --------------------------------------------------------------------------------------------

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in your browser's settings, or type your answer.",
  "service-not-allowed": "This browser won't do speech-to-text here. Type your answer instead.",
  "no-speech": "Didn't hear anything. Press Speak and try again a little closer to the mic, or type.",
  "audio-capture": "No microphone found. Type your answer instead.",
  network: "Voice needs the internet here: your browser does the speech-to-text online. Type instead.",
  "language-not-supported": "This browser can't do speech-to-text in your English here. Type your answer instead.",
};

/**
 * Speech-to-text into the answer box, with the browser's own SpeechRecognition (Chrome, Edge, Safari; not Firefox or
 * most in-app browsers, which get typing only), in the English of the country the user applies in (speechLang).
 * Android's continuous mode repeats itself, so there it
 * listens a phrase at a time and starts again until Stop.
 */
export function useDictation(text: string, onText: (text: string) => void) {
  const Ctor = useMemo(recognitionCtor, []);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const base = useRef("");
  const lang = speechLang(useCountry());
  const latest = useRef({ text, onText, lang });
  latest.current = { text, onText, lang };

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    setError(null);
    const android = /android/i.test(navigator.userAgent);
    base.current = latest.current.text.trim();
    wanted.current = true;
    const listen = () => {
      const r = new Ctor();
      r.lang = latest.current.lang;
      r.continuous = !android;
      r.interimResults = true;
      let heard = "";
      r.onresult = (e) => {
        let final = "";
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        heard = final;
        latest.current.onText([base.current, (final + interim).trim()].filter(Boolean).join(" "));
      };
      r.onerror = (e) => {
        if (e.error !== "aborted" && !(android && e.error === "no-speech" && heard)) {
          wanted.current = false;
          setError(VOICE_ERRORS[e.error] ?? "Voice stopped working. Type your answer instead.");
        }
      };
      r.onend = () => {
        base.current = [base.current, heard.trim()].filter(Boolean).join(" ");
        latest.current.onText(base.current);
        if (wanted.current && android) {
          listen(); // the next phrase
          return;
        }
        wanted.current = false;
        setListening(false);
      };
      rec.current = r;
      try {
        r.start();
        setListening(true);
      } catch {
        wanted.current = false;
        setListening(false);
        setError("Voice couldn't start. Type your answer instead.");
      }
    };
    listen();
  }, [Ctor]);

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  return { supported: Boolean(Ctor), listening, error, start, stop };
}
