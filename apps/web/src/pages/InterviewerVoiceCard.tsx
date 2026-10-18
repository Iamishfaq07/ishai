import { useId, useRef, useState } from "react";
import {
  Badge,
  DEVICE_VOICE,
  PACE_KEY,
  PACE_SPEED,
  SegmentedControl,
  Spot,
  VOICE_CHOICE_KEY,
  cx,
  safeLocal,
  savedPace,
  speakNatural,
  speakable,
  toast,
  type VoicePace,
} from "@orbit/ui";
import { Button, Card, Field, Select } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const SAMPLE = "Thanks for joining. To start, tell me about a project you're proud of, and what you did yourself.";
const PACES: Array<{ value: VoicePace; label: string }> = [
  { value: "slower", label: "Slower" },
  { value: "normal", label: "Normal" },
  { value: "brisk", label: "Brisk" },
];
const DEVICE_RATE: Record<VoicePace, number> = { slower: 0.9, normal: 1, brisk: 1.1 };

/**
 * Whether this account picks Saba's voice and pace: only the admin, for testing (D76, the owner: everyone else hears
 * Aurora at the normal pace and sees no setting). False until the server says, so nobody else sees it flash.
 */
export function useVoiceChoice() {
  const status = useAsync(() => api.voiceStatus(), [], "voice-status");
  const s = status.data;
  // "Aurora · bright and lively" → "Aurora": whichever voice the server gives everyone.
  const everyone = s?.voices.find((v) => v.id === s.default_voice)?.label.split(" · ")[0] ?? "the default voice";
  return { status, canChoose: s?.can_choose === true, everyone };
}

/**
 * The admin's voice and pace for the mock interviewer (D76): one of the natural AI voices the server offers or this
 * device's own, at a slower, normal or brisk pace, with a sample. Kept on this device; used by the admin's mock
 * interviews and video interviews. In Settings, and in the video interview's camera check. Nothing at all for anyone
 * else.
 */
export function VoicePicker({ compact = false, className }: { compact?: boolean; className?: string }) {
  const id = useId();
  const { status, canChoose, everyone } = useVoiceChoice();
  const [choice, setChoice] = useState<string>(() => safeLocal.getItem(VOICE_CHOICE_KEY) ?? "");
  const [pace, setPace] = useState<VoicePace>(savedPace);
  const [playing, setPlaying] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const s = status.data;
  if (!s || !canChoose) return null;
  const voices = s.voices;
  const ids = voices.map((v) => v.id);
  const selected = choice === DEVICE_VOICE || !voices.length ? DEVICE_VOICE : ids.includes(choice) ? choice : s.default_voice;

  const pick = (value: string) => {
    setChoice(value);
    safeLocal.setItem(VOICE_CHOICE_KEY, value);
  };
  const pickPace = (value: VoicePace) => {
    setPace(value);
    safeLocal.setItem(PACE_KEY, value);
  };

  const preview = async () => {
    if (playing) {
      stopper.current?.abort();
      window.speechSynthesis?.cancel();
      setPlaying(false);
      return;
    }
    const controller = new AbortController();
    stopper.current = controller;
    setPlaying(true);
    try {
      if (selected === DEVICE_VOICE) {
        const u = new SpeechSynthesisUtterance(speakable(SAMPLE));
        u.rate = DEVICE_RATE[pace];
        u.onend = () => setPlaying(false);
        u.onerror = () => setPlaying(false);
        window.speechSynthesis.speak(u);
        return;
      }
      await speakNatural(SAMPLE, api.speak, selected, controller.signal, { speed: PACE_SPEED[pace] });
      status.reload();
    } catch (err) {
      if (!controller.signal.aborted) toast({ message: errorText(err), tone: "error" });
    }
    if (selected !== DEVICE_VOICE) setPlaying(false);
  };

  return (
    <div className={cx(compact ? "space-y-3" : "space-y-4", className)}>
      {compact && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Badge tone="accent">Admin</Badge>
          Only you can change this. Everyone else hears {everyone} at the normal pace.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={compact ? "Saba's voice" : "Voice"} htmlFor={`${id}-voice`}>
          <Select id={`${id}-voice`} value={selected} onChange={(e) => pick(e.target.value)}>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
            <option value={DEVICE_VOICE}>This device's voice</option>
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => void preview()}>
          {playing ? "Stop" : "Play a sample"}
        </Button>
      </div>
      <div className="space-y-1.5">
        <p id={`${id}-pace`} className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Speaking pace
        </p>
        <SegmentedControl labelledBy={`${id}-pace`} value={pace} onChange={pickPace} options={PACES} size="sm" />
      </div>
      {!compact && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {s.available
            ? `The natural voices are made by Deepgram from the interviewer's text only, never from what you say.${
                s.chars_left !== null ? ` ${s.chars_left.toLocaleString("en-IN")} characters left today (about ${Math.floor(s.chars_left / 120)} questions); after that, this device's voice takes over.` : ""
              }`
            : "The natural AI voices aren't available on this server, so this device's own voice reads the questions."}
        </p>
      )}
    </div>
  );
}

/** Settings → Interviewer voice, for the admin only: the mock interviewer's natural AI voice or the device's. */
export function InterviewerVoiceCard() {
  const { canChoose, everyone } = useVoiceChoice();
  if (!canChoose) return null;
  return (
    <Card id="interviewer-voice" className="scroll-mt-24">
      <h2 className="mb-1 flex items-center gap-3 font-semibold">
        <Spot kind="voice" />
        Interviewer voice
        <Badge tone="accent">Admin</Badge>
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Only you see this, to test the voices: everyone else hears {everyone} at the normal pace, with no setting. The
        question is always on screen too, and the voice can be muted during a mock.
      </p>
      <VoicePicker />
    </Card>
  );
}
