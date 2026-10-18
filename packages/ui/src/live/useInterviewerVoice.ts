import { useCallback, useEffect, useRef, useState } from "react";
import type { MockVoiceEvent } from "@orbit/types";
import {
  ACKS,
  NaturalVoiceError,
  PACE_SPEED,
  cachedAck,
  naturalVoiceGone,
  playClip,
  speakNatural,
  voiceForSpeaker,
  warmAcks,
  type NaturalVoiceSource,
  type VoicePace,
} from "./naturalVoice";
import { speakable } from "./speechText";
import { VoiceTap } from "./voiceActivity";

/**
 * Speaks the mock interviewer's lines: with the natural voice (neural TTS from the API, the chosen voice and pace)
 * when it's set up and chosen, otherwise with the platform's built-in speech engine (Windows voices in WebView2 / the
 * browser), where a natural-sounding English voice is preferred when installed. Saba never goes silent without saying
 * why (D76): a natural-voice failure, or no sound within a few seconds, falls back to the device's voice for that line
 * (and for the rest of the session when it won't come back: allowance used, off); a browser that won't play sound
 * until a tap gets "blocked" (the room asks for the tap, `unlock` plays it); no voice at all is "unavailable" (the
 * text is shown). Every line is shaped for speech first (speechText.ts).
 *
 * `speaking` lets the page mute the microphone while the interviewer talks, so its own voice (from the speakers) is
 * never transcribed as the candidate's answer. `activity` is the voice as the screen follows it (voiceActivity.ts):
 * its level, its word, and how much of the line has been said.
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

/**
 * Where Saba's current line is (D76):
 * - "preparing": asked for, no sound yet (the room says "about to speak…", and shows none of the text yet);
 * - "speaking": you can hear her (the text appears as she says it);
 * - "blocked": the browser won't play sound until a tap (the room offers "Tap to hear Saba", the text is shown);
 * - "unavailable": no voice at all on this device (the text is shown, with a note);
 * - "done" / "idle": nothing being said.
 */
export type VoicePhase = "idle" | "preparing" | "speaking" | "blocked" | "unavailable" | "done";

export interface InterviewerVoice {
  supported: boolean;
  /** From the moment a line is asked for until it's done (talking over her then stops her). */
  speaking: boolean;
  /**
   * She can be heard now (a line, or an acknowledgement): the page holds the mic's audio back, so her voice from the
   * speakers isn't transcribed as theirs. Not while her voice is on its way (D76: the candidate's last words were
   * lost then, and the transcriber couldn't finish what they'd said until the mic came back).
   */
  audible: boolean;
  phase: VoicePhase;
  /** The line being (or last) said. */
  lineId: string | null;
  voiceName: string | null;
  /** Which engine reads the questions now. */
  engine: "natural" | "device";
  /** How loud she is, which word she's on and how much of the line is said, read without re-rendering. */
  activity: VoiceTap;
  repeat: () => void;
  stop: () => void;
  /** The candidate talked over her: she stops at once, says nothing more, and the server hears why. */
  interrupt: () => void;
  /** Call from a tap or key press: plays the line the browser refused to play without one. */
  unlock: () => void;
  /** A short acknowledgement while she thinks of her next line ("Mm-hmm."), never the same one twice in a row. */
  ack: () => void;
}

export interface VoiceLine {
  id: string;
  text: string;
  speaker?: string;
}

/** No sound this long after a natural-voice line was asked for: the device's voice says it instead. */
const PREPARE_LIMIT_MS = 7000;
/** The device's voice never started: it isn't there. */
const DEVICE_START_LIMIT_MS = 4000;
const DEVICE_RATE: Record<VoicePace, number> = { slower: 0.9, normal: 1, brisk: 1.1 };

export function useInterviewerVoice(
  line: VoiceLine | null,
  {
    lang = "en",
    enabled = true,
    natural = null,
    pace = "normal",
    onEvent,
  }: {
    lang?: string;
    enabled?: boolean;
    natural?: NaturalVoiceSource | null;
    pace?: VoicePace;
    /** What happened to each line (mock.voice for the server: started, finished, blocked, stalled…). */
    onEvent?: (event: MockVoiceEvent, lineId: string, detail?: string) => void;
  } = {},
): InterviewerVoice {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [lineId, setLineId] = useState<string | null>(null);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const spokenId = useRef<string | null>(null);
  // A panel: each speaker gets the next voice the first time they speak, and keeps it.
  const speakers = useRef(new Map<string, number>());
  const inFlight = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);
  const resume = useRef<(() => void) | null>(null);
  const current = useRef<string | null>(null); // the line id this hook is working on now
  const lastAck = useRef<string | null>(null);
  const ackDone = useRef<Promise<void> | null>(null); // an acknowledgement being said: her line waits for it
  const ackStop = useRef<AbortController | null>(null);
  const [acking, setAcking] = useState(false);
  const warmed = useRef<string | null>(null);
  const events = useRef(onEvent);
  events.current = onEvent;
  const [naturalOff, setNaturalOff] = useState(false);
  const useNatural = Boolean(natural) && !natural?.pending && !naturalOff;
  const [tap] = useState(() => new VoiceTap());
  useEffect(() => () => tap.dispose(), [tap]);
  const speed = PACE_SPEED[pace];
  const phaseRef = useRef<VoicePhase>("idle");
  phaseRef.current = phase;

  const report = useCallback((event: MockVoiceEvent, id: string, detail?: string) => {
    if (id) events.current?.(event, id, detail);
  }, []);
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

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

  /** The line is all said: shown in full, and the server told (her check-in after a silence counts from now). */
  const finished = useCallback(
    (id: string) => {
      if (current.current !== id) return;
      clearTimers();
      tap.endLine();
      setPhase("done");
      report("finished", id);
    },
    [tap, report],
  );

  /** No voice can say it: the text is shown in full, with a note. */
  const unavailable = useCallback(
    (id: string, detail: string) => {
      if (current.current !== id) return;
      clearTimers();
      tap.endLine();
      setPhase("unavailable");
      report("unavailable", id, detail);
    },
    [tap, report],
  );

  const sayOnDevice = useCallback(
    /** `offset`: where `text` starts in the line (the part the natural voice didn't get to). */
    (id: string, text: string, speaker?: string, offset = 0) => {
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        unavailable(id, "no speech engine");
        return;
      }
      synth.cancel();
      const spoken = speakable(text);
      const make = () => {
        const u = new SpeechSynthesisUtterance(spoken);
        let chosen = voice;
        if (speaker) {
          const pick = panelVoice(voices, speakers.current.get(speaker) ?? 0);
          chosen = pick.voice ?? voice;
          u.pitch = pick.pitch;
        }
        if (chosen) u.voice = chosen;
        u.lang = chosen?.lang ?? lang;
        u.rate = DEVICE_RATE[pace];
        let started = false;
        const start = () => {
          if (started || current.current !== id) return;
          started = true;
          setPhase("speaking");
          tap.deviceStart(u, spoken, u.rate, offset);
          report("started", id);
        };
        u.onstart = start;
        u.onboundary = (e) => {
          if (e.name && e.name !== "word") return;
          start(); // an engine that skipped onstart
          tap.boundary(u, e.charIndex, e.charLength ?? 0);
        };
        u.onend = () => {
          tap.deviceEnd(u);
          finished(id);
        };
        u.onerror = (e) => {
          tap.deviceEnd(u);
          if (current.current !== id || e.error === "interrupted" || e.error === "canceled") return; // stopped on purpose
          if (e.error === "not-allowed") {
            // Chrome won't speak until the page has had a tap: ask for one, then say it from that tap.
            setPhase("blocked");
            resume.current = () => {
              resume.current = null;
              setPhase("preparing");
              synth.cancel();
              synth.speak(make());
            };
            report("blocked", id, "speech not-allowed");
            return;
          }
          unavailable(id, `speech ${e.error}`);
        };
        return u;
      };
      const u = make();
      // An engine that never starts (no voices installed, a broken speech service) is no voice at all.
      timers.current.push(window.setTimeout(() => {
        if (current.current === id && phaseRef.current === "preparing") {
          synth.cancel();
          unavailable(id, "speech never started");
        }
      }, DEVICE_START_LIMIT_MS));
      setPhase("preparing");
      synth.speak(u);
    },
    [synth, voice, voices, lang, pace, tap, report, finished, unavailable],
  );

  const halt = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    resume.current = null;
    clearTimers();
    synth?.cancel();
  }, [synth]);

  const say = useCallback(
    (id: string, text: string, speaker?: string) => {
      halt();
      current.current = id;
      setLineId(id);
      tap.beginLine(id, text);
      if (speaker && !speakers.current.has(speaker)) speakers.current.set(speaker, speakers.current.size);
      if (!natural || natural.pending || naturalOff) {
        sayOnDevice(id, text, speaker);
        return;
      }
      const voiceId = voiceForSpeaker(natural.voices, speaker ? speakers.current.get(speaker)! : 0)!;
      const controller = new AbortController();
      inFlight.current = controller;
      setPhase("preparing"); // her voice is on its way: the mic still goes to the transcriber (D76)
      let heard = false;
      let blocked = false;
      const fallBack = (rest: string, detail: string) => {
        report("fallback", id, detail);
        sayOnDevice(id, rest, speaker, text.endsWith(rest) ? text.length - rest.length : 0);
      };
      // No sound for too long (a slow network, a stuck request): the device's voice says it now.
      timers.current.push(window.setTimeout(() => {
        if (heard || blocked || inFlight.current !== controller) return;
        controller.abort();
        inFlight.current = null;
        fallBack(text, "natural voice too slow");
      }, PREPARE_LIMIT_MS));
      void speakNatural(text, natural.speak, voiceId, controller.signal, {
        speed,
        before: () => ackDone.current ?? Promise.resolve(),
        onClip: (audio, clip, part) => tap.attach(audio, clip.blob, part),
        onPlaying: () => {
          heard = true;
          if (current.current !== id) return;
          setPhase("speaking");
          report("started", id);
        },
        onBlocked: (play) => {
          blocked = true;
          setPhase("blocked");
          resume.current = () => {
            resume.current = null;
            blocked = false;
            setPhase("preparing");
            play();
          };
          report("blocked", id, "autoplay");
        },
        onIssue: (_kind, detail) => report("stalled", id, detail),
      }).then(
        () => {
          if (inFlight.current === controller) {
            inFlight.current = null;
            finished(id);
          }
        },
        (err: unknown) => {
          if (controller.signal.aborted) return; // stopped, or the next line took over
          inFlight.current = null;
          const cause = err instanceof NaturalVoiceError ? err.reason : err;
          if (naturalVoiceGone(cause)) setNaturalOff(true);
          fallBack(err instanceof NaturalVoiceError ? err.rest : text, cause instanceof Error ? cause.message : "natural voice failed");
        },
      );
    },
    [natural, naturalOff, halt, sayOnDevice, tap, speed, report, finished],
  );

  useEffect(() => {
    if (!line) return;
    // Still finding out whether the natural voice is on: wait (a moment at most) instead of the device's voice.
    if (natural?.pending && !naturalOff) return;
    if (spokenId.current === line.id) return;
    spokenId.current = line.id;
    if (!enabled) {
      // Her voice is off: the line is shown in full at once.
      current.current = line.id;
      setLineId(line.id);
      tap.beginLine(line.id, line.text);
      tap.endLine();
      setPhase("done");
      return;
    }
    say(line.id, line.text, line.speaker);
  }, [line, enabled, say, natural?.pending, naturalOff, tap]);

  useEffect(() => () => halt(), [halt]);

  // The acknowledgements are fetched once per voice, after her first line (so they never delay it).
  useEffect(() => {
    if (!useNatural || !natural || phase !== "done") return;
    const voiceId = natural.voices[0];
    const key = `${voiceId}:${speed}`;
    if (!voiceId || warmed.current === key) return;
    warmed.current = key;
    void warmAcks(natural.speak, voiceId, speed).then((all) => {
      if (!all && warmed.current === key) warmed.current = null; // some missing: again after her next line
    });
  }, [useNatural, natural, phase, speed]);

  const stopAck = useCallback(() => {
    ackStop.current?.abort();
    ackStop.current = null;
  }, []);
  const stop = useCallback(() => {
    halt();
    stopAck();
    tap.stop();
    if (current.current) setPhase("done");
  }, [halt, stopAck, tap]);
  const interrupt = useCallback(() => {
    const id = current.current;
    stopAck();
    if (!id || (phaseRef.current !== "speaking" && phaseRef.current !== "preparing")) return;
    halt();
    tap.stop();
    setPhase("done");
    report("interrupted", id);
  }, [halt, stopAck, tap, report]);
  const repeat = useCallback(() => {
    if (line) say(line.id, line.text, line.speaker);
  }, [line, say]);
  const unlock = useCallback(() => resume.current?.(), []);
  const ack = useCallback(() => {
    if (!enabled || phaseRef.current === "speaking" || ackDone.current) return;
    if (useNatural && natural) {
      // Only one already cached (it plays at once); her line, if it arrives meanwhile, waits for it to finish.
      const voiceId = natural.voices[0]!;
      const controller = new AbortController();
      ackStop.current = controller;
      const run = (async () => {
        const found = await cachedAck(voiceId, speed, lastAck.current);
        if (!found || controller.signal.aborted || phaseRef.current === "speaking") return;
        lastAck.current = found.text;
        setAcking(true);
        await playClip(found.clip, controller.signal, {
          rate: found.clip.speed === speed ? 1 : speed / found.clip.speed,
          onClip: (audio, clip) => tap.attach(audio, clip.blob, { text: "", offset: 0 }),
        }).catch(() => undefined);
      })().finally(() => {
        setAcking(false);
        if (ackStop.current === controller) ackStop.current = null;
        ackDone.current = null;
      });
      ackDone.current = run;
      return;
    }
    if (phaseRef.current === "preparing") return; // the device's voice can't wait its turn behind it
    const options = ACKS.filter((a) => a !== lastAck.current);
    const text = options[Math.floor(Math.random() * options.length)]!;
    lastAck.current = text;
    if (synth && typeof SpeechSynthesisUtterance !== "undefined") {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = DEVICE_RATE[pace];
      synth.speak(u);
    }
  }, [enabled, useNatural, natural, speed, tap, synth, voice, pace]);
  useEffect(() => () => ackStop.current?.abort(), []);

  return {
    supported: Boolean(synth) || useNatural,
    speaking: phase === "preparing" || phase === "speaking",
    audible: phase === "speaking" || acking,
    phase,
    lineId,
    voiceName: useNatural ? null : (voice?.name ?? null),
    engine: useNatural ? "natural" : "device",
    activity: tap,
    repeat,
    stop,
    interrupt,
    unlock,
    ack,
  };
}
